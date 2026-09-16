/**
 * Operator-resource invariants against a real PostgreSQL 16 database (migration 0010).
 *
 * These assert the properties the API depends on but must not itself implement, because an invariant that
 * lives only in a route handler is bypassable by the CLI, a worker, or the next route someone adds:
 *
 *  * optimistic concurrency is decided by a unique key, so two writers racing the same version cannot both
 *    win — the losing INSERT is refused by the database, not by a lucky read;
 *  * a pinned identity version and a locked plan version cannot be rewritten through ANY path;
 *  * concept selection is atomic and winner-only: losers are retained with a terminal status and nothing
 *    here can promote one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  appendIdentityDocument,
  appendPlanDocument,
  appendRegisterProfile,
  appendStorySpecVersion,
  conceptSelectionFor,
  createDirection,
  createEntity,
  createProject,
  createWorkspace,
  insertConceptCandidates,
  latestIdentityDocument,
  latestPlanDocument,
  latestStorySpec,
  listConceptCandidates,
  listDirections,
  lockPlanDocument,
  migrate,
  pinIdentityDocument,
  recordAssumptionDecision,
  resetDatabase,
  ResourceConflictError,
  selectConcept,
  type Pool,
} from './index.js';
import { databaseUrl, freshDatabase } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

run('operator resources (migration 0010)', () => {
  let pool: Pool;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    workspaceId = await createWorkspace(pool, 'operator-resources');
    projectId = (await createProject(pool, { workspaceId, title: 'Second Awakening' })).projectId;
  }, 120_000);

  // ---- optimistic concurrency ------------------------------------------------------------------------

  it('appends story spec versions and refuses a write against a stale version', async () => {
    const first = await appendStorySpecVersion(pool, {
      workspaceId,
      projectId,
      expectedVersion: 0,
      payload: { project_id: projectId, version: 1, items: [] },
      source: 'operator',
    });
    expect(first.version).toBe(1);

    const second = await appendStorySpecVersion(pool, {
      workspaceId,
      projectId,
      expectedVersion: 1,
      payload: { project_id: projectId, version: 2, items: [] },
      source: 'operator',
    });
    expect(second.version).toBe(2);
    expect((await latestStorySpec(pool, projectId))?.version).toBe(2);

    // A writer who still believes version 1 is current is refused rather than silently overwriting 2.
    await expect(
      appendStorySpecVersion(pool, {
        workspaceId,
        projectId,
        expectedVersion: 1,
        payload: { project_id: projectId, version: 2, items: [] },
        source: 'operator',
      }),
    ).rejects.toBeInstanceOf(ResourceConflictError);
  });

  it('lets exactly one of two concurrent writers win the same next version', async () => {
    await appendStorySpecVersion(pool, {
      workspaceId,
      projectId,
      expectedVersion: 0,
      payload: { project_id: projectId, version: 1, items: [] },
      source: 'operator',
    });
    // Both read version 1 and both try to write 2. The unique key — not the application — decides.
    const results = await Promise.allSettled([
      appendStorySpecVersion(pool, {
        workspaceId,
        projectId,
        expectedVersion: 1,
        payload: { project_id: projectId, version: 2, items: [], note: 'a' },
        source: 'operator',
      }),
      appendStorySpecVersion(pool, {
        workspaceId,
        projectId,
        expectedVersion: 1,
        payload: { project_id: projectId, version: 2, items: [], note: 'b' },
        source: 'operator',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ResourceConflictError);
    expect((await latestStorySpec(pool, projectId))?.version).toBe(2);
  });

  // ---- assumptions are never silently promoted -------------------------------------------------------

  it('records an assumption decision without mutating the spec it was taken against', async () => {
    const spec = await appendStorySpecVersion(pool, {
      workspaceId,
      projectId,
      expectedVersion: 0,
      payload: {
        project_id: projectId,
        version: 1,
        items: [
          {
            id: 'REQ-001',
            kind: 'assumption',
            category: 'tone',
            text: 'The tone stays wry.',
            language: 'en',
            provenance: 'model_inferred',
            rationale: 'inferred from the intake',
            scope: { level: 'series' },
          },
        ],
      },
      source: 'workflow',
    });

    await recordAssumptionDecision(pool, {
      workspaceId,
      projectId,
      specVersion: 1,
      requirementId: 'REQ-001',
      decision: 'confirm',
      promotedKind: 'hard',
    });

    // The spec document itself is untouched: promotion is a new spec version, never an in-place edit.
    const after = await latestStorySpec(pool, projectId);
    expect(after?.version).toBe(spec.version);
    const items = (after?.payload as { items: { kind: string }[] }).items;
    expect(items[0]?.kind).toBe('assumption');

    // Deciding the same requirement twice for the same spec version is a conflict, not an overwrite.
    await expect(
      recordAssumptionDecision(pool, {
        workspaceId,
        projectId,
        specVersion: 1,
        requirementId: 'REQ-001',
        decision: 'reject',
        rationale: 'changed my mind',
      }),
    ).rejects.toBeInstanceOf(ResourceConflictError);
  });

  // ---- concepts: winner-only propagation --------------------------------------------------------------

  it('selects exactly one concept and retains the losers with a terminal status', async () => {
    const candidates = await insertConceptCandidates(pool, {
      workspaceId,
      projectId,
      round: 1,
      candidates: [
        { label: 'A', payload: { logline: 'A regressor returns.' } },
        { label: 'B', payload: { logline: 'A status window opens.' } },
        { label: 'C', payload: { logline: 'A guild collapses.' } },
      ],
    });
    const winnerId = candidates[1]?.id ?? '';

    const { selection, winner } = await selectConcept(pool, {
      projectId,
      round: 1,
      winnerConceptId: winnerId,
      rationale: 'strongest hook',
    });
    expect(winner.status).toBe('selected');
    expect(selection.loser_concept_ids).toHaveLength(2);
    expect(selection.loser_concept_ids).not.toContain(winnerId);

    const all = await listConceptCandidates(pool, { projectId, round: 1, limit: 50 });
    expect(all.filter((c) => c.status === 'selected')).toHaveLength(1);
    // Losers are retained as evidence of the decision, never deleted and never selected.
    expect(all.filter((c) => c.status === 'rejected')).toHaveLength(2);

    // A decided round cannot be silently re-decided.
    await expect(
      selectConcept(pool, { projectId, round: 1, winnerConceptId: candidates[0]?.id ?? '' }),
    ).rejects.toBeInstanceOf(ResourceConflictError);
    expect((await conceptSelectionFor(pool, { projectId, round: 1 }))?.winner_concept_id).toBe(
      winnerId,
    );
  });

  it('refuses to select a concept that is not a candidate of that round', async () => {
    await insertConceptCandidates(pool, {
      workspaceId,
      projectId,
      round: 1,
      candidates: [{ label: 'A', payload: {} }],
    });
    const other = await insertConceptCandidates(pool, {
      workspaceId,
      projectId,
      round: 2,
      candidates: [{ label: 'A', payload: {} }],
    });
    await expect(
      selectConcept(pool, { projectId, round: 1, winnerConceptId: other[0]?.id ?? '' }),
    ).rejects.toBeInstanceOf(ResourceConflictError);
  });

  // ---- pinned identity documents are immutable -------------------------------------------------------

  it('refuses to edit or unpin a pinned identity version through any path', async () => {
    await appendIdentityDocument(pool, {
      workspaceId,
      projectId,
      kind: 'narrative_identity',
      expectedVersion: 0,
      payload: { tradition: 'korean_webnovel', output_language: 'en' },
    });
    const pinned = await pinIdentityDocument(pool, {
      projectId,
      kind: 'narrative_identity',
      version: 1,
    });
    expect(pinned?.pinned).toBe(true);

    // Raw SQL, deliberately: the guarantee has to hold for callers that never go through this module.
    await expect(
      pool.query(
        `UPDATE identity_documents SET payload = '{"tradition":"western"}'::jsonb WHERE id = $1`,
        [pinned?.id],
      ),
    ).rejects.toThrow(/IMMUTABLE_VERSION/);
    await expect(
      pool.query('UPDATE identity_documents SET pinned = false WHERE id = $1', [pinned?.id]),
    ).rejects.toThrow(/IMMUTABLE_VERSION/);

    // A change means a NEW version, which is permitted and leaves the pinned one intact.
    const next = await appendIdentityDocument(pool, {
      workspaceId,
      projectId,
      kind: 'narrative_identity',
      expectedVersion: 1,
      payload: { tradition: 'korean_webnovel', output_language: 'en', note: 'revised' },
    });
    expect(next.version).toBe(2);
    expect(next.pinned).toBe(false);
    expect(
      (await latestIdentityDocument(pool, { projectId, kind: 'narrative_identity' }))?.version,
    ).toBe(2);
  });

  // ---- locked plans ------------------------------------------------------------------------------------

  it('refuses to rewrite a locked plan version but allows a new one', async () => {
    await appendPlanDocument(pool, {
      workspaceId,
      projectId,
      kind: 'arc_plan',
      planKey: 'arc-1',
      expectedVersion: 0,
      payload: { beats: ['a'] },
      source: 'workflow',
    });
    const locked = await lockPlanDocument(pool, {
      projectId,
      kind: 'arc_plan',
      planKey: 'arc-1',
      version: 1,
    });
    expect(locked?.locked).toBe(true);

    await expect(
      pool.query(`UPDATE plan_documents SET payload = '{"beats":["b"]}'::jsonb WHERE id = $1`, [
        locked?.id,
      ]),
    ).rejects.toThrow(/PLAN_LOCKED/);

    const next = await appendPlanDocument(pool, {
      workspaceId,
      projectId,
      kind: 'arc_plan',
      planKey: 'arc-1',
      expectedVersion: 1,
      payload: { beats: ['a', 'b'] },
      source: 'operator',
    });
    expect(next.version).toBe(2);
    expect(
      (await latestPlanDocument(pool, { projectId, kind: 'arc_plan', planKey: 'arc-1' }))?.version,
    ).toBe(2);
  });

  // ---- register profiles and directions ---------------------------------------------------------------

  it('versions register profiles per entity independently', async () => {
    const entityA = await createEntity(pool, {
      workspaceId,
      projectId,
      type: 'character',
      displayName: 'Seo Yuna',
    });
    const entityB = await createEntity(pool, {
      workspaceId,
      projectId,
      type: 'character',
      displayName: 'Han Jiwoo',
    });
    await appendRegisterProfile(pool, {
      workspaceId,
      projectId,
      entityId: entityA,
      expectedVersion: 0,
      payload: { formality: 'measured' },
    });
    await appendRegisterProfile(pool, {
      workspaceId,
      projectId,
      entityId: entityA,
      expectedVersion: 1,
      payload: { formality: 'clipped' },
    });
    // b is untouched by a's versions: the unique key is per entity, not per project.
    const first = await appendRegisterProfile(pool, {
      workspaceId,
      projectId,
      entityId: entityB,
      expectedVersion: 0,
      payload: { formality: 'warm' },
    });
    expect(first.version).toBe(1);
  });

  it('records directions with their authored language and lists them deterministically', async () => {
    await createDirection(pool, {
      workspaceId,
      projectId,
      text: 'Keep the rival alive through the arc.',
      scopeLevel: 'arc',
    });
    await createDirection(pool, {
      workspaceId,
      projectId,
      // Operator instructions may be authored in any language; only manuscript prose is English-only.
      text: '라이벌을 아크 내내 살려두세요.',
      language: 'ko',
      scopeLevel: 'arc',
    });
    const listed = await listDirections(pool, { projectId, limit: 10 });
    expect(listed).toHaveLength(2);
    expect(listed.map((d) => d.language)).toContain('ko');
    // Ordered by id (UUIDv7, time-ordered), so a cursor page is stable.
    expect([...listed].sort((x, y) => (x.id < y.id ? -1 : 1)).map((d) => d.id)).toEqual(
      listed.map((d) => d.id),
    );
  });
});
