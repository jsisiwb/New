/**
 * P3 (ADR-0072): the runner's heartbeat reads the run's own progress signals, and a run with none for
 * longer than the threshold ends `failed` with `RUN_STUCK` and the reason; a resting run is never stuck.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  createWorkspace,
  ensureNovelRun,
  getNovelRun,
  listNovelRunEvents,
  putArtifact,
  transitionNovelRun,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import {
  collectRunProgress,
  failStuckRun,
  heartbeatOf,
  readHeartbeatFile,
  writeHeartbeatFile,
} from './run-heartbeat.js';
import { buildRunReport, renderRunReport } from './run-report.js';

const run = databaseUrl() ? describe : describe.skip;

run('run heartbeat and stuck detection (ADR-0072)', () => {
  let pool: Pool;
  let projectId: string;
  const dir = mkdtempSync(join(tmpdir(), 'yeonjae-beat-'));

  beforeAll(async () => {
    pool = await freshDatabase();
    const workspaceId = await createWorkspace(pool, 'heartbeat');
    ({ projectId } = await createProject(pool, { workspaceId, title: '심장 박동' }));
    const { artifact } = await putArtifact(pool, {
      workspaceId,
      projectId,
      step: 'intake',
      kind: 'story_intake',
      key: 'intake',
      payload: { title_working: '심장 박동' },
    });
    const { run: created } = await ensureNovelRun(pool, {
      workspaceId,
      projectId,
      intakeArtifactId: artifact.id,
      targetChapters: 3,
    });
    await transitionNovelRun(pool, { runId: created.id, to: 'producing' });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports progress from the run’s own rows and writes the status file atomically', async () => {
    const progress = await collectRunProgress(pool, projectId);
    expect(progress.run_status).toBe('producing');
    expect(progress.llm_calls).toBe(0);
    expect(progress.last_event?.kind).toBe('run.producing');
    expect(progress.progress_at).toBeDefined();

    const live = heartbeatOf(progress, new Date(), { pid: 42, stuckAfterMs: 60_000 });
    expect(live.stuck).toBe(false);
    const path = join(dir, 'status.json');
    writeHeartbeatFile(path, live);
    expect(readHeartbeatFile(path)?.beat_at).toBe(live.beat_at);

    const report = await buildRunReport(pool, projectId, { heartbeat: live });
    expect(renderRunReport(report)).toMatch(/- Heartbeat: .*\(pid 42\); idle \d+ s of 60 s; live/);
  });

  it('fails an active run with no progress past the threshold, with the reason', async () => {
    const progress = await collectRunProgress(pool, projectId);
    const later = new Date(Date.parse(progress.progress_at ?? '') + 61_000);
    const beat = heartbeatOf(progress, later, { pid: 42, stuckAfterMs: 60_000 });
    expect(beat.stuck).toBe(true);
    expect(beat.reason).toMatch(/no call, step or event for 1 min \(threshold 1 min\)/);

    expect(await failStuckRun(pool, projectId, beat)).toBe(true);
    const after = await getNovelRun(pool, projectId);
    expect(after?.status).toBe('failed');
    expect(after?.last_error).toMatchObject({ code: 'RUN_STUCK' });
    const events = await listNovelRunEvents(pool, after?.id ?? '', 0, 50);
    expect(events.map((e) => e.kind)).toContain('run.stuck');

    // A run that is no longer active is not stuck, and failing it again changes nothing.
    const rest = heartbeatOf(
      await collectRunProgress(pool, projectId),
      new Date(Date.now() + 86_400_000),
      {
        pid: 42,
        stuckAfterMs: 60_000,
      },
    );
    expect(rest.stuck).toBe(false);
    expect(await failStuckRun(pool, projectId, beat)).toBe(false);
  });
});
