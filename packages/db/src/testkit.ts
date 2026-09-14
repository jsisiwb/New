/**
 * Integration-test helpers. Tests run against DATABASE_URL (a real Postgres 16); when the variable is absent
 * the suites skip with a visible reason rather than pretending to pass.
 */
import { createPool, type Pool } from './client.js';
import { migrate, resetDatabase } from './migrate.js';

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
}

export async function freshDatabase(): Promise<Pool> {
  const url = databaseUrl();
  if (!url) throw new Error('DATABASE_URL not set');
  const pool = createPool({ connectionString: url, max: 4 });
  await resetDatabase(pool);
  await migrate(pool);
  return pool;
}
