/** Entry point for the Postgres-queued novel runner (no Temporal required). */
import { runNovelRunnerProcess } from './novel-runner.js';

await runNovelRunnerProcess();
