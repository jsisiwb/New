/**
 * Process entry for the Postgres-queued novel runner (`pnpm --filter @yeonjae/worker start:novel`).
 *
 * Same startup discipline as the Temporal worker: provider mode and shared enforcement are validated
 * before any work is claimed, and shutdown drains through the lifecycle coordinator.
 */
import { EXIT_CODE, LifecycleCoordinator, Metrics } from '@yeonjae/domain';
import { configFromEnv, createPool } from '@yeonjae/db';
import { NovelRunner } from '@yeonjae/workflows';
import {
  assertSharedEnforcementAvailable,
  enforcementModeFromEnv,
  productionDeps,
} from './deps.js';
import { startWorkerHealthServer } from './health.js';

/** Process entry point: `pnpm --filter @yeonjae/worker start:novel`. */
export async function runNovelRunnerProcess(): Promise<void> {
  const pool = createPool(configFromEnv());
  const enforcement = enforcementModeFromEnv();
  const metrics = new Metrics();
  const lifecycle = new LifecycleCoordinator({
    deadlineMs: Number(process.env.YEONJAE_DRAIN_DEADLINE_MS ?? '30000'),
    telemetryFlushMs: Number(process.env.YEONJAE_TELEMETRY_FLUSH_MS ?? '2000'),
    metrics,
  });
  if (enforcement === 'shared') {
    try {
      await assertSharedEnforcementAvailable(pool);
    } catch (err) {
      await pool.end();
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_CODE.configuration_failure);
    }
  }
  const makeDeps = productionDeps(pool, { enforcement, metrics });
  const runner = new NovelRunner({
    pool,
    makeDeps,
    runnerId: `novel-runner:${process.env.YEONJAE_WORKER_ID ?? String(process.pid)}`,
    pollMs: Number(process.env.YEONJAE_NOVEL_POLL_MS ?? '3000'),
    onError: (err) => {
      console.error(err instanceof Error ? err.message : String(err));
    },
  });
  const onSignal = (): void => {
    void lifecycle.drain().then((result) => {
      process.exitCode = result.exitCode;
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const health = await startWorkerHealthServer({
    pool,
    lifecycle,
    port: Number(process.env.YEONJAE_WORKER_HEALTH_PORT ?? '0'),
  });
  lifecycle.register({ name: 'health', close: () => health.close() });
  lifecycle.register({ name: 'runner', close: () => runner.stop() });
  lifecycle.register({
    name: 'pool',
    close: async () => {
      await pool.end();
    },
  });
  runner.start();
  lifecycle.markRunning();
}
