#!/usr/bin/env node
/**
 * `pnpm test:costs` — the explicit entry point for deterministic cost accounting (B-4-6).
 *
 * Same shape and same reason as the replay, chaos, restore and security runners: a suite that can pass by
 * not running is not evidence. It runs the cost suites and then verifies the suite's OWN durable report
 * rather than coverage/junit.xml, which every later vitest invocation overwrites (defect D-4).
 *
 * The evidence is SYNTHETIC. Every monetary value comes from a fixture served by the replay or mock
 * provider; no live call is made and no price table is consulted. The guard below fails if the report
 * ever claims real billing calibration, because that claim would need a provider invoice this system
 * does not observe.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const REPORT_PATH = 'coverage/cost-report.json';
const SUITES = [
  'packages/db/src/cost-accounting.integration.test.ts',
  'packages/db/src/audit.integration.test.ts',
];
/** Every scenario the suite must report. Shortening this list is a deliberate, reviewable act. */
const REQUIRED_SCENARIOS = [
  'COST-first-attempt-success',
  'COST-retry-then-success',
  'COST-fallback-then-success',
  'COST-all-routes-fail',
  'COST-cancel-and-budget-denial',
  'COST-replay-no-double-charge',
  'COST-partial-and-unknown-usage',
  'COST-aggregation-dimensions',
  'COST-time-window-filtering',
  'COST-tenant-isolation',
  'COST-integer-arithmetic',
  'COST-attribution-mismatch-detected',
  'COST-dimensions-carry-no-secrets',
];

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
  fail(
    'the deterministic cost suite requires a PostgreSQL 16 DATABASE_URL; the accounting is read back ' +
      'out of the real append-only audit, and a skipped suite is not evidence',
  );

rmSync(REPORT_PATH, { force: true });

const result = spawnSync('npx', ['vitest', 'run', ...SUITES], {
  stdio: 'inherit',
  env: { ...process.env, CI: process.env.CI ?? 'true', YEONJAE_COST_REPORT: REPORT_PATH },
});
if (result.status !== 0)
  fail(`the deterministic cost suite failed (exit ${String(result.status)})`);

if (!existsSync(REPORT_PATH))
  fail(
    `the cost suite reported success but wrote no report to ${REPORT_PATH}; it was skipped or ` +
      'filtered out rather than executed',
  );

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (err) {
  fail(`the cost report at ${REPORT_PATH} is unreadable: ${String(err)}`);
}

const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
const problems = [];
const reported = new Map(scenarios.map((s) => [String(s.id), String(s.outcome)]));
for (const id of REQUIRED_SCENARIOS) {
  const outcome = reported.get(id);
  if (outcome === undefined) problems.push(`scenario ${id} was not reported`);
  else if (outcome !== 'passed') problems.push(`scenario ${id} reported ${outcome}`);
}
const ids = scenarios.map((s) => String(s.id));
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length > 0) problems.push(`duplicate scenario ids: ${duplicates.join(', ')}`);

// Truthfulness of the artifact itself.
if (report.basis !== 'synthetic_replay')
  problems.push(
    `unexpected cost basis ${String(report.basis)}; this suite produces synthetic_replay`,
  );
if (report.real_billing_calibrated !== false)
  problems.push(
    'the report claims real billing calibration, which requires a provider invoice this system does ' +
      'not observe',
  );
if (report.live_provider_calls !== 0)
  problems.push(`${String(report.live_provider_calls)} live provider call(s) recorded`);
if (report.currency !== 'USD' || report.unit !== 'cents')
  problems.push('the report does not state its currency and unit explicitly');

const serialized = JSON.stringify(report);
for (const [label, pattern] of [
  ['an API-key-shaped string', /\b(sk|pk)-[A-Za-z0-9]{8,}/],
  ['a bearer token', /bearer\s+[A-Za-z0-9._-]{12,}/i],
  ['a connection URL', /postgres(ql)?:\/\//],
]) {
  if (pattern.test(serialized)) problems.push(`the cost report contains ${label}`);
}

if (problems.length > 0) fail(`cost report is not acceptable: ${problems.join('; ')}`);

console.log(
  `deterministic cost accounting verified: ${String(scenarios.length)} scenarios passed, basis ` +
    `${String(report.basis)} (${String(report.currency)} ${String(report.unit)}), no live provider ` +
    'call. Synthetic/replay evidence — not real billing calibration.',
);
