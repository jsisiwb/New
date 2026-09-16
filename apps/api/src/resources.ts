/**
 * The operator-editable `/v1` resource families (Checkpoint 7, API plan §1).
 *
 * This module is the same kind of thing `server.ts` is: a thin, validated, authorized adapter over services
 * that already exist and are already tested. It holds no invariants of its own. Optimistic concurrency,
 * pinned-version immutability, plan locking and winner-only concept propagation are enforced by migration
 * 0010 and `@yeonjae/db`'s operator-resource module; everything here does is translate HTTP into those calls
 * and translate their typed failures back into RFC 9457 problem documents.
 *
 * Two things are worth stating because they are easy to get wrong and expensive when wrong:
 *
 *  * EVERY route resolves its project through an RLS-scoped read FIRST. A project id from another workspace
 *    is therefore a 404 — identical to one that does not exist — before any service sees the identifier. An
 *    id must never be a cross-tenant existence probe.
 *  * `expected_version` is REQUIRED on every edit. It is not a courtesy: it is the entire concurrency story.
 *    Making it optional would mean a client that omits it silently wins every race, which is the lost-update
 *    the versioned tables exist to prevent.
 */
import {
  appendIdentityDocument,
  appendPlanDocument,
  appendRegisterProfile,
  appendStorySpecVersion,
  assumptionDecision,
  conceptSelectionFor,
  createDirection,
  createEntity,
  entitiesOfType,
  getConceptCandidate,
  getDirection,
  insertConceptCandidates,
  latestIdentityDocument,
  latestPlanDocument,
  latestRegisterProfile,
  latestStorySpec,
  listAssumptionDecisions,
  listConceptCandidates,
  listDirections,
  listIdentityDocuments,
  listPlanDocuments,
  listRegisterProfiles,
  lockPlanDocument,
  pinIdentityDocument,
  pinnedIdentityDocument,
  recordAssumptionDecision,
  ResourceConflictError,
  selectConcept,
  setDirectionStatus,
  storySpecVersion,
  type AssumptionDecisionRow,
  type Client,
  type ConceptCandidateRow,
  type DirectionRow,
  type IdentityDocumentKind,
  type IdentityDocumentRow,
  type PlanDocumentKind,
  type PlanDocumentRow,
  type Pool,
  type RegisterProfileRow,
  type StorySpecVersionRow,
} from '@yeonjae/db';
import { validatorFor } from '@yeonjae/domain';
import { ApiError } from './problem.js';
import { asObject, requireEnum, requireInt, requireString, optionalString } from './validate.js';

/**
 * Translate a persistence conflict into the API's stable error vocabulary.
 *
 * All four map to 409: the client's view of the resource is out of date, and the fix is always the same —
 * re-read and retry. The `code` distinguishes *why*, so a UI can say "someone else edited this" rather than
 * "this version is frozen" without parsing prose.
 */
export function asProblem(err: unknown): never {
  if (err instanceof ResourceConflictError) {
    if (err.code === 'STALE_VERSION')
      throw new ApiError('CONFLICT', err.message, { data: { reason: 'stale_version' } });
    if (err.code === 'IMMUTABLE_VERSION')
      throw new ApiError('CONFLICT', err.message, { data: { reason: 'immutable_version' } });
    if (err.code === 'PLAN_LOCKED')
      throw new ApiError('CONFLICT', err.message, { data: { reason: 'plan_locked' } });
    throw new ApiError('SELECTION_CONFLICT', err.message);
  }
  throw err;
}

/** `expected_version` is mandatory on edits; see the module header for why it is not optional. */
export function requireExpectedVersion(body: Record<string, unknown>): number {
  if (body.expected_version === undefined)
    throw new ApiError(
      'VALIDATION_FAILED',
      'Field "expected_version" is required so a concurrent edit cannot be overwritten.',
      { errors: [{ path: 'body.expected_version', message: 'must be an integer >= 0' }] },
    );
  return requireInt(body.expected_version as number, 'body.expected_version', {
    min: 0,
    max: 1_000_000,
  });
}

/** A JSON object payload field, bounded so a single document cannot exhaust memory or the row limit. */
export function requirePayload(
  body: Record<string, unknown>,
  field = 'payload',
): Record<string, unknown> {
  const value = body[field];
  const payload = asObject(value, `body.${field}`);
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > 512_000)
    throw new ApiError('VALIDATION_FAILED', `Field "${field}" is too large.`, {
      errors: [{ path: `body.${field}`, message: 'must be at most 512000 bytes of JSON' }],
    });
  return payload;
}

// ---------------------------------------------------------------------------------------------------------
// story specification
// ---------------------------------------------------------------------------------------------------------

/**
 * Validate an operator-authored Story Spec against the schema that is its contract.
 *
 * The schema is the same one the production loop validates its own generated spec against
 * (`schemas/story-spec.schema.json`, AGENTS.md rule 3). Accepting a looser shape from an operator than from
 * the model would mean planning downstream could receive a document it cannot read — the validation has to
 * be the same validation, not a second, weaker one.
 */
export function validateStorySpec(
  payload: Record<string, unknown>,
  context: { projectId: string; version: number },
): Record<string, unknown> {
  // The API owns these two fields: a client cannot point a spec at another project or renumber a version.
  const candidate = { ...payload, project_id: context.projectId, version: context.version };
  const result = validatorFor<Record<string, unknown>>('story-spec.schema.json')(candidate);
  if (!result.ok)
    throw new ApiError('SPEC_INVALID', 'The story specification is not valid.', {
      errors: result.errors.map((e) => ({ path: `body.payload${e.path}`, message: e.message })),
    });
  return result.value;
}

export function storySpecView(row: StorySpecVersionRow): Record<string, unknown> {
  return {
    project_id: row.project_id,
    version: row.version,
    source: row.source,
    payload: row.payload,
    derived_from_artifact_id: row.derived_from_artifact_id,
    created_at: row.created_at,
  };
}

/**
 * The current spec, preferring an operator/workflow version row and falling back to the workflow artifact.
 *
 * The fallback matters for a project produced before this surface existed: the production loop wrote its
 * spec as a `story_spec` artifact, and a reader must see that rather than an empty resource. The response
 * marks which source answered, so a client can tell "not edited yet" from "never produced".
 */
export async function readCurrentSpec(
  c: Client,
  projectId: string,
): Promise<{ version: number; source: string; payload: unknown } | undefined> {
  const row = await latestStorySpec(c, projectId);
  if (row) return { version: row.version, source: row.source, payload: row.payload };
  const artifact = await c.query<{ key: string; payload: unknown }>(
    `SELECT key, payload FROM workflow_artifacts
      WHERE project_id = $1 AND kind = 'story_spec'
      ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  );
  const found = artifact.rows[0];
  if (!found) return undefined;
  const parsed = Number(found.key.replace(/^v/, ''));
  return {
    version: Number.isInteger(parsed) && parsed > 0 ? parsed : 1,
    source: 'workflow_artifact',
    payload: found.payload,
  };
}

// ---------------------------------------------------------------------------------------------------------
// assumption review
// ---------------------------------------------------------------------------------------------------------

export interface SpecAssumption {
  readonly id: string;
  readonly kind: string;
  readonly category: string;
  readonly text: string;
  readonly language: string;
  readonly rationale: string | undefined;
  readonly confidence: number | undefined;
}

/** Pull the assumption items out of a spec payload without trusting its shape. */
export function assumptionsOf(payload: unknown): SpecAssumption[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: SpecAssumption[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    if (row.kind !== 'assumption') continue;
    if (typeof row.id !== 'string') continue;
    out.push({
      id: row.id,
      kind: 'assumption',
      category: typeof row.category === 'string' ? row.category : 'other',
      text: typeof row.text === 'string' ? row.text : '',
      language: typeof row.language === 'string' ? row.language : 'en',
      rationale: typeof row.rationale === 'string' ? row.rationale : undefined,
      confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    });
  }
  return out;
}

export function decisionView(row: AssumptionDecisionRow): Record<string, unknown> {
  return {
    requirement_id: row.requirement_id,
    spec_version: row.spec_version,
    decision: row.decision,
    edited_text: row.edited_text,
    rationale: row.rationale,
    promoted_kind: row.promoted_kind,
    created_at: row.created_at,
  };
}

export interface AssumptionActionRequest {
  readonly decision: 'confirm' | 'edit' | 'reject';
  readonly editedText: string | undefined;
  readonly rationale: string | undefined;
  readonly promotedKind: 'hard' | 'soft' | undefined;
}

/**
 * Parse an assumption review action.
 *
 * `confirm` must say what the assumption becomes — hard or soft — because "confirmed" on its own would leave
 * the item's kind ambiguous to every downstream reader. `edit` and `reject` must carry a rationale: a
 * requirement that changed for no recorded reason is an audit gap.
 */
export function parseAssumptionAction(body: unknown): AssumptionActionRequest {
  const obj = asObject(body);
  const decision = requireEnum(
    obj.decision,
    ['confirm', 'edit', 'reject'] as const,
    'body.decision',
  );
  if (decision === 'confirm') {
    const promotedKind = requireEnum(
      obj.promoted_kind,
      ['hard', 'soft'] as const,
      'body.promoted_kind',
    );
    return {
      decision,
      promotedKind,
      editedText: undefined,
      rationale: optionalString(obj, 'rationale', { max: 2_000 }),
    };
  }
  if (decision === 'edit')
    return {
      decision,
      editedText: requireString(obj, 'edited_text', { max: 5_000 }),
      rationale: requireString(obj, 'rationale', { max: 2_000 }),
      promotedKind: undefined,
    };
  return {
    decision,
    rationale: requireString(obj, 'rationale', { max: 2_000 }),
    editedText: undefined,
    promotedKind: undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------
// directions
// ---------------------------------------------------------------------------------------------------------

export function directionView(row: DirectionRow): Record<string, unknown> {
  return {
    id: row.id,
    text: row.text,
    language: row.language,
    scope_level: row.scope_level,
    chapter_from: row.chapter_from,
    chapter_to: row.chapter_to,
    status: row.status,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------------------------------------
// concepts
// ---------------------------------------------------------------------------------------------------------

/**
 * The public view of a concept candidate.
 *
 * `is_selected` is derived from the persisted status rather than from anything the client sent, and losers
 * keep an explicit `rejected` status rather than being omitted. Both matter for the same reason: a UI must
 * be able to show the alternatives that were considered without any chance of rendering one as chosen.
 */
export function conceptView(row: ConceptCandidateRow): Record<string, unknown> {
  return {
    id: row.id,
    round: row.round,
    label: row.label,
    status: row.status,
    is_selected: row.status === 'selected',
    payload: row.payload,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------------------------------------
// register profiles, identity documents and plans
// ---------------------------------------------------------------------------------------------------------

export function registerProfileView(row: RegisterProfileRow): Record<string, unknown> {
  return {
    entity_id: row.entity_id,
    version: row.version,
    payload: row.payload,
    created_at: row.created_at,
  };
}

export function identityView(row: IdentityDocumentRow): Record<string, unknown> {
  return {
    kind: row.kind,
    version: row.version,
    pinned: row.pinned,
    // An editable resource must say so: a pinned version is frozen by a database trigger, and a UI that
    // offered an edit form for one would be promising something the database will refuse.
    editable: !row.pinned,
    payload: row.payload,
    created_at: row.created_at,
  };
}

export function planView(row: PlanDocumentRow): Record<string, unknown> {
  return {
    kind: row.kind,
    plan_key: row.plan_key,
    version: row.version,
    locked: row.locked,
    editable: !row.locked,
    source: row.source,
    payload: row.payload,
    created_at: row.created_at,
  };
}

export const IDENTITY_KINDS = [
  'narrative_identity',
  'naming_registry',
  'terminology_policy',
] as const satisfies readonly IdentityDocumentKind[];

export const PLAN_KINDS = [
  'series_blueprint',
  'arc_plan',
  'chapter_contract',
  'scene_plan',
] as const satisfies readonly PlanDocumentKind[];

/**
 * The plan key for a kind, validated per kind rather than accepted as free text.
 *
 * `series_blueprint` is a singleton, so its key is the empty string and a client-supplied one is refused
 * rather than silently creating a second blueprint at a different address. Chapter-scoped plans are keyed by
 * chapter number, which is validated as an integer so a key like `../1` cannot exist.
 */
export function planKeyFor(kind: PlanDocumentKind, raw: unknown): string {
  if (kind === 'series_blueprint') {
    if (raw !== undefined && raw !== null && raw !== '')
      throw new ApiError('VALIDATION_FAILED', 'The series blueprint does not take a plan key.', {
        errors: [{ path: 'plan_key', message: 'must be absent for series_blueprint' }],
      });
    return '';
  }
  if (kind === 'chapter_contract' || kind === 'scene_plan') {
    const n = requireInt(raw as string, 'plan_key', { min: 1, max: 10_000 });
    return String(n);
  }
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/.test(key))
    throw new ApiError('VALIDATION_FAILED', 'The plan key is not valid.', {
      errors: [{ path: 'plan_key', message: 'must be an identifier of up to 121 characters' }],
    });
  return key;
}

export {
  appendIdentityDocument,
  appendPlanDocument,
  appendRegisterProfile,
  appendStorySpecVersion,
  assumptionDecision,
  conceptSelectionFor,
  createDirection,
  createEntity,
  entitiesOfType,
  getConceptCandidate,
  getDirection,
  insertConceptCandidates,
  latestIdentityDocument,
  latestPlanDocument,
  latestRegisterProfile,
  listAssumptionDecisions,
  listConceptCandidates,
  listDirections,
  listIdentityDocuments,
  listPlanDocuments,
  listRegisterProfiles,
  lockPlanDocument,
  pinIdentityDocument,
  pinnedIdentityDocument,
  recordAssumptionDecision,
  selectConcept,
  setDirectionStatus,
  storySpecVersion,
  type Pool,
};
