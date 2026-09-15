/**
 * B-6-2 failure recovery on Postgres + ReplayProvider (NFR-B, ADR-0046): the loop must fail closed at every
 * stage, leave no partial canon, resume without re-spending, and bump exactly once.
 *
 * Each test resets the database: the fixture's ids are deterministic global primary keys, and gateway calls
 * are idempotent by (workflow, activity) key, so a fresh project is what isolates one failure scenario from
 * the next (ADR-0046). Every model call is replayed — no credentials, no live provider, no spend.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getProject, listCommits, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { produceChapter, workflowIdFor, workflowStatus } from './chapter-production.js';
import { WorkflowError } from './errors.js';
import { createHarness, type Harness } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

/** Steps whose failure must never leave canon, an accepted version or a commit behind. */
const PRE_COMMIT_STEPS = [
  'story_spec',
  'chapter_contract',
  'scene_plan',
  'scene_draft',
  'assemble',
  'evaluate',
  'revise',
  'approve',
] as const;

async function counts(pool: Pool, projectId: string) {
  const q = async (sql: string) =>
    Number((await pool.query<{ n: string }>(sql, [projectId])).rows[0]?.n ?? '0');
  return {
    llmCalls: await q('SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1'),
    versions: await q('SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1'),
    accepted: await q(
      `SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1 AND status = 'accepted'`,
    ),
    commits: await q('SELECT count(*)::text AS n FROM canon_commits WHERE project_id = $1'),
    facts: await q('SELECT count(*)::text AS n FROM facts WHERE project_id = $1'),
    summaries: await q('SELECT count(*)::text AS n FROM summaries WHERE project_id = $1'),
    searchDocs: await q('SELECT count(*)::text AS n FROM search_documents WHERE project_id = $1'),
  };
}

run('failure recovery and resume (B-6-2, NFR-B)', () => {
  let pool: Pool;
  let h: Harness;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 60_000);
  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    h = await createHarness(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it.each(PRE_COMMIT_STEPS)(
    'a failure after %s leaves no canon commit, no accepted version and no index',
    async (step) => {
      const err = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1, { failAfterStep: step }),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkflowError);

      const after = await counts(pool, h.projectId);
      // The bible commits before drafting, so two commits are legitimate; a chapter acceptance is not.
      const commits = await listCommits(pool, h.projectId);
      expect(commits.every((c) => c.source === 'bible')).toBe(true);
      expect(after.accepted).toBe(0);
      expect(after.summaries).toBe(0);
      expect(after.searchDocs).toBe(0);
      const project = await getProject(pool, h.projectId);
      expect(project.canon_version).toBe(commits.length);

      const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
      expect(status.status).toBe('failed');
      // The persisted error names the step an operator has to act on, never a bare stack trace.
      const persisted = status.error as { code?: unknown; step?: unknown };
      expect(typeof persisted.code).toBe('string');
      expect(persisted.step).toBe(step);
    },
    120_000,
  );

  it.each(['scene_draft', 'evaluate', 'approve'] as const)(
    'resuming after a failure at %s completes and re-spends nothing already spent',
    async (step) => {
      const first = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1, { failAfterStep: step }),
      ).catch((e: unknown) => e);
      expect(first).toBeInstanceOf(WorkflowError);
      const before = await counts(pool, h.projectId);
      const status1 = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
      const completedBefore = status1.steps
        .filter((s) => s.status === 'completed')
        .map((s) => s.step);

      const second = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1),
      );
      expect(second.status).toBe('completed');

      // Every step completed before the failure is replayed, not re-run.
      const replayed = second.steps.filter((s) => s.status === 'replayed').map((s) => s.step);
      for (const s of completedBefore) expect(replayed).toContain(s);

      const after = await counts(pool, h.projectId);
      // Exactly one acceptance, one summary, one chapter commit — the bump happened once.
      expect(after.accepted).toBe(1);
      expect(after.summaries).toBe(1);
      const commits = await listCommits(pool, h.projectId);
      expect(commits.filter((c) => c.source === 'chapter_acceptance')).toHaveLength(1);
      // Resume adds only the calls the remaining steps need; the replayed ones are never re-spent.
      expect(after.llmCalls).toBeGreaterThanOrEqual(before.llmCalls);
      const secondResume = await produceChapter(
        { pool, gateway: h.gateway(), bindings: h.bindings },
        h.input(1),
      );
      expect(secondResume.status).toBe('completed');
      const afterIdempotent = await counts(pool, h.projectId);
      // A third run is a pure replay: no new spend, no new version, no second commit.
      expect(afterIdempotent.llmCalls).toBe(after.llmCalls);
      expect(afterIdempotent.versions).toBe(after.versions);
      expect(afterIdempotent.commits).toBe(after.commits);
      expect(afterIdempotent.facts).toBe(after.facts);
    },
    180_000,
  );

  it('a racing canon commit between extraction and acceptance fails with CANON_STALE and commits nothing', async () => {
    // Extraction pins base_canon_version. Interrupt after it, then let another writer advance canon —
    // exactly the optimistic-version race the commit function guards (STALE_CANON → CANON_STALE).
    const interrupted = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1, { failAfterStep: 'extract' }),
    ).catch((e: unknown) => e);
    expect(interrupted).toBeInstanceOf(WorkflowError);
    const beforeRace = await counts(pool, h.projectId);
    expect(beforeRace.accepted).toBe(0);

    const project = await getProject(pool, h.projectId);
    const raced = project.canon_version + 1;
    await pool.query('UPDATE projects SET canon_version = $2 WHERE id = $1', [h.projectId, raced]);

    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    expect(wf.code).toBe('CANON_STALE');
    expect(wf.options.step).toBe('accept');
    // Actionable, not a bare failure: the operator is told to revalidate and retry.
    expect(wf.options.recommendedActions).toContain('revalidate_contract');
    expect(wf.options.recommendedActions).toContain('retry_step');

    // Nothing was half-committed: no chapter acceptance, no accepted version, no summary or index.
    const after = await counts(pool, h.projectId);
    expect(after.accepted).toBe(0);
    expect(after.summaries).toBe(0);
    expect(after.searchDocs).toBe(0);
    expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
    expect((await getProject(pool, h.projectId)).canon_version).toBe(raced);
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    expect(status.status).toBe('failed');
    expect(status.error).toMatchObject({ code: 'CANON_STALE' });
  }, 180_000);

  it('a provider fault fails the step closed and never substitutes a draft', async () => {
    // A recording the provider does not have is the replay equivalent of a provider outage: the step must
    // fail with an actionable MODEL_CALL_FAILED rather than inventing text or calling a live provider.
    h.provider.override({
      'activity:scene_draft:1:2': { text: undefined, json: undefined },
    });
    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    const wf = err as WorkflowError;
    expect(wf.code).toBe('MODEL_CALL_FAILED');
    expect(wf.options.step).toBe('scene_draft');
    const after = await counts(pool, h.projectId);
    expect(after.versions).toBe(0);
    expect(after.accepted).toBe(0);
    expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
  }, 120_000);

  it('a blocked approval leaves the chapter working and reports needs_attention, not failed', async () => {
    // The evaluator keeps reporting a major prose issue, so the single revision round cannot clear it.
    h.provider.alias('activity:prose_judge:1:r1', 'variant:prose_judge:1:r1:still_failing');
    const err = await produceChapter(
      { pool, gateway: h.gateway(), bindings: h.bindings },
      h.input(1),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkflowError);
    expect((err as WorkflowError).code).toBe('APPROVAL_BLOCKED');
    const status = await workflowStatus(pool, workflowIdFor(h.projectId, 1));
    // A quality gate is an attention state for a human, not an engineering failure.
    expect(status.status).toBe('needs_attention');
    const after = await counts(pool, h.projectId);
    expect(after.accepted).toBe(0);
    expect(after.summaries).toBe(0);
  }, 120_000);
});
