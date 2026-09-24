/**
 * Forward-only SQL migrations (data architecture §15). Each file in migrations/ runs once, in name order, inside
 * a transaction, and is recorded with its content hash so a modified past migration is detected, not re-run.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Pool } from './client.js';

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'migrations');
}

export interface AppliedMigration {
  readonly name: string;
  readonly hash: string;
  readonly applied_at: Date;
}

export async function migrate(
  pool: Pool,
  dir: string = migrationsDir(),
): Promise<{ applied: string[]; skipped: string[] }> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const done = new Map<string, string>();
  for (const row of (
    await pool.query<{ name: string; hash: string }>('SELECT name, hash FROM schema_migrations')
  ).rows) {
    done.set(row.name, row.hash);
  }
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const prior = done.get(f);
    if (prior !== undefined) {
      if (prior !== hash)
        throw new Error(
          `migration ${f} was modified after being applied (forward-only; add a new file)`,
        );
      skipped.push(f);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, hash) VALUES ($1, $2)', [f, hash]);
      await client.query('COMMIT');
      applied.push(f);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

/**
 * Databases a reset may drop (ADR-0080): test databases by name (`…test…`), restore-drill and
 * multiprocess-harness databases by their generated names, or any database when
 * `YEONJAE_ALLOW_DB_RESET=1`. A permanent novel database fails closed: a test run pointed at it by an
 * inherited `DATABASE_URL` stops before anything is dropped.
 */
export function resetAllowed(databaseName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.YEONJAE_ALLOW_DB_RESET === '1') return true;
  return (
    /test/i.test(databaseName) ||
    databaseName.startsWith('yeonjae_drill_') ||
    /^yeonjae_[a-z0-9]+_[a-z0-9]{4,8}$/.test(databaseName)
  );
}

/** Drop everything the migrations created (tests and local resets only; see `resetAllowed`). */
export async function resetDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ db: string }>('SELECT current_database() AS db');
  const name = rows[0]?.db ?? '';
  if (!resetAllowed(name))
    throw new Error(
      `RESET_REFUSED: database "${name}" is not a test database; set YEONJAE_ALLOW_DB_RESET=1 to reset it deliberately`,
    );
  await pool.query(
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS canon CASCADE;',
  );
}
