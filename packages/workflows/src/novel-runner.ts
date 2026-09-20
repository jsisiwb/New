/**
 * The novel runner: a Postgres-queued loop that drives `novel_runs` without requiring Temporal.
 *
 * WHY A SECOND ORCHESTRATOR SHAPE. The Temporal path (Checkpoint 7) is the durable, multi-worker chapter
 * orchestrator and stays as is. But the product's first job is "an operator enters a premise and gets a
 * novel", and requiring a Temporal cluster before a single chapter can be written is the reason the
 * product was not usable end to end. This runner uses the same checkpointed `produceChapter` and the same
 * `jobs`/`job_steps` idempotency, so it forfeits none of the invariants; it only replaces the scheduler
 * with a fenced claim on the run row (`canon.claim_novel_run`, migration 0019).
 *
 * Several runner processes may poll the same database: each claim hands a run to exactly one of them,
 * the lease is renewed on a heartbeat while work is in flight, and a runner whose renewal is refused
 * stops before its next durable step.
 */
import {
  claimNovelRun,
  emitNovelRunEvent,
  NOVEL_RUN_LEASE_SECONDS,
  releaseNovelRun,
  renewNovelRun,
  type NovelRunLease,
  type NovelRunRow,
  type Pool,
} from '@yeonjae/db';
import { type ChapterProductionDeps } from './chapter-production.js';
import { advanceNovelRun, type NovelDeps } from './novel.js';

export interface NovelRunnerOptions {
  readonly pool: Pool;
  readonly makeDeps: (input: { workspaceId: string; projectId: string }) => ChapterProductionDeps;
  /** Called by `wake()`; lets an API process nudge the loop instead of waiting a poll interval. */
  readonly runnerId: string;
  readonly pollMs?: number | undefined;
  readonly leaseSeconds?: number | undefined;
  /** Injected for tests; defaults to setTimeout-based sleeping. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly onError?: ((err: unknown) => void) | undefined;
}

export class NovelRunner {
  private readonly state = { stopping: false };
  // Read through a method so each check is a fresh read; TS narrows a plain field after one test.
  private isStopping(): boolean {
    return this.state.stopping;
  }
  private stopped: Promise<void> = Promise.resolve();
  private resolveStopped: () => void = () => undefined;

  constructor(private readonly opts: NovelRunnerOptions) {}

  /** Claim and advance one run. Returns false when nothing was claimable. Exposed for tests. */
  async tick(): Promise<boolean> {
    const ttl = this.opts.leaseSeconds ?? NOVEL_RUN_LEASE_SECONDS;
    const run = await claimNovelRun(this.opts.pool, this.opts.runnerId, ttl);
    if (!run) return false;
    await this.drive(run, ttl);
    return true;
  }

  /** Drive one claimed run until it rests, the lease is lost, or the runner is stopping. */
  private async drive(initial: NovelRunRow, ttl: number): Promise<void> {
    const { pool } = this.opts;
    let run = initial;
    const fence = run.runner_fence;
    const lost = { value: false };
    const heartbeat = setInterval(
      () => {
        void renewNovelRun(pool, {
          runId: run.id,
          runner: this.opts.runnerId,
          fence,
          ttlSeconds: ttl,
        })
          .then((ok) => {
            if (!ok) lost.value = true;
          })
          .catch(() => {
            // A failed renewal is indistinguishable from losing the lease. Stop before the next
            // checkpoint rather than allowing a network/database transient to run as a zombie.
            lost.value = true;
          });
      },
      Math.max(1000, (ttl * 1000) / 3),
    );
    if (typeof heartbeat.unref === 'function') heartbeat.unref();
    const deps: NovelDeps = {
      ...this.opts.makeDeps({ workspaceId: run.workspace_id, projectId: run.project_id }),
    };
    try {
      for (;;) {
        if (this.isStopping() || lost.value) break;
        const outcome = await advanceNovelRun(deps, run, {
          lease: { runner: this.opts.runnerId, fence } satisfies NovelRunLease,
          isCancelled: async () => {
            if (lost.value) return true;
            try {
              const r = await pool.query<{
                status: string;
                runner_id: string | null;
                runner_fence: string;
                lease_expires_at: Date | null;
              }>(
                `SELECT status, runner_id, runner_fence, lease_expires_at
                   FROM novel_runs
                  WHERE id = $1`,
                [run.id],
              );
              const row = r.rows[0];
              const ownsLease =
                row?.runner_id === this.opts.runnerId &&
                row.runner_fence === String(fence) &&
                row.lease_expires_at !== null &&
                row.lease_expires_at > new Date();
              if (!ownsLease) {
                lost.value = true;
                return true;
              }
              return row.status === 'cancelled' || row.status === 'paused';
            } catch {
              // Ownership cannot be proven on a failed read; fail closed.
              lost.value = true;
              return true;
            }
          },
        });
        run = outcome.run;
        if (outcome.kind === 'idle' || outcome.kind === 'stopped' || outcome.kind === 'completed')
          break;
        // `planned` and `chapter_accepted` leave the run claimable and in progress; keep going while we
        // still own it rather than paying a poll interval between every chapter.
        if (run.status !== 'producing' && run.status !== 'planning') break;
      }
    } catch (err) {
      // A fenced-out worker must not append progress after another worker owns the run.
      if (!lost.value)
        await emitNovelRunEvent(pool, {
          runId: run.id,
          kind: 'runner.error',
          payload: { message: err instanceof Error ? err.name : 'error' },
          lease: { runner: this.opts.runnerId, fence },
        }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      if (!lost.value)
        await releaseNovelRun(pool, { runId: run.id, runner: this.opts.runnerId, fence }).catch(
          () => undefined,
        );
    }
  }

  private wakeUp: (() => void) | undefined;

  /** Cut the current poll sleep short (a run was just queued). Safe to call at any time. */
  wake(): void {
    this.wakeUp?.();
  }

  start(): void {
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });
    const sleep =
      this.opts.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            this.wakeUp = undefined;
            resolve();
          }, ms);
          if (typeof t.unref === 'function') t.unref();
          this.wakeUp = () => {
            clearTimeout(t);
            this.wakeUp = undefined;
            resolve();
          };
        }));
    void (async () => {
      while (!this.isStopping()) {
        let worked = false;
        try {
          worked = await this.tick();
        } catch (err) {
          this.opts.onError?.(err);
        }
        if (!worked && !this.isStopping()) await sleep(this.opts.pollMs ?? 3000);
      }
      this.resolveStopped();
    })();
  }

  async stop(): Promise<void> {
    this.state.stopping = true;
    this.wake();
    await this.stopped;
  }
}
