#!/usr/bin/env node
/**
 * `pnpm test:chaos` — the explicit entry point for the deterministic chaos and provider-fallback drills
 * (B-4-2).
 *
 * Like the 120-chapter runner, this exists so the suite cannot pass by not running. It executes the
 * gateway fault matrix and the workflow recovery matrix, then reads the machine-readable chaos report the
 * suites emit and fails unless every declared scenario actually reported a result.
 *
 * The report carries scenario ids, outcomes and the invariants they cover. It never carries manuscript
 * prose, prompts, provider payloads or credentials — the suites assert that too.
 *
 * DATABASE_URL is required: the workflow half of the matrix runs against real PostgreSQL 16, and a
 * silently skipped integration suite is not evidence.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const REPORT_PATH = 'coverage/chaos-report.json';
const SUITES = [
  'packages/gateway/src/failures.test.ts',
  'packages/gateway/src/fallback.chaos.test.ts',
  'packages/workflows/src/recovery.integration.test.ts',
  'packages/workflows/src/chaos.integration.test.ts',
  // Phase 4: active provider-request cancellation. Listed here because a cancellation that fails to
  // reach a running request is a fault of exactly the kind this matrix exists to catch, and because the
  // report is the only durable evidence that the races were exercised rather than merely described.
  'packages/gateway/src/cancellation.test.ts',
  'apps/worker/src/active-cancellation.integration.test.ts',
];
/** Minimum scenario count. Lowering this is a deliberate, reviewable act, not an accident. */
const MIN_SCENARIOS = 46;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
  fail(
    'the chaos and fallback drills require a PostgreSQL 16 DATABASE_URL; without it the workflow half ' +
      'of the matrix skips, and a skipped suite is not evidence that it ran',
  );

rmSync(REPORT_PATH, { force: true });

const result = spawnSync('npx', ['vitest', 'run', ...SUITES], {
  stdio: 'inherit',
  env: { ...process.env, CI: process.env.CI ?? 'true', YEONJAE_CHAOS_REPORT: REPORT_PATH },
});
if (result.status !== 0) fail(`the chaos drills failed (exit ${String(result.status)})`);

if (!existsSync(REPORT_PATH))
  fail(
    `the chaos drills reported success but wrote no report to ${REPORT_PATH}; they were skipped or ` +
      'filtered out rather than executed',
  );

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (err) {
  fail(`the chaos report at ${REPORT_PATH} is unreadable: ${String(err)}`);
}

const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
const problems = [];
if (scenarios.length < MIN_SCENARIOS)
  problems.push(
    `only ${String(scenarios.length)} scenarios reported, expected ≥ ${String(MIN_SCENARIOS)}`,
  );
const notPassed = scenarios.filter((s) => s.outcome !== 'passed');
if (notPassed.length > 0)
  problems.push(`scenarios did not pass: ${notPassed.map((s) => String(s.id)).join(', ')}`);
const ids = scenarios.map((s) => String(s.id));
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length > 0) problems.push(`duplicate scenario ids: ${duplicates.join(', ')}`);
if (report.live_provider_calls !== 0)
  problems.push(`${String(report.live_provider_calls)} live provider call(s) recorded`);

// The report is published evidence, so it must not carry prose, prompts or anything secret-shaped.
const serialized = JSON.stringify(report);
for (const [label, pattern] of [
  ['an API-key-shaped string', /\b(sk|pk)-[A-Za-z0-9]{8,}/],
  ['a bearer token', /bearer\s+[A-Za-z0-9._-]{12,}/i],
  ['a private key block', /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/],
]) {
  if (pattern.test(serialized)) problems.push(`the chaos report contains ${label}`);
}

if (problems.length > 0) fail(`chaos report is not acceptable: ${problems.join('; ')}`);

console.log(
  `chaos and fallback drills verified: ${String(scenarios.length)} deterministic scenarios passed, ` +
    'no live provider call.',
);
