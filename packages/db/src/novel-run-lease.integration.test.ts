import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  createWorkspace,
  emitNovelRunEvent,
  getNovelRun,
  listNovelRunEvents,
  transitionNovelRun,
  type Pool,
} from './index.js';
import { databaseUrl, freshDatabase } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

run('novel run lifecycle fencing', () => {
  let pool: Pool;
  let projectId: string;
  let runId: string;

  beforeAll(async () => {
    pool = await freshDatabase();
    const workspaceId = await createWorkspace(pool, 'novel-run-fence');
    ({ projectId } = await createProject(pool, {
      workspaceId,
      title: 'Fenced novel',
      operatingMode: 'autopilot',
    }));
    const result = await pool.query<{ id: string }>(
      `INSERT INTO novel_runs
         (workspace_id, project_id, status, target_chapters, runner_id, runner_fence, lease_expires_at)
       VALUES ($1, $2, 'producing', 1, 'old-worker', 7, now() + interval '1 hour')
       RETURNING id`,
      [workspaceId, projectId],
    );
    runId = result.rows[0]?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('refuses stale success and failure transitions after a new owner takes the fence', async () => {
    await pool.query(
      `UPDATE novel_runs
          SET runner_id = 'new-worker', runner_fence = 8, lease_expires_at = now() + interval '1 hour'
        WHERE id = $1`,
      [runId],
    );

    const staleSuccess = await transitionNovelRun(pool, {
      runId,
      to: 'completed',
      expectFrom: ['producing'],
      lease: { runner: 'old-worker', fence: 7 },
      event: { kind: 'run.completed' },
    });
    const staleFailure = await transitionNovelRun(pool, {
      runId,
      to: 'failed',
      expectFrom: ['producing'],
      lease: { runner: 'old-worker', fence: 7 },
      event: { kind: 'run.failed' },
    });

    expect(staleSuccess.applied).toBe(false);
    expect(staleFailure.applied).toBe(false);
    expect((await getNovelRun(pool, projectId))?.status).toBe('producing');
    await expect(
      emitNovelRunEvent(pool, {
        runId,
        kind: 'runner.error',
        lease: { runner: 'old-worker', fence: 7 },
      }),
    ).rejects.toThrow(/does not exist for event emission/);
  });

  it('allows the current owner to transition and append its lifecycle event', async () => {
    await pool.query(
      `UPDATE novel_runs
          SET status = 'producing', runner_id = 'new-worker', runner_fence = 8,
              lease_expires_at = now() + interval '1 hour'
        WHERE id = $1`,
      [runId],
    );
    const result = await transitionNovelRun(pool, {
      runId,
      to: 'completed',
      expectFrom: ['producing'],
      lease: { runner: 'new-worker', fence: 8 },
      event: { kind: 'chapter.accepted', payload: { chapter_no: 1 } },
      additionalEvents: [{ kind: 'run.completed', payload: { chapters: 1 } }],
    });
    expect(result.applied).toBe(true);
    expect(result.run.status).toBe('completed');
    expect((await listNovelRunEvents(pool, runId)).map((event) => event.kind)).toEqual(
      expect.arrayContaining(['chapter.accepted', 'run.completed']),
    );
  });

  it('serializes concurrent stand-alone event emission and allocates unique sequences', async () => {
    const emitted = await Promise.all([
      emitNovelRunEvent(pool, { runId, kind: 'operator.note.one' }),
      emitNovelRunEvent(pool, { runId, kind: 'operator.note.two' }),
    ]);
    expect(new Set(emitted.map((event) => event.seq)).size).toBe(2);
    const seqs = emitted.map((event) => event.seq).sort((a, b) => a - b);
    expect(seqs[1]).toBe((seqs[0] ?? 0) + 1);
    expect((await listNovelRunEvents(pool, runId)).map((event) => event.kind)).toEqual(
      expect.arrayContaining(['operator.note.one', 'operator.note.two']),
    );
  });
});
