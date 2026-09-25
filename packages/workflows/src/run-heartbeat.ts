/**
 * Heartbeat and stuck detection for unattended runs (ADR-0072, P3).
 *
 * A live Notion run spends minutes to hours inside single calls, and nothing outside the process said
 * whether it was still working: the audit row of a call is written when the call ends. The runner now
 * writes a small status file on an interval — the run's status, the step in flight, the last recorded
 * call, step and event, and how long it has been since any of them moved — and `quality:run-report`
 * reads it. When nothing has moved for longer than the stuck threshold, the run is failed with
 * `RUN_STUCK` and the reason, instead of looking busy forever.
 *
 * Everything here reads rows the run already writes; the only write is the `failed` transition.
 */
import { renameSync, readFileSync, writeFileSync } from 'node:fs';
import { getNovelRun, transitionNovelRun, type Pool } from '@yeonjae/db';

export interface RunProgress {
  readonly project_id: string;
  readonly run_status: string | undefined;
  readonly next_chapter: number | undefined;
  readonly accepted_chapters: number;
  readonly llm_calls: number;
  readonly failed_calls: number;
  readonly last_call:
    { readonly role: string; readonly status: string; readonly at: string } | undefined;
  readonly last_step:
    { readonly step: string; readonly status: string; readonly at: string } | undefined;
  readonly last_event: { readonly kind: string; readonly at: string } | undefined;
  /** The newest step still `running`: the work in flight. */
  readonly running_step: { readonly step: string; readonly since: string } | undefined;
  /** The newest of the call, step, event and run-row timestamps: the last sign of progress. */
  readonly progress_at: string | undefined;
}

export interface Heartbeat extends RunProgress {
  readonly beat_at: string;
  readonly pid: number;
  readonly idle_seconds: number | undefined;
  readonly stuck_after_seconds: number;
  readonly stuck: boolean;
  /** Why the run was failed as stuck, when it was. */
  readonly reason?: string | undefined;
}

/**
 * Default stuck threshold: longer than the slowest single call a policy allows on the Notion bridge —
 * six attempts at the adapter's 1,260 s deadline plus the policy's backoff (~138 min) — so a slow but
 * live call is never mistaken for a stuck run.
 */
export const DEFAULT_STUCK_AFTER_MS = 150 * 60_000;

const iso = (d: Date | string | null | undefined): string | undefined =>
  d ? new Date(d).toISOString() : undefined;

/** Read the run's progress signals. Read only. */
export async function collectRunProgress(pool: Pool, projectId: string): Promise<RunProgress> {
  const run = await getNovelRun(pool, projectId);
  const [calls, lastCall, lastStep, running, chapters, lastEvent] = await Promise.all([
    pool.query<{ n: string; failed: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE status <> 'succeeded')::text AS failed
         FROM llm_calls WHERE project_id = $1`,
      [projectId],
    ),
    pool.query<{ role: string; status: string; created_at: Date }>(
      `SELECT role, status, created_at FROM llm_calls WHERE project_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    ),
    pool.query<{ step: string; status: string; at: Date }>(
      `SELECT s.step, s.status, coalesce(s.completed_at, s.started_at) AS at
         FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE j.project_id = $1 ORDER BY coalesce(s.completed_at, s.started_at) DESC LIMIT 1`,
      [projectId],
    ),
    pool.query<{ step: string; started_at: Date }>(
      `SELECT s.step, s.started_at FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE j.project_id = $1 AND s.status = 'running' ORDER BY s.started_at DESC LIMIT 1`,
      [projectId],
    ),
    pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chapters WHERE project_id = $1 AND status = 'accepted'`,
      [projectId],
    ),
    run
      ? pool.query<{ kind: string; created_at: Date }>(
          `SELECT kind, created_at FROM novel_run_events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1`,
          [run.id],
        )
      : Promise.resolve({ rows: [] as { kind: string; created_at: Date }[] }),
  ]);
  const call = lastCall.rows[0];
  const step = lastStep.rows[0];
  const event = lastEvent.rows[0];
  const inFlight = running.rows[0];
  const stamps = [call?.created_at, step?.at, event?.created_at, run?.updated_at]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return {
    project_id: projectId,
    run_status: run?.status,
    next_chapter: run?.next_chapter,
    accepted_chapters: Number(chapters.rows[0]?.n ?? '0'),
    llm_calls: Number(calls.rows[0]?.n ?? '0'),
    failed_calls: Number(calls.rows[0]?.failed ?? '0'),
    last_call: call
      ? { role: call.role, status: call.status, at: iso(call.created_at) ?? '' }
      : undefined,
    last_step: step ? { step: step.step, status: step.status, at: iso(step.at) ?? '' } : undefined,
    last_event: event ? { kind: event.kind, at: iso(event.created_at) ?? '' } : undefined,
    running_step: inFlight
      ? { step: inFlight.step, since: iso(inFlight.started_at) ?? '' }
      : undefined,
    progress_at: stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : undefined,
  };
}

/** Only a run the runner is driving can be stuck; a resting run is idle by design. */
const ACTIVE = new Set(['planning', 'producing', 'suggesting']);

export function heartbeatOf(
  progress: RunProgress,
  now: Date,
  opts: { readonly pid: number; readonly stuckAfterMs?: number | undefined },
): Heartbeat {
  const stuckAfterMs = opts.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const idleMs = progress.progress_at
    ? Math.max(0, now.getTime() - new Date(progress.progress_at).getTime())
    : undefined;
  const stuck =
    ACTIVE.has(progress.run_status ?? '') && idleMs !== undefined && idleMs > stuckAfterMs;
  return {
    ...progress,
    beat_at: now.toISOString(),
    pid: opts.pid,
    idle_seconds: idleMs === undefined ? undefined : Math.round(idleMs / 1000),
    stuck_after_seconds: Math.round(stuckAfterMs / 1000),
    stuck,
    ...(stuck
      ? {
          reason: `no call, step or event for ${String(Math.round(idleMs / 60_000))} min (threshold ${String(Math.round(stuckAfterMs / 60_000))} min)${progress.running_step ? `; in flight: ${progress.running_step.step} since ${progress.running_step.since}` : ''}`,
        }
      : {}),
  };
}

/** Write the status file atomically (temp file + rename), so a reader never sees half a beat. */
export function writeHeartbeatFile(path: string, beat: Heartbeat): void {
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(beat, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readHeartbeatFile(path: string): Heartbeat | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Heartbeat;
  } catch {
    return undefined;
  }
}

/**
 * Fail a stuck run with `RUN_STUCK` and the reason. Conditional on the run still being active, so a run
 * that moved on (or an operator's pause) in the meantime is left alone. Returns whether it applied.
 */
export async function failStuckRun(
  pool: Pool,
  projectId: string,
  beat: Heartbeat,
): Promise<boolean> {
  const run = await getNovelRun(pool, projectId);
  if (!run) return false;
  const { applied } = await transitionNovelRun(pool, {
    runId: run.id,
    to: 'failed',
    expectFrom: ['planning', 'producing', 'suggesting'],
    patch: {
      lastError: {
        code: 'RUN_STUCK',
        message: beat.reason ?? 'no progress',
        idle_seconds: beat.idle_seconds ?? null,
        running_step: beat.running_step?.step ?? null,
      },
    },
    event: { kind: 'run.stuck', payload: { reason: beat.reason ?? 'no progress' } },
  });
  return applied;
}
