/**
 * B-4-2 workflow/database half of the deterministic chaos matrix, on real PostgreSQL 16 with replayed
 * model calls only.
 *
 * B-6-2's `recovery.integration.test.ts` already covers failure at each pre-commit step, budget denial,
 * malformed output, in-transaction canon rejection, the ambiguous post-commit case and cross-project
 * isolation. This suite adds the scenarios B-4-2 names that were NOT yet covered, and records every
 * scenario — its own and the ones it re-verifies here — into the machine-readable chaos report so
 * `pnpm test:chaos` can prove the matrix actually ran.
 *
 * Nothing here is evidence that a real provider or a real production database failed over. It is evidence
 * about this system's decision logic under injected faults.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  finishJob,
  getJobByWorkflowId,
  getProject,
  listCommits,
  migrate,
  requestJobControl,
  resetDatabase,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { recordChaosScenarios, type ChaosScenario } from '@yeonjae/gateway';
import { makeContext, produceChapter, workflowIdFor } from './chapter-production.js';
import { createHarness, type Harness } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const SCENARIO_INVARIANTS: Readonly<Record<string, readonly string[]>> = {
  'WF-01-crash-before-checkpoint-resumes-once': ['resume_without_duplication'],
  'WF-02-crash-after-extraction-leaves-canon-untouched': ['no_partial_canon'],
  'WF-03-duplicate-concurrent-run-yields-one-acceptance': [
    'single_acceptance',
    'single_canon_transition',
  ],
  'WF-04-pause-before-dispatch-honoured-at-step-boundary': ['control_honoured_at_boundary'],
  'WF-05-cancel-before-dispatch-honoured-at-step-boundary': ['control_honoured_at_boundary'],
  'WF-06-late-cancel-after-terminal-does-not-rewrite-history': ['terminal_state_truthful'],
  'WF-07-terminal-job-event-emitted-exactly-once': ['terminal_event_once'],
  'WF-08-replay-miss-fails-closed-without-substituting-a-draft': [
    'fail_closed',
    'no_draft_substitution',
  ],
  'WF-09-resumed-run-after-restart-reuses-recorded-spend': [
    'idempotent_after_restart',
    'no_double_charge',
  ],
  'WF-10-stale-canon-refuses-second-commit': ['single_canon_transition'],
  'WF-11-control-on-terminal-job-is-refused': ['terminal_state_truthful'],
};

const proven = new Set<string>();
function prove(...ids: readonly string[]): void {
  for (const id of ids) proven.add(id);
}

afterAll(() => {
  const scenarios: ChaosScenario[] = [...proven].map((id) => ({
    id,
    outcome: 'passed',
    invariants: SCENARIO_INVARIANTS[id] ?? [],
    surface: 'workflow',
  }));
  if (scenarios.length > 0) recordChaosScenarios(scenarios);
});

run('B-4-2 workflow and control-plane fault matrix', () => {
  let pool: Pool;
  let h: Harness;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 60_000);
  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    h = await createHarness(pool);
  }, 60_000);
  afterAll(async () => {
    await pool.end();
  });

  it('WF-01/02: a crash after extraction leaves canon untouched and resumes to exactly one commit', async () => {
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    await expect(produceChapter(deps, h.input(1, { failAfterStep: 'extract' }))).rejects.toThrow();
    // Canon is still at the bible commits: extraction precedes the atomic acceptance commit.
    const mid = await getProject(pool, h.projectId);
    expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
    const resumed = await produceChapter(deps, h.input(1));
    expect(resumed.status).toBe('completed');
    const after = await listCommits(pool, h.projectId);
    expect(after.filter((c) => c.source === 'chapter_acceptance')).toHaveLength(1);
    expect((await getProject(pool, h.projectId)).canon_version).toBe(mid.canon_version + 1);
    prove(
      'WF-01-crash-before-checkpoint-resumes-once',
      'WF-02-crash-after-extraction-leaves-canon-untouched',
    );
  }, 300_000);

  it('WF-03: two concurrent runs of the same chapter produce one acceptance and one canon transition', async () => {
    // Deterministic workflow ids mean both callers join the SAME job; the loser must not double-commit.
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    const results = await Promise.allSettled([
      produceChapter(deps, h.input(1)),
      produceChapter(deps, h.input(1)),
    ]);
    // At least one must succeed; neither may create a second acceptance.
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const accepted = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM manuscript_versions mv JOIN chapters c ON c.id = mv.chapter_id
        WHERE c.project_id = $1 AND mv.status = 'accepted'`,
      [h.projectId],
    );
    expect(accepted.rows[0]?.n).toBe('1');
    expect(
      (await listCommits(pool, h.projectId)).filter((c) => c.source === 'chapter_acceptance'),
    ).toHaveLength(1);
    prove('WF-03-duplicate-concurrent-run-yields-one-acceptance');
  }, 300_000);

  it.each([['pause'], ['cancel']] as const)(
    'WF-04/05: a %s requested before dispatch stops the run at a step boundary with no canon and no spend',
    async (control) => {
      const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
      // `makeContext` is the production path that creates/joins the chapter's job without running a step,
      // so the job exists and is NON-terminal — which is the only state an operator can actually control.
      // (Requesting control on an already-failed job is refused; that is asserted separately below.)
      await makeContext(deps, h.projectId, 1);
      const job = await getJobByWorkflowId(pool, workflowIdFor(h.projectId, 1));
      expect(job).toBeDefined();
      const outcome = await requestJobControl(pool, { jobId: job?.id ?? '', control });
      expect(outcome.applied).toBe(true);

      // The run stops at its first step boundary: JobControlStop, not a failure.
      const stopped = await produceChapter(deps, h.input(1)).catch((err: unknown) => err);
      expect((stopped as { name?: string }).name).toBe('JobControlStop');

      // Nothing was drafted, nothing was spent, and canon still holds only the bible commits.
      expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
      const versions = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1`,
        [h.projectId],
      );
      expect(versions.rows[0]?.n).toBe('0');
      const spend = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1 AND status <> 'failed'`,
        [h.projectId],
      );
      expect(spend.rows[0]?.n).toBe('0');
      prove(
        control === 'pause'
          ? 'WF-04-pause-before-dispatch-honoured-at-step-boundary'
          : 'WF-05-cancel-before-dispatch-honoured-at-step-boundary',
      );
    },
    300_000,
  );

  it('WF-11: control requested on an already-terminal job is refused rather than reopening it', async () => {
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    await expect(
      produceChapter(deps, h.input(1, { failAfterStep: 'story_spec' })),
    ).rejects.toThrow();
    const job = await getJobByWorkflowId(pool, workflowIdFor(h.projectId, 1));
    const outcome = await requestJobControl(pool, { jobId: job?.id ?? '', control: 'cancel' });
    // A failed job is terminal: cancelling it would rewrite settled history.
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('terminal');
    prove('WF-11-control-on-terminal-job-is-refused');
  }, 300_000);

  it('WF-06/07: a completed run emits exactly one terminal event and a late cancel cannot rewrite it', async () => {
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    const done = await produceChapter(deps, h.input(1));
    expect(done.status).toBe('completed');
    const terminalCount = async () =>
      Number(
        (
          await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM job_events WHERE job_id = $1 AND terminal`,
            [done.job_id],
          )
        ).rows[0]?.n ?? '0',
      );
    expect(await terminalCount()).toBe(1);
    // finishJob is idempotent about its terminal event: a second terminal attempt adds nothing.
    await finishJob(pool, { jobId: done.job_id, status: 'completed', payload: { repeat: true } });
    expect(await terminalCount()).toBe(1);
    // A late cancel must not resurrect or relabel a finished run's acceptance.
    const late = await requestJobControl(pool, { jobId: done.job_id, control: 'cancel' });
    // A terminal job refuses the control request rather than reopening: history is not retracted.
    expect(late.applied).toBe(false);
    expect(late.reason).toBe('terminal');
    const accepted = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1 AND status = 'accepted'`,
      [h.projectId],
    );
    expect(accepted.rows[0]?.n).toBe('1');
    prove(
      'WF-06-late-cancel-after-terminal-does-not-rewrite-history',
      'WF-07-terminal-job-event-emitted-exactly-once',
    );
  }, 300_000);

  it('WF-08: a genuine replay miss fails closed and never substitutes a draft', async () => {
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    const key = 'activity:scene_draft:1:1';
    const removed = h.provider.remove(key);
    expect(removed).toBeDefined();
    try {
      await expect(produceChapter(deps, h.input(1))).rejects.toMatchObject({
        code: 'MODEL_CALL_FAILED',
      });
    } finally {
      if (removed) h.provider.restore(key, removed);
    }
    // No manuscript version, no canon: the loop refused rather than inventing text.
    const versions = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM manuscript_versions WHERE project_id = $1`,
      [h.projectId],
    );
    expect(versions.rows[0]?.n).toBe('0');
    expect((await listCommits(pool, h.projectId)).every((c) => c.source === 'bible')).toBe(true);
    prove('WF-08-replay-miss-fails-closed-without-substituting-a-draft');
  }, 300_000);

  it('WF-09/10: a rerun after completion re-reads recorded spend and refuses a second canon transition', async () => {
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    const first = await produceChapter(deps, h.input(1));
    const spendBefore = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1 AND status <> 'failed'`,
      [h.projectId],
    );
    const again = await produceChapter(deps, h.input(1));
    expect(again.accepted?.canon_version).toBe(first.accepted?.canon_version);
    const spendAfter = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1 AND status <> 'failed'`,
      [h.projectId],
    );
    expect(spendAfter.rows[0]?.n).toBe(spendBefore.rows[0]?.n);
    expect(
      (await listCommits(pool, h.projectId)).filter((c) => c.source === 'chapter_acceptance'),
    ).toHaveLength(1);
    const duplicates = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (
         SELECT idempotency_key FROM llm_calls WHERE project_id = $1 AND status <> 'failed'
          GROUP BY idempotency_key HAVING count(*) > 1) d`,
      [h.projectId],
    );
    expect(duplicates.rows[0]?.n).toBe('0');
    prove(
      'WF-09-resumed-run-after-restart-reuses-recorded-spend',
      'WF-10-stale-canon-refuses-second-commit',
    );
  }, 300_000);
});
