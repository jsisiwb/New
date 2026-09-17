#!/usr/bin/env node
/**
 * `pnpm test:security` — the explicit entry point for the defensive security suite (B-4-4).
 *
 * Same shape as the replay, chaos and restore runners, for the same reason: a suite that can pass by not
 * running is not evidence. It executes the boundary suites, then reads the suite's OWN durable report
 * rather than coverage/junit.xml, which every later vitest invocation overwrites (defect D-4).
 *
 * The suites are DEFENSIVE. They drive the application's own local test client with inert inputs and
 * assert refusal; nothing here scans, brute-forces, harvests credentials or demonstrates command
 * execution, and the guard below rejects a report that claims a surface it did not cover.
 *
 * DATABASE_URL is required: the RLS half runs against real PostgreSQL 16, and a silently skipped
 * integration suite proves nothing about tenant isolation.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const REPORT_PATH = 'coverage/security-report.json';
const SUITES = [
  'packages/db/src/rls-inventory.integration.test.ts',
  'packages/db/src/identity.integration.test.ts',
  'packages/db/src/app-role-privileges.integration.test.ts',
  'apps/api/src/security-boundaries.integration.test.ts',
  'apps/api/src/secret-boundaries.test.ts',
  'apps/api/src/server.integration.test.ts',
  'apps/api/src/cors.test.ts',
  'apps/api/src/cors.integration.test.ts',
  'apps/api/src/rate-limit.test.ts',
  'apps/api/src/rate-limit.integration.test.ts',
  'apps/api/src/observability.test.ts',
];
/** Surfaces the report must cover. Dropping one is a deliberate, reviewable act. */
const REQUIRED_SURFACES = ['rls', 'input_output', 'telemetry', 'rate_limit'];
const MIN_SCENARIOS = 16;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
  fail(
    'the defensive security suite requires a PostgreSQL 16 DATABASE_URL; without it the RLS half ' +
      'skips, and a skipped isolation suite is not evidence that tenants are isolated',
  );

rmSync(REPORT_PATH, { force: true });

const result = spawnSync('npx', ['vitest', 'run', ...SUITES], {
  stdio: 'inherit',
  env: { ...process.env, CI: process.env.CI ?? 'true', YEONJAE_SECURITY_REPORT: REPORT_PATH },
});
if (result.status !== 0)
  fail(`the defensive security suite failed (exit ${String(result.status)})`);

if (!existsSync(REPORT_PATH))
  fail(
    `the security suite reported success but wrote no report to ${REPORT_PATH}; it was skipped or ` +
      'filtered out rather than executed',
  );

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (err) {
  fail(`the security report at ${REPORT_PATH} is unreadable: ${String(err)}`);
}

const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
const problems = [];
if (scenarios.length < MIN_SCENARIOS)
  problems.push(
    `only ${String(scenarios.length)} scenarios reported, expected >= ${String(MIN_SCENARIOS)}`,
  );
const notPassed = scenarios.filter((s) => s.outcome !== 'passed');
if (notPassed.length > 0)
  problems.push(`scenarios did not pass: ${notPassed.map((s) => String(s.id)).join(', ')}`);
const ids = scenarios.map((s) => String(s.id));
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicates.length > 0) problems.push(`duplicate scenario ids: ${duplicates.join(', ')}`);
for (const surface of REQUIRED_SURFACES) {
  if (!scenarios.some((s) => s.surface === surface))
    problems.push(`no scenario covers the ${surface} surface`);
}
if (report.defensive_only !== true)
  problems.push('the report does not declare itself defensive-only');
if (report.live_provider_calls !== 0)
  problems.push(`${String(report.live_provider_calls)} live provider call(s) recorded`);

const serialized = JSON.stringify(report);
for (const [label, pattern] of [
  ['an API-key-shaped string', /\b(sk|pk)-[A-Za-z0-9]{8,}/],
  ['a bearer token', /bearer\s+[A-Za-z0-9._-]{12,}/i],
  ['a private key block', /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/],
  ['a connection URL', /postgres(ql)?:\/\//],
]) {
  if (pattern.test(serialized)) problems.push(`the security report contains ${label}`);
}

if (problems.length > 0) fail(`security report is not acceptable: ${problems.join('; ')}`);

const bySurface = Object.entries(report.by_surface ?? {})
  .map(([k, v]) => `${k}=${String(v)}`)
  .sort()
  .join(' ');
console.log(
  `defensive security suite verified: ${String(scenarios.length)} scenarios passed (${bySurface}), ` +
    'no live provider call.',
);
