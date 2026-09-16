/**
 * The operator-editable resource families (Checkpoint 7; migration 0010).
 *
 * WHY THESE LIVE HERE AND NOT IN A ROUTE HANDLER. Everything below is a persistence concern with an
 * invariant attached, and an invariant enforced in one HTTP handler is enforced nowhere: the CLI, a worker
 * and a future route would each have to re-implement it. Keeping the writes in `@yeonjae/db` means the API
 * stays a thin adapter (which is what `apps/api`'s own header promises) and the rules below hold for every
 * caller.
 *
 * THE THREE RULES THESE FUNCTIONS EXIST TO ENFORCE:
 *
 *  1. OPTIMISTIC CONCURRENCY IS A UNIQUE-KEY RACE, NOT A READ-THEN-WRITE. Every `append*Version` inserts
 *     `expectedVersion + 1` and lets the `(project_id, …, version)` unique index arbitrate. Two operators
 *     who both read version 3 therefore both try to insert 4, and exactly one wins; the loser gets
 *     `STALE_VERSION`. Checking `max(version)` first and then inserting would let both through, which is
 *     the classic lost-update this shape exists to prevent.
 *
 *  2. IMMUTABILITY IS THE DATABASE'S, NOT THIS MODULE'S. Pinned identity documents and locked plans are
 *     protected by triggers in 0010. These functions translate the resulting error into a typed one; they
 *     do not *implement* the protection, because a check here would be bypassable by any other caller.
 *
 *  3. WINNER-ONLY PROPAGATION IS ATOMIC. `selectConcept` writes the selection row and the winner/loser
 *     status transitions in ONE transaction, exactly as `candidate_selections` does for manuscripts. A
 *     partial application would leave a round with two "selected" concepts or a winner whose losers still
 *     look live, and a UI reading mid-flight could then present a losing concept as chosen.
 */
import { asCanonError, rethrowCanon, withTransaction, type Client, type Pool } from './client.js';

type Queryable = Pool | Client;

/** Raised when a write lost the optimistic-concurrency race or targeted a frozen version. */
export class ResourceConflictError extends Error {
  constructor(
    readonly code: 'STALE_VERSION' | 'IMMUTABLE_VERSION' | 'PLAN_LOCKED' | 'SELECTION_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'ResourceConflictError';
  }
}

/** Postgres unique-violation. The only way two writers racing the same version number can be detected. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Translate a database refusal into a typed conflict.
 *
 * The trigger errors carry their code in HINT (the convention `asCanonError` already reads), and a unique
 * violation on a version column means exactly one thing: someone else wrote that version first.
 */
function asConflict(err: unknown, staleMessage: string): never {
  if (isUniqueViolation(err)) throw new ResourceConflictError('STALE_VERSION', staleMessage);
  const canon = asCanonError(err);
  if (canon?.code === 'IMMUTABLE_VERSION' || canon?.code === 'PLAN_LOCKED')
    throw new ResourceConflictError(canon.code, canon.detail);
  if (canon?.code === 'SELECTION_CONFLICT')
    throw new ResourceConflictError('SELECTION_CONFLICT', canon.detail);
  return rethrowCanon(err);
}

// ---------------------------------------------------------------------------------------------------------
// story specification
// ---------------------------------------------------------------------------------------------------------

export interface StorySpecVersionRow {
  id: string;
  workspace_id: string;
  project_id: string;
  version: number;
  payload: Record<string, unknown>;
  source: 'workflow' | 'operator';
  derived_from_artifact_id: string | null;
  created_by_user_id: string | null;
  created_at: Date;
}

export async function latestStorySpec(
  db: Queryable,
  projectId: string,
): Promise<StorySpecVersionRow | undefined> {
  const r = await db.query<StorySpecVersionRow>(
    `SELECT * FROM story_spec_versions WHERE project_id = $1 ORDER BY version DESC LIMIT 1`,
    [projectId],
  );
  return r.rows[0];
}

export async function storySpecVersion(
  db: Queryable,
  q: { projectId: string; version: number },
): Promise<StorySpecVersionRow | undefined> {
  const r = await db.query<StorySpecVersionRow>(
    `SELECT * FROM story_spec_versions WHERE project_id = $1 AND version = $2`,
    [q.projectId, q.version],
  );
  return r.rows[0];
}

export async function listStorySpecVersions(
  db: Queryable,
  q: { projectId: string; limit: number; after?: number | undefined },
): Promise<StorySpecVersionRow[]> {
  const r = await db.query<StorySpecVersionRow>(
    `SELECT * FROM story_spec_versions
      WHERE project_id = $1 AND ($2::int IS NULL OR version > $2::int)
      ORDER BY version
      LIMIT $3`,
    [q.projectId, q.after ?? null, q.limit],
  );
  return r.rows;
}

/**
 * Append the next Story Spec version.
 *
 * `expectedVersion` is the version the writer believed was current; the row written is `expectedVersion + 1`.
 * Passing 0 means "there is no spec yet", which is how the first operator-authored spec is created without a
 * separate code path.
 */
export async function appendStorySpecVersion(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    expectedVersion: number;
    payload: Record<string, unknown>;
    source: 'workflow' | 'operator';
    derivedFromArtifactId?: string | undefined;
    createdByUserId?: string | undefined;
  },
): Promise<StorySpecVersionRow> {
  const next = input.expectedVersion + 1;
  const r = await db
    .query<StorySpecVersionRow>(
      `INSERT INTO story_spec_versions
         (workspace_id, project_id, version, payload, source, derived_from_artifact_id, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        next,
        JSON.stringify(input.payload),
        input.source,
        input.derivedFromArtifactId ?? null,
        input.createdByUserId ?? null,
      ],
    )
    .catch((err: unknown) =>
      asConflict(
        err,
        `the story spec has moved past version ${input.expectedVersion}; re-read it and retry`,
      ),
    );
  const row = r.rows[0];
  if (!row) throw new Error('story spec version insert returned no row');
  return row;
}

// ---------------------------------------------------------------------------------------------------------
// assumption review
// ---------------------------------------------------------------------------------------------------------

export interface AssumptionDecisionRow {
  id: string;
  workspace_id: string;
  project_id: string;
  spec_version: number;
  requirement_id: string;
  decision: 'confirm' | 'edit' | 'reject';
  edited_text: string | null;
  rationale: string | null;
  promoted_kind: 'hard' | 'soft' | null;
  decided_by_user_id: string | null;
  created_at: Date;
}

export async function listAssumptionDecisions(
  db: Queryable,
  q: { projectId: string; specVersion?: number | undefined },
): Promise<AssumptionDecisionRow[]> {
  const r = await db.query<AssumptionDecisionRow>(
    `SELECT * FROM assumption_decisions
      WHERE project_id = $1 AND ($2::int IS NULL OR spec_version = $2::int)
      ORDER BY spec_version, requirement_id`,
    [q.projectId, q.specVersion ?? null],
  );
  return r.rows;
}

export async function assumptionDecision(
  db: Queryable,
  q: { projectId: string; specVersion: number; requirementId: string },
): Promise<AssumptionDecisionRow | undefined> {
  const r = await db.query<AssumptionDecisionRow>(
    `SELECT * FROM assumption_decisions
      WHERE project_id = $1 AND spec_version = $2 AND requirement_id = $3`,
    [q.projectId, q.specVersion, q.requirementId],
  );
  return r.rows[0];
}

/**
 * Record an operator's decision about one assumption.
 *
 * This deliberately does NOT rewrite the Story Spec item. Promotion of an assumption into a hard or soft
 * requirement is a spec EDIT, which means a new spec version with its own optimistic-concurrency check and
 * its own audit record. Mutating the current spec from here would be the "silent assumption promotion" the
 * checkpoint forbids: the spec version that downstream planning read would change underneath it.
 */
export async function recordAssumptionDecision(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    specVersion: number;
    requirementId: string;
    decision: 'confirm' | 'edit' | 'reject';
    editedText?: string | undefined;
    rationale?: string | undefined;
    promotedKind?: 'hard' | 'soft' | undefined;
    decidedByUserId?: string | undefined;
  },
): Promise<AssumptionDecisionRow> {
  const r = await db
    .query<AssumptionDecisionRow>(
      `INSERT INTO assumption_decisions
         (workspace_id, project_id, spec_version, requirement_id, decision, edited_text, rationale,
          promoted_kind, decided_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.specVersion,
        input.requirementId,
        input.decision,
        input.editedText ?? null,
        input.rationale ?? null,
        input.promotedKind ?? null,
        input.decidedByUserId ?? null,
      ],
    )
    .catch((err: unknown) =>
      asConflict(
        err,
        `${input.requirementId} has already been decided for spec version ${input.specVersion}`,
      ),
    );
  const row = r.rows[0];
  if (!row) throw new Error('assumption decision insert returned no row');
  return row;
}

// ---------------------------------------------------------------------------------------------------------
// directions
// ---------------------------------------------------------------------------------------------------------

export interface DirectionRow {
  id: string;
  workspace_id: string;
  project_id: string;
  text: string;
  language: string;
  scope_level: 'series' | 'season' | 'arc' | 'chapter_range';
  chapter_from: number | null;
  chapter_to: number | null;
  status: 'active' | 'applied' | 'withdrawn';
  created_by_user_id: string | null;
  created_at: Date;
}

export async function createDirection(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    text: string;
    language?: string | undefined;
    scopeLevel: 'series' | 'season' | 'arc' | 'chapter_range';
    chapterFrom?: number | undefined;
    chapterTo?: number | undefined;
    createdByUserId?: string | undefined;
  },
): Promise<DirectionRow> {
  const r = await db
    .query<DirectionRow>(
      `INSERT INTO directions
         (workspace_id, project_id, text, language, scope_level, chapter_from, chapter_to, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.text,
        input.language ?? 'en',
        input.scopeLevel,
        input.chapterFrom ?? null,
        input.chapterTo ?? null,
        input.createdByUserId ?? null,
      ],
    )
    .catch(rethrowCanon);
  const row = r.rows[0];
  if (!row) throw new Error('direction insert returned no row');
  return row;
}

export async function listDirections(
  db: Queryable,
  q: { projectId: string; limit: number; after?: string | undefined },
): Promise<DirectionRow[]> {
  const r = await db.query<DirectionRow>(
    `SELECT * FROM directions
      WHERE project_id = $1 AND ($2::uuid IS NULL OR id > $2::uuid)
      ORDER BY id
      LIMIT $3`,
    [q.projectId, q.after ?? null, q.limit],
  );
  return r.rows;
}

export async function getDirection(
  db: Queryable,
  q: { projectId: string; directionId: string },
): Promise<DirectionRow | undefined> {
  const r = await db.query<DirectionRow>(
    `SELECT * FROM directions WHERE project_id = $1 AND id = $2`,
    [q.projectId, q.directionId],
  );
  return r.rows[0];
}

export async function setDirectionStatus(
  db: Queryable,
  input: { projectId: string; directionId: string; status: 'active' | 'applied' | 'withdrawn' },
): Promise<DirectionRow | undefined> {
  const r = await db.query<DirectionRow>(
    `UPDATE directions SET status = $3 WHERE project_id = $1 AND id = $2 RETURNING *`,
    [input.projectId, input.directionId, input.status],
  );
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------------------
// concepts
// ---------------------------------------------------------------------------------------------------------

export interface ConceptCandidateRow {
  id: string;
  workspace_id: string;
  project_id: string;
  round: number;
  label: string;
  payload: Record<string, unknown>;
  status: 'candidate' | 'selected' | 'rejected';
  derived_from_artifact_id: string | null;
  created_at: Date;
}

export interface ConceptSelectionRow {
  id: string;
  workspace_id: string;
  project_id: string;
  round: number;
  winner_concept_id: string;
  loser_concept_ids: string[];
  rationale: string | null;
  selected_by_user_id: string | null;
  created_at: Date;
}

export async function insertConceptCandidates(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    round: number;
    candidates: readonly { label: string; payload: Record<string, unknown> }[];
    derivedFromArtifactId?: string | undefined;
  },
): Promise<ConceptCandidateRow[]> {
  const out: ConceptCandidateRow[] = [];
  for (const candidate of input.candidates) {
    const r = await db
      .query<ConceptCandidateRow>(
        `INSERT INTO concept_candidates
           (workspace_id, project_id, round, label, payload, derived_from_artifact_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING *`,
        [
          input.workspaceId,
          input.projectId,
          input.round,
          candidate.label,
          JSON.stringify(candidate.payload),
          input.derivedFromArtifactId ?? null,
        ],
      )
      .catch((err: unknown) =>
        asConflict(err, `concept "${candidate.label}" already exists in round ${input.round}`),
      );
    const row = r.rows[0];
    if (!row) throw new Error('concept candidate insert returned no row');
    out.push(row);
  }
  return out;
}

export async function listConceptCandidates(
  db: Queryable,
  q: { projectId: string; round?: number | undefined; limit: number; after?: string | undefined },
): Promise<ConceptCandidateRow[]> {
  const r = await db.query<ConceptCandidateRow>(
    `SELECT * FROM concept_candidates
      WHERE project_id = $1
        AND ($2::int IS NULL OR round = $2::int)
        AND ($3::uuid IS NULL OR id > $3::uuid)
      ORDER BY id
      LIMIT $4`,
    [q.projectId, q.round ?? null, q.after ?? null, q.limit],
  );
  return r.rows;
}

export async function getConceptCandidate(
  db: Queryable,
  q: { projectId: string; conceptId: string },
): Promise<ConceptCandidateRow | undefined> {
  const r = await db.query<ConceptCandidateRow>(
    `SELECT * FROM concept_candidates WHERE project_id = $1 AND id = $2`,
    [q.projectId, q.conceptId],
  );
  return r.rows[0];
}

export async function conceptSelectionFor(
  db: Queryable,
  q: { projectId: string; round: number },
): Promise<ConceptSelectionRow | undefined> {
  const r = await db.query<ConceptSelectionRow>(
    `SELECT * FROM concept_selections WHERE project_id = $1 AND round = $2`,
    [q.projectId, q.round],
  );
  return r.rows[0];
}

/**
 * Select the winning concept of a round, atomically.
 *
 * The selection row, the winner's promotion and every loser's terminal `rejected` status commit together.
 * That is the whole point: a reader can never observe a round where two concepts are selected, or where a
 * winner exists but its rivals still look live. Losers are RETAINED — they are the evidence that a choice
 * was made — but no status transition in this module can ever move a `rejected` concept back to selected.
 */
export async function selectConcept(
  pool: Pool,
  input: {
    projectId: string;
    round: number;
    winnerConceptId: string;
    rationale?: string | undefined;
    selectedByUserId?: string | undefined;
  },
): Promise<{ selection: ConceptSelectionRow; winner: ConceptCandidateRow }> {
  return withTransaction(pool, async (c) => {
    const candidates = await c.query<ConceptCandidateRow>(
      `SELECT * FROM concept_candidates WHERE project_id = $1 AND round = $2 ORDER BY id FOR UPDATE`,
      [input.projectId, input.round],
    );
    const winner = candidates.rows.find((row) => row.id === input.winnerConceptId);
    if (!winner)
      throw new ResourceConflictError(
        'SELECTION_CONFLICT',
        'the named concept is not a candidate in this round',
      );
    const losers = candidates.rows.filter((row) => row.id !== winner.id).map((row) => row.id);

    const selection = await c
      .query<ConceptSelectionRow>(
        `INSERT INTO concept_selections
           (workspace_id, project_id, round, winner_concept_id, loser_concept_ids, rationale, selected_by_user_id)
         VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7)
         RETURNING *`,
        [
          winner.workspace_id,
          input.projectId,
          input.round,
          winner.id,
          losers,
          input.rationale ?? null,
          input.selectedByUserId ?? null,
        ],
      )
      .catch((err: unknown) =>
        asConflict(
          err,
          `round ${input.round} has already been decided; re-read it before selecting`,
        ),
      );

    await c.query(`UPDATE concept_candidates SET status = 'selected' WHERE id = $1`, [winner.id]);
    if (losers.length > 0)
      await c.query(
        `UPDATE concept_candidates SET status = 'rejected' WHERE id = ANY ($1::uuid[])`,
        [losers],
      );

    const row = selection.rows[0];
    if (!row) throw new Error('concept selection insert returned no row');
    const promoted = await c.query<ConceptCandidateRow>(
      `SELECT * FROM concept_candidates WHERE id = $1`,
      [winner.id],
    );
    const promotedRow = promoted.rows[0];
    if (!promotedRow) throw new Error('concept winner vanished during selection');
    return { selection: row, winner: promotedRow };
  });
}

// ---------------------------------------------------------------------------------------------------------
// register profiles
// ---------------------------------------------------------------------------------------------------------

export interface RegisterProfileRow {
  id: string;
  workspace_id: string;
  project_id: string;
  entity_id: string;
  version: number;
  payload: Record<string, unknown>;
  created_by_user_id: string | null;
  created_at: Date;
}

export async function latestRegisterProfile(
  db: Queryable,
  q: { projectId: string; entityId: string },
): Promise<RegisterProfileRow | undefined> {
  const r = await db.query<RegisterProfileRow>(
    `SELECT * FROM register_profiles WHERE project_id = $1 AND entity_id = $2
      ORDER BY version DESC LIMIT 1`,
    [q.projectId, q.entityId],
  );
  return r.rows[0];
}

export async function listRegisterProfiles(
  db: Queryable,
  q: { projectId: string; limit: number; after?: string | undefined },
): Promise<RegisterProfileRow[]> {
  // DISTINCT ON keeps one row per entity — the newest version — so a list view never shows an entity twice.
  const r = await db.query<RegisterProfileRow>(
    `SELECT DISTINCT ON (entity_id) *
       FROM register_profiles
      WHERE project_id = $1 AND ($2::uuid IS NULL OR entity_id > $2::uuid)
      ORDER BY entity_id, version DESC
      LIMIT $3`,
    [q.projectId, q.after ?? null, q.limit],
  );
  return r.rows;
}

export async function appendRegisterProfile(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    entityId: string;
    expectedVersion: number;
    payload: Record<string, unknown>;
    createdByUserId?: string | undefined;
  },
): Promise<RegisterProfileRow> {
  const r = await db
    .query<RegisterProfileRow>(
      `INSERT INTO register_profiles
         (workspace_id, project_id, entity_id, version, payload, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.entityId,
        input.expectedVersion + 1,
        JSON.stringify(input.payload),
        input.createdByUserId ?? null,
      ],
    )
    .catch((err: unknown) =>
      asConflict(
        err,
        `this register profile has moved past version ${input.expectedVersion}; re-read it and retry`,
      ),
    );
  const row = r.rows[0];
  if (!row) throw new Error('register profile insert returned no row');
  return row;
}

// ---------------------------------------------------------------------------------------------------------
// narrative identity / naming registry / terminology policy
// ---------------------------------------------------------------------------------------------------------

export type IdentityDocumentKind = 'narrative_identity' | 'naming_registry' | 'terminology_policy';

export interface IdentityDocumentRow {
  id: string;
  workspace_id: string;
  project_id: string;
  kind: IdentityDocumentKind;
  version: number;
  payload: Record<string, unknown>;
  pinned: boolean;
  created_by_user_id: string | null;
  created_at: Date;
}

export async function latestIdentityDocument(
  db: Queryable,
  q: { projectId: string; kind: IdentityDocumentKind },
): Promise<IdentityDocumentRow | undefined> {
  const r = await db.query<IdentityDocumentRow>(
    `SELECT * FROM identity_documents WHERE project_id = $1 AND kind = $2
      ORDER BY version DESC LIMIT 1`,
    [q.projectId, q.kind],
  );
  return r.rows[0];
}

export async function pinnedIdentityDocument(
  db: Queryable,
  q: { projectId: string; kind: IdentityDocumentKind },
): Promise<IdentityDocumentRow | undefined> {
  const r = await db.query<IdentityDocumentRow>(
    `SELECT * FROM identity_documents WHERE project_id = $1 AND kind = $2 AND pinned
      ORDER BY version DESC LIMIT 1`,
    [q.projectId, q.kind],
  );
  return r.rows[0];
}

export async function listIdentityDocuments(
  db: Queryable,
  q: { projectId: string; kind: IdentityDocumentKind },
): Promise<IdentityDocumentRow[]> {
  const r = await db.query<IdentityDocumentRow>(
    `SELECT * FROM identity_documents WHERE project_id = $1 AND kind = $2 ORDER BY version`,
    [q.projectId, q.kind],
  );
  return r.rows;
}

export async function appendIdentityDocument(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    kind: IdentityDocumentKind;
    expectedVersion: number;
    payload: Record<string, unknown>;
    createdByUserId?: string | undefined;
  },
): Promise<IdentityDocumentRow> {
  const r = await db
    .query<IdentityDocumentRow>(
      `INSERT INTO identity_documents
         (workspace_id, project_id, kind, version, payload, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.kind,
        input.expectedVersion + 1,
        JSON.stringify(input.payload),
        input.createdByUserId ?? null,
      ],
    )
    .catch((err: unknown) =>
      asConflict(
        err,
        `${input.kind} has moved past version ${input.expectedVersion}; re-read it and retry`,
      ),
    );
  const row = r.rows[0];
  if (!row) throw new Error('identity document insert returned no row');
  return row;
}

/**
 * Pin a version, freezing it.
 *
 * After this returns, migration 0010's trigger refuses any payload change or unpin on the row through every
 * caller, so "pinned" is a database fact rather than an API convention.
 */
export async function pinIdentityDocument(
  db: Queryable,
  input: { projectId: string; kind: IdentityDocumentKind; version: number },
): Promise<IdentityDocumentRow | undefined> {
  const r = await db
    .query<IdentityDocumentRow>(
      `UPDATE identity_documents SET pinned = true
        WHERE project_id = $1 AND kind = $2 AND version = $3
        RETURNING *`,
      [input.projectId, input.kind, input.version],
    )
    .catch((err: unknown) => asConflict(err, 'the version could not be pinned'));
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------------------
// planning documents
// ---------------------------------------------------------------------------------------------------------

export type PlanDocumentKind = 'series_blueprint' | 'arc_plan' | 'chapter_contract' | 'scene_plan';

export interface PlanDocumentRow {
  id: string;
  workspace_id: string;
  project_id: string;
  kind: PlanDocumentKind;
  plan_key: string;
  version: number;
  payload: Record<string, unknown>;
  locked: boolean;
  source: 'workflow' | 'operator';
  derived_from_artifact_id: string | null;
  created_by_user_id: string | null;
  created_at: Date;
}

export async function latestPlanDocument(
  db: Queryable,
  q: { projectId: string; kind: PlanDocumentKind; planKey: string },
): Promise<PlanDocumentRow | undefined> {
  const r = await db.query<PlanDocumentRow>(
    `SELECT * FROM plan_documents WHERE project_id = $1 AND kind = $2 AND plan_key = $3
      ORDER BY version DESC LIMIT 1`,
    [q.projectId, q.kind, q.planKey],
  );
  return r.rows[0];
}

/**
 * List the newest version of every plan of one kind.
 *
 * Ordered and cursored by `plan_key`, which is stable and unique per kind, so pagination is deterministic
 * even as new versions of already-listed plans are appended.
 */
export async function listPlanDocuments(
  db: Queryable,
  q: {
    projectId: string;
    kind: PlanDocumentKind;
    limit: number;
    after?: string | undefined;
  },
): Promise<PlanDocumentRow[]> {
  const r = await db.query<PlanDocumentRow>(
    `SELECT DISTINCT ON (plan_key) *
       FROM plan_documents
      WHERE project_id = $1 AND kind = $2 AND ($3::text IS NULL OR plan_key > $3::text)
      ORDER BY plan_key, version DESC
      LIMIT $4`,
    [q.projectId, q.kind, q.after ?? null, q.limit],
  );
  return r.rows;
}

export async function appendPlanDocument(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    kind: PlanDocumentKind;
    planKey: string;
    expectedVersion: number;
    payload: Record<string, unknown>;
    source: 'workflow' | 'operator';
    derivedFromArtifactId?: string | undefined;
    createdByUserId?: string | undefined;
  },
): Promise<PlanDocumentRow> {
  const r = await db
    .query<PlanDocumentRow>(
      `INSERT INTO plan_documents
         (workspace_id, project_id, kind, plan_key, version, payload, source,
          derived_from_artifact_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.kind,
        input.planKey,
        input.expectedVersion + 1,
        JSON.stringify(input.payload),
        input.source,
        input.derivedFromArtifactId ?? null,
        input.createdByUserId ?? null,
      ],
    )
    .catch((err: unknown) =>
      asConflict(
        err,
        `${input.kind} ${input.planKey || '(series)'} has moved past version ${input.expectedVersion}; re-read it and retry`,
      ),
    );
  const row = r.rows[0];
  if (!row) throw new Error('plan document insert returned no row');
  return row;
}

export async function lockPlanDocument(
  db: Queryable,
  input: { projectId: string; kind: PlanDocumentKind; planKey: string; version: number },
): Promise<PlanDocumentRow | undefined> {
  const r = await db
    .query<PlanDocumentRow>(
      `UPDATE plan_documents SET locked = true
        WHERE project_id = $1 AND kind = $2 AND plan_key = $3 AND version = $4
        RETURNING *`,
      [input.projectId, input.kind, input.planKey, input.version],
    )
    .catch((err: unknown) => asConflict(err, 'the plan version could not be locked'));
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------------------
// chapter review decisions
// ---------------------------------------------------------------------------------------------------------

export interface ChapterReviewRow {
  id: string;
  workspace_id: string;
  project_id: string;
  chapter_id: string;
  chapter_no: number;
  manuscript_version_id: string;
  decision: 'request_changes' | 'reject' | 'approve';
  note: string | null;
  language: string;
  decided_by_user_id: string | null;
  created_at: Date;
}

export async function recordChapterReview(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    chapterId: string;
    chapterNo: number;
    manuscriptVersionId: string;
    decision: 'request_changes' | 'reject' | 'approve';
    note?: string | undefined;
    language?: string | undefined;
    decidedByUserId?: string | undefined;
  },
): Promise<ChapterReviewRow> {
  const r = await db
    .query<ChapterReviewRow>(
      `INSERT INTO chapter_reviews
         (workspace_id, project_id, chapter_id, chapter_no, manuscript_version_id, decision, note,
          language, decided_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.chapterId,
        input.chapterNo,
        input.manuscriptVersionId,
        input.decision,
        input.note ?? null,
        input.language ?? 'en',
        input.decidedByUserId ?? null,
      ],
    )
    .catch(rethrowCanon);
  const row = r.rows[0];
  if (!row) throw new Error('chapter review insert returned no row');
  return row;
}

export async function listChapterReviews(
  db: Queryable,
  q: { projectId: string; chapterNo?: number | undefined },
): Promise<ChapterReviewRow[]> {
  const r = await db.query<ChapterReviewRow>(
    `SELECT * FROM chapter_reviews
      WHERE project_id = $1 AND ($2::int IS NULL OR chapter_no = $2::int)
      ORDER BY created_at, id`,
    [q.projectId, q.chapterNo ?? null],
  );
  return r.rows;
}
