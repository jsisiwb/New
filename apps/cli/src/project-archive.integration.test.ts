/** Run 6, STEP 7.5: archiving a project keeps its data and changes only its status and a settings note. */
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import { type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { runDb } from './commands.js';

const run = databaseUrl() ? describe : describe.skip;

run('CLI: project:archive', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('defaults new projects to the craft policy and honors an explicit older pin', async () => {
    for (const [flags, expected] of [
      [[], 'policy/standard@46'],
      [['--policy=policy/standard@37'], 'policy/standard@37'],
    ] as const) {
      const created = await runDb(['project:create', 'policy probe', ...flags]);
      expect(created.ok).toBe(true);
      const row = await pool.query<{ production_policy_version: string }>(
        'SELECT production_policy_version FROM projects WHERE id = $1',
        [(created.output as { projectId: string }).projectId],
      );
      expect(row.rows[0]?.production_policy_version).toBe(expected);
    }
  });

  it('archives a project in place, with its reason, and refuses an unknown id', async () => {
    const created = await runDb(['project:create', 'probe']);
    expect(created.ok).toBe(true);
    const id = (created.output as { projectId: string }).projectId;
    const archived = await runDb(['project:archive', id, '--reason=stray empty probe']);
    expect(archived).toEqual({ ok: true, output: { id, status: 'archived' } });
    const row = await pool.query<{ status: string; settings: { archived?: { reason?: string } } }>(
      'SELECT status, settings FROM projects WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.status).toBe('archived');
    expect(row.rows[0]?.settings.archived?.reason).toBe('stray empty probe');
    const missing = await runDb(['project:archive', '00000000-0000-7000-8000-000000000000']);
    expect(missing.ok).toBe(false);
  });
});
