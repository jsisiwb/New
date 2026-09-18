/**
 * Safety guards for the disposable backup/restore drill (B-4-3).
 *
 * This module exists because the drill is the only routine in the repository that CREATES and DROPS whole
 * databases. Every function here answers the same question — "is it provably safe to do destructive work
 * against this target?" — and every answer defaults to NO. A guard that is unsure refuses.
 *
 * Four rules shape it, and each is a rule because the alternative is a data-loss incident:
 *
 *  * NEVER TRUST `NODE_ENV`. An environment variable says what a process believes about itself, not what
 *    database it is pointed at. A misconfigured `NODE_ENV=test` against a production URL is exactly the
 *    accident this module must survive, so `NODE_ENV` is not consulted at all.
 *  * THE TARGET MUST NAME ITSELF DISPOSABLE. The drill only touches databases whose NAME carries an
 *    explicit disposable marker. Naming is the one signal the operator controls deliberately and cannot
 *    set by accident on an existing production database.
 *  * THE HOST MUST BE LOCAL. A remote host is refused outright: a logical restore drill has no business
 *    reaching a managed or shared server.
 *  * DESTRUCTION NEEDS A SEPARATE, EXPLICIT ACKNOWLEDGEMENT. Passing a safe URL authorizes reading; it
 *    does not authorize dropping. The acknowledgement is a second, independent act.
 *
 * Nothing here ever logs, returns or embeds a password or a complete connection URL. `describeTarget` is
 * the only rendering path and it is redacted by construction.
 */

/** A connection target reduced to the fields that are safe to log. Never carries a password. */
export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
}

export interface SafetyVerdict {
  readonly safe: boolean;
  /** Short machine-readable reasons, e.g. `host_not_local`. Never contains a credential. */
  readonly reasons: readonly string[];
}

/**
 * Database names that may be dropped. The marker must appear as a `_`- or `-`-delimited word so that a
 * database called `production_dropbox` cannot match on a substring.
 */
export const DISPOSABLE_MARKERS = ['disposable', 'drill', 'scratch', 'throwaway'] as const;

/**
 * Names that are refused even if they somehow also carry a disposable marker. A database called
 * `prod_drill_restore` is ambiguous, and ambiguity resolves to refusal.
 */
export const FORBIDDEN_NAME_WORDS = [
  'prod',
  'production',
  'staging',
  'stage',
  'live',
  'main',
  'master',
  'primary',
  'customer',
  'tenant',
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Parse a PostgreSQL connection URL into its safe-to-log parts. Throws on an unparseable URL rather than
 * guessing, because a URL this module cannot understand is a URL it cannot prove is safe.
 */
export function parseDatabaseTarget(url: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The message deliberately does not echo the URL: a malformed URL may still contain a password.
    throw new Error('connection URL is not parseable');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error(`connection URL is not a PostgreSQL URL (scheme ${parsed.protocol})`);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) throw new Error('connection URL names no database');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
    user: decodeURIComponent(parsed.username),
  };
}

/** A redacted, loggable description. Never includes the password or the complete URL. */
export function describeTarget(target: DatabaseTarget): string {
  return `${target.user}@${target.host}:${String(target.port)}/${target.database}`;
}

/**
 * Replace the password in a connection URL with a fixed marker. Used before a URL could reach a log, an
 * error message or a report. An unparseable URL redacts to a constant rather than passing through.
 */
export function redactConnectionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = 'REDACTED';
    return parsed.toString();
  } catch {
    return 'postgres://REDACTED';
  }
}

/** True when the host is the local machine. Remote hosts are never drill targets. */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** True when the database name carries an explicit, word-delimited disposable marker. */
export function nameIsMarkedDisposable(database: string): boolean {
  const parts = words(database);
  return DISPOSABLE_MARKERS.some((m) => parts.includes(m));
}

/** True when the database name contains a word that must never be destroyed by this drill. */
export function nameLooksProtected(database: string): boolean {
  const parts = words(database);
  return FORBIDDEN_NAME_WORDS.some((w) => parts.includes(w));
}

/**
 * The complete pre-destruction check. `acknowledged` is the operator's explicit second act; it is checked
 * LAST so that an unsafe target is reported as unsafe even when the acknowledgement is present — the
 * operator learns the target is wrong rather than that they forgot a flag.
 *
 * Returns every failing reason rather than the first, so a misconfigured drill is fixed in one pass.
 */
export function assessDestructiveTarget(input: {
  readonly url: string;
  readonly acknowledged: boolean;
  /** Databases the drill itself created. A target outside this set is never dropped. */
  readonly createdByDrill?: readonly string[] | undefined;
}): SafetyVerdict {
  const reasons: string[] = [];
  let target: DatabaseTarget;
  try {
    target = parseDatabaseTarget(input.url);
  } catch {
    return { safe: false, reasons: ['url_unparseable'] };
  }

  if (!isLocalHost(target.host)) reasons.push('host_not_local');
  if (nameLooksProtected(target.database)) reasons.push('database_name_looks_protected');
  if (!nameIsMarkedDisposable(target.database)) reasons.push('database_name_not_marked_disposable');
  if (input.createdByDrill !== undefined && !input.createdByDrill.includes(target.database))
    reasons.push('database_not_created_by_this_drill');
  if (!input.acknowledged) reasons.push('destructive_action_not_acknowledged');

  return { safe: reasons.length === 0, reasons };
}

/**
 * Throwing form of {@link assessDestructiveTarget}. The thrown message names the redacted target and the
 * machine-readable reasons — never the URL, never the password.
 */
export function assertDestructiveTargetSafe(input: {
  readonly url: string;
  readonly acknowledged: boolean;
  readonly createdByDrill?: readonly string[] | undefined;
}): DatabaseTarget {
  const verdict = assessDestructiveTarget(input);
  const target = parseDatabaseTarget(input.url);
  if (!verdict.safe)
    throw new Error(
      `refusing destructive work on ${describeTarget(target)}: ${verdict.reasons.join(', ')}`,
    );
  return target;
}

/**
 * The read-only source check. The drill reads from the source and must never write to it, so the source
 * does not need a disposable marker — but it must still be local and must not be a protected name,
 * because even `pg_dump` against production is out of scope for a local drill.
 */
export function assessSourceTarget(url: string): SafetyVerdict {
  let target: DatabaseTarget;
  try {
    target = parseDatabaseTarget(url);
  } catch {
    return { safe: false, reasons: ['url_unparseable'] };
  }
  const reasons: string[] = [];
  if (!isLocalHost(target.host)) reasons.push('host_not_local');
  if (nameLooksProtected(target.database)) reasons.push('database_name_looks_protected');
  return { safe: reasons.length === 0, reasons };
}

export function assertSourceSafe(url: string): DatabaseTarget {
  const verdict = assessSourceTarget(url);
  const target = parseDatabaseTarget(url);
  if (!verdict.safe)
    throw new Error(
      `refusing to read from ${describeTarget(target)}: ${verdict.reasons.join(', ')}`,
    );
  return target;
}

/** Build a connection URL for a sibling database on the same server, keeping credentials in memory only. */
export function urlForDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/**
 * A drill database name that is disposable by construction: the marker is part of the generated name, so
 * a target produced here can never fail the marker check while still being unique per run.
 */
export function drillDatabaseName(drillId: string, suffix: 'source' | 'restored'): string {
  const safeId = drillId.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `yeonjae_drill_${safeId}_${suffix}`;
}

/** The minimum schema version the restore drill is willing to certify a restore against. */
export const MIN_RESTORED_MIGRATION = 11;

/**
 * Decide whether a reported schema version is one the drill may certify.
 *
 * EXTRACTED SO IT CAN BE PROVED. This lived inline in `tools/run-restore-drill.mjs`, where it was wrong
 * twice in a row and untestable both times. First it was `startsWith('0011')`, which accepted only 0011
 * and rejected every later migration — the opposite of the "or later" it claimed, so it failed the moment
 * 0012 landed. The replacement compared the raw four-character prefix as a string, which fixed that but
 * still waved garbage through: `'abc'`, `'999'` and `'9_weird'` all sort above `'0011'`, so a malformed
 * or missing migration name passed the very gate that exists to notice it. A restore certified against an
 * unknown schema state is not certified at all.
 *
 * So the rule is explicit and FAILS CLOSED: the name must begin with exactly four digits, followed by a
 * separator or nothing, and that number is compared NUMERICALLY so a future `0100` cannot be defeated by
 * lexicographic ordering. Anything uninterpretable is refused with a reason rather than accepted.
 */
export function assessRestoredMigration(
  name: unknown,
  minimum: number = MIN_RESTORED_MIGRATION,
): SafetyVerdict {
  const text = typeof name === 'string' ? name : '';
  const match = /^(\d{4})(?:[_.]|$)/.exec(text);
  if (!match) return { safe: false, reasons: ['migration_version_unrecognized'] };
  const version = Number(match[1]);
  if (version < minimum) return { safe: false, reasons: ['migration_version_too_old'] };
  return { safe: true, reasons: [] };
}
