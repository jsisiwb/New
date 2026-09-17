#!/usr/bin/env node
/**
 * `pnpm drill:restore` — the explicit entry point for the disposable backup/restore drill (B-4-3).
 *
 * Like the 120-chapter and chaos runners, this exists so the drill cannot pass by not running. It
 * executes the suite, then reads the suite's OWN durable report — not `coverage/junit.xml`, which every
 * later vitest invocation overwrites (defect D-4) — and fails unless the drill actually restored a
 * database and verified every invariant.
 *
 * DATABASE_URL is required. The drill creates and drops its own disposable databases on that server and
 * never touches the database named in the URL itself; `packages/db/src/restore-safety.ts` refuses any
 * target that is not local, explicitly marked disposable and created by the drill.
 *
 * This verifies a LOGICAL dump/restore. It does not test PITR, staging, production or off-site backup,
 * and the guard below fails if the report ever starts claiming otherwise.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const REPORT_PATH = 'coverage/restore-drill-report.json';
const SUITES = [
  'packages/db/src/restore-safety.test.ts',
  'packages/db/src/restore-drill.integration.test.ts',
];
/** Every invariant the drill must report. Shortening this list is a deliberate, reviewable act. */
const REQUIRED_INVARIANTS = [
  'migration_count_matches',
  'migration_0011_present',
  'cancellation_provenance_restored',
  'tables_restored',
  'indexes_restored',
  'triggers_restored',
  'rls_policies_restored',
  'rls_forced_on_tenant_tables',
  'row_counts_match_by_workspace',
  'canon_versions_contiguous',
  'manuscript_content_hashes_intact',
  'evidence_offsets_and_hashes_intact',
  'accepted_pointer_only_accepted',
  'quarantine_preserved_and_excluded',
  'job_terminal_event_exactly_once',
  'job_checkpoints_restored',
  'attempt_provenance_restored',
  'cost_totals_match_by_workspace',
  'derived_rows_have_no_orphans',
  'sequences_do_not_collide',
  'rls_cross_workspace_isolation_enforced',
  'logical_checksum_matches',
  'source_database_unchanged',
];

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL)
  fail(
    'the restore drill requires a PostgreSQL 16 DATABASE_URL; without it the drill skips, and a ' +
      'skipped drill is not evidence that a backup can be restored',
  );

for (const tool of ['pg_dump', 'pg_restore']) {
  const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0)
    fail(
      `${tool} is unavailable, so the logical restore drill cannot run. The drill deliberately has no ` +
        'in-memory substitute: a faked restore would be worse than a missing one.',
    );
}

rmSync(REPORT_PATH, { force: true });

const result = spawnSync('npx', ['vitest', 'run', ...SUITES], {
  stdio: 'inherit',
  env: { ...process.env, CI: process.env.CI ?? 'true', YEONJAE_RESTORE_REPORT: REPORT_PATH },
});
if (result.status !== 0) fail(`the restore drill failed (exit ${String(result.status)})`);

if (!existsSync(REPORT_PATH))
  fail(
    `the restore drill reported success but wrote no report to ${REPORT_PATH}; it was skipped or ` +
      'filtered out rather than executed',
  );

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
} catch (err) {
  fail(`the restore report at ${REPORT_PATH} is unreadable: ${String(err)}`);
}

const problems = [];
if (report.passed !== true) problems.push('the drill did not report an overall pass');
if (report.source_unchanged !== true)
  problems.push('the source database was not verified unchanged');
if (report.source_checksum !== report.target_checksum)
  problems.push('the restored checksum does not match the source checksum');
if (!String(report.postgres_version ?? '').startsWith('16.'))
  problems.push(
    `the drill ran against PostgreSQL ${String(report.postgres_version)}, expected 16.x`,
  );
/**
 * The restored schema must be at least the migration this guard was written against.
 *
 * Compared with `localeCompare` on the zero-padded migration name rather than `startsWith`, which was the
 * defect: `startsWith('0011')` accepted ONLY 0011 and rejected every later migration, so the guard failed
 * the moment a new migration landed — the opposite of the "or later" it claimed to check. Migration names
 * are zero-padded and therefore sort lexicographically in application order.
 */
const MIN_MIGRATION = '0011';
if (String(report.migration_version ?? '').slice(0, 4) < MIN_MIGRATION)
  problems.push(
    `the restored schema is at ${String(report.migration_version)}, expected ${MIN_MIGRATION} or later`,
  );

const reported = new Map((report.invariants ?? []).map((i) => [String(i.id), String(i.outcome)]));
for (const id of REQUIRED_INVARIANTS) {
  const outcome = reported.get(id);
  if (outcome === undefined) problems.push(`invariant ${id} was not reported`);
  else if (outcome !== 'passed') problems.push(`invariant ${id} reported ${outcome}`);
}

// The drill must never quietly start claiming coverage it does not have.
const scope = report.scope ?? {};
if (scope.method !== 'logical_dump_restore')
  problems.push(`unexpected drill method ${String(scope.method)}`);
for (const key of [
  'pitr_tested',
  'staging_restore_tested',
  'production_restore_tested',
  'offsite_backup_tested',
  'rto_rpo_measured',
]) {
  if (scope[key] !== false)
    problems.push(
      `the report claims ${key}=${String(scope[key])}; this drill does not test that, so the claim ` +
        'must be backed by a real implementation before it may appear here',
    );
}

// Published evidence must not carry credentials or connection strings.
const serialized = JSON.stringify(report);
for (const [label, pattern] of [
  ['an API-key-shaped string', /\b(sk|pk)-[A-Za-z0-9]{8,}/],
  ['a bearer token', /bearer\s+[A-Za-z0-9._-]{12,}/i],
  ['a private key block', /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/],
  ['a connection URL', /postgres(ql)?:\/\//],
]) {
  if (pattern.test(serialized)) problems.push(`the restore report contains ${label}`);
}

if (problems.length > 0) fail(`restore drill report is not acceptable: ${problems.join('; ')}`);

console.log(
  `restore drill verified: ${String(reported.size)} invariants passed on PostgreSQL ` +
    `${String(report.postgres_version)} at schema ${String(report.migration_version)} in ` +
    `${String(report.duration_ms)}ms. Logical dump/restore only — no PITR, staging or production restore.`,
);
