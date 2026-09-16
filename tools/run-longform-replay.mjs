#!/usr/bin/env node
/**
 * `pnpm test:replay-120` — the explicit entry point for the deterministic 120-chapter continuity/replay
 * validation (B-4-1, deterministic portion).
 *
 * It exists so the suite cannot pass by not running. Vitest is happy to report success for a suite that
 * skipped itself, was filtered away by a stale path, or was quietly shortened; none of those are evidence
 * that 120 chapters executed. This wrapper therefore:
 *
 *   1. refuses to start without DATABASE_URL (the suite skips without it, and a skip must not look green);
 *   2. runs the suite;
 *   3. reads the completion evidence the suite writes and fails unless it records a full 120-chapter run
 *      with zero replay misses and zero live provider calls.
 *
 * It makes no provider call and needs no credentials.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const EVIDENCE_PATH = 'coverage/longform-replay-evidence.json';
const SUITE = 'packages/workflows/src/longform-replay.integration.test.ts';
const EXPECTED_CHAPTERS = 120;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
  fail(
    'the 120-chapter replay validation requires a PostgreSQL 16 DATABASE_URL; ' +
      'without it the suite skips, and a skipped suite is not evidence that it ran',
  );

// A stale evidence file from an earlier run must never be mistaken for this run's result.
rmSync(EVIDENCE_PATH, { force: true });

const result = spawnSync('npx', ['vitest', 'run', SUITE], {
  stdio: 'inherit',
  env: { ...process.env, CI: process.env.CI ?? 'true' },
});
if (result.status !== 0)
  fail(`the 120-chapter replay suite failed (exit ${String(result.status)})`);

if (!existsSync(EVIDENCE_PATH))
  fail(
    `the 120-chapter replay suite reported success but wrote no completion evidence to ${EVIDENCE_PATH}; ` +
      'it was skipped or filtered out rather than executed',
  );

let evidence;
try {
  evidence = JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
} catch (err) {
  fail(`completion evidence at ${EVIDENCE_PATH} is unreadable: ${String(err)}`);
}

const problems = [];
if (evidence.chapters_completed !== EXPECTED_CHAPTERS)
  problems.push(
    `only ${String(evidence.chapters_completed)} of ${String(EXPECTED_CHAPTERS)} chapters completed`,
  );
if (evidence.accepted_manuscript_versions !== EXPECTED_CHAPTERS)
  problems.push(
    `${String(evidence.accepted_manuscript_versions)} accepted manuscripts, expected ${String(EXPECTED_CHAPTERS)}`,
  );
if (evidence.replay_misses !== 0)
  problems.push(
    `${String(evidence.replay_misses)} replay miss(es): a live call would have been needed`,
  );
if (evidence.live_provider_calls !== 0)
  problems.push(`${String(evidence.live_provider_calls)} live provider call(s) recorded`);
if (evidence.database_url_present !== true) problems.push('the suite ran without a DATABASE_URL');
if (problems.length > 0)
  fail(`120-chapter replay evidence is not acceptable: ${problems.join('; ')}`);

console.log(
  `120-chapter deterministic replay verified: ${String(evidence.chapters_completed)} chapters accepted, ` +
    `final canon version ${String(evidence.final_canon_version)}, ` +
    `${(Number(evidence.elapsed_ms) / 1000).toFixed(1)}s, no live provider call.`,
);
