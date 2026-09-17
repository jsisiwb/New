/**
 * Least privilege of the request-scoped application role (migration 0007, Checkpoint 7 audit repair).
 *
 * The isolation tests in `identity.integration.test.ts` prove RLS keeps one workspace's rows out of another
 * workspace's connection. They cannot prove anything about the tables that deliberately have NO workspace
 * column — `users`, `sessions`, `schema_migrations`, and the global prompt registry — because those carry no
 * policy at all. For them the only control is the grant, so the grant is what these tests pin down.
 *
 * Every case here failed against migration 0006 alone. They are regression tests for a real finding, not
 * restatements of the migration text.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_ROLE, createPool, migrate, resetDatabase, type Client, type Pool } from './index.js';
import { databaseUrl } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

/**
 * Run one statement as the request-scoped role and report whether it was permitted. The transaction is
 * always rolled back, so a statement that IS permitted cannot corrupt the rest of the suite.
 */
async function asAppRole(
  pool: Pool,
  sql: string,
  params: readonly unknown[] = [],
): Promise<{ permitted: boolean; code?: string | undefined; rowCount: number }> {
  const client: Client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const r = await client.query(sql, params as unknown[]);
    return { permitted: true, rowCount: r.rowCount ?? 0 };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { permitted: false, code, rowCount: 0 };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/** PostgreSQL's SQLSTATE for "permission denied for table". */
const INSUFFICIENT_PRIVILEGE = '42501';

run(
  'the request-scoped application role holds only the privileges it needs (migration 0007)',
  () => {
    let pool: Pool;

    beforeAll(async () => {
      const url = databaseUrl();
      if (!url) throw new Error('DATABASE_URL not set');
      pool = createPool({ connectionString: url, max: 4 });
      await resetDatabase(pool);
      await migrate(pool);
    }, 60_000);
    beforeEach(async () => {
      await resetDatabase(pool);
      await migrate(pool);
    });
    afterAll(async () => {
      await pool.end();
    });

    it('is a non-superuser role that cannot bypass row-level security', async () => {
      const r = await pool.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
      }>(
        'SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1',
        [APP_ROLE],
      );
      expect(r.rows[0]).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
    });

    it('cannot read password verifiers or session secrets (those tables have no workspace and no policy)', async () => {
      // Authentication runs on the unscoped pool before a workspace is proven, so a request-scoped
      // connection has no legitimate reason to touch either table.
      for (const table of ['users', 'sessions']) {
        const read = await asAppRole(pool, `SELECT * FROM ${table}`);
        expect({ table, ...read }).toMatchObject({
          table,
          permitted: false,
          code: INSUFFICIENT_PRIVILEGE,
        });
      }
    });

    it('cannot overwrite a password verifier or delete a session', async () => {
      const update = await asAppRole(pool, `UPDATE users SET password_hash = 'x'`);
      expect(update.permitted).toBe(false);
      expect(update.code).toBe(INSUFFICIENT_PRIVILEGE);
      const revoke = await asAppRole(pool, 'DELETE FROM sessions');
      expect(revoke.permitted).toBe(false);
      expect(revoke.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('cannot erase the migration ledger (which would make migrate() replay every migration)', async () => {
      const before = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM schema_migrations',
      );
      const wipe = await asAppRole(pool, 'DELETE FROM schema_migrations');
      expect(wipe.permitted).toBe(false);
      expect(wipe.code).toBe(INSUFFICIENT_PRIVILEGE);
      const after = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM schema_migrations',
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
      expect(Number(after.rows[0]?.n)).toBeGreaterThan(0);
    });

    it('may read the global prompt registry but never rewrite it', async () => {
      // Read access is required: the gateway resolves pinned prompt versions on every production call.
      for (const table of ['prompt_versions', 'prompt_sets']) {
        const read = await asAppRole(pool, `SELECT count(*) FROM ${table}`);
        expect({ table, permitted: read.permitted }).toEqual({ table, permitted: true });
        for (const write of [`UPDATE ${table} SET id = id`, `DELETE FROM ${table}`]) {
          const attempt = await asAppRole(pool, write);
          expect({ write, permitted: attempt.permitted, code: attempt.code }).toMatchObject({
            write,
            permitted: false,
            code: INSUFFICIENT_PRIVILEGE,
          });
        }
      }
    });

    it('cannot mint an API key or promote its own principal through workspace_members', async () => {
      // Both are owner operations on the audited, unscoped path. A request-scoped connection that could do
      // either could manufacture a credential or a role for itself.
      const mint = await asAppRole(
        pool,
        `INSERT INTO api_keys (workspace_id, user_id, name, token_hash)
       VALUES (canon.uuid_v7(), canon.uuid_v7(), 'forged', 'deadbeef')`,
      );
      expect(mint.permitted).toBe(false);
      expect(mint.code).toBe(INSUFFICIENT_PRIVILEGE);

      const promote = await asAppRole(pool, `UPDATE workspace_members SET role = 'owner'`);
      expect(promote.permitted).toBe(false);
      expect(promote.code).toBe(INSUFFICIENT_PRIVILEGE);

      // Reading membership stays permitted: it is how the API derives a role, under RLS.
      const read = await asAppRole(pool, 'SELECT count(*) FROM workspace_members');
      expect(read.permitted).toBe(true);
    });

    it('refuses UPDATE and DELETE on prompt_sets at the trigger too, not only by grant', async () => {
      // Defence in depth: revoking the grant protects the request path, but the owner connection (migrations,
      // CLI, workers) writes prompt sets and must not be able to silently repoint a pinned mapping either.
      await pool.query(
        `INSERT INTO prompt_sets (id, mapping) VALUES ('set.audit.v1', '{"role":"x"}'::jsonb)`,
      );
      await expect(
        pool.query(
          `UPDATE prompt_sets SET mapping = '{"role":"y"}'::jsonb WHERE id = 'set.audit.v1'`,
        ),
      ).rejects.toThrow();
      await expect(
        pool.query(`DELETE FROM prompt_sets WHERE id = 'set.audit.v1'`),
      ).rejects.toThrow();
      const still = await pool.query<{ mapping: Record<string, string> }>(
        `SELECT mapping FROM prompt_sets WHERE id = 'set.audit.v1'`,
      );
      expect(still.rows[0]?.mapping).toEqual({ role: 'x' });
    });

    /**
     * Review finding R-2. Migration 0012 and ADR-0049 both asserted that `llm_calls` is "INSERT/SELECT
     * only for `yeonjae_app`". The database said otherwise: 0007 narrowed the scoped role table by table
     * and never listed `llm_calls`, so the role still held UPDATE and DELETE. The append-only trigger made
     * it unexploitable, but a grant layer that contradicts its own documentation is the gap that becomes a
     * real hole the day someone has a legitimate reason to narrow that trigger. 0013 makes the claim true.
     */
    it('holds only INSERT and SELECT on the gateway audit, matching what the migration claims', async () => {
      const grants = await pool.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_name = 'llm_calls' AND grantee = $1 ORDER BY privilege_type`,
        [APP_ROLE],
      );
      expect(grants.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);

      // And the privilege is genuinely gone at the connection, not merely absent from a catalogue view.
      const update = await asAppRole(pool, `UPDATE llm_calls SET cost_cents = 0`);
      expect(update.permitted).toBe(false);
      expect(update.code).toBe(INSUFFICIENT_PRIVILEGE);
      const del = await asAppRole(pool, `DELETE FROM llm_calls`);
      expect(del.permitted).toBe(false);
      expect(del.code).toBe(INSUFFICIENT_PRIVILEGE);
    });

    /**
     * Review finding R-3. 0012's trigger refused a `cancelled` row with no provenance but never asked the
     * converse, so a row could claim BOTH that the call succeeded and that an operator cancelled it. No
     * application path produces that, which is exactly why the trigger has to be the guard: it is the only
     * one that applies to raw SQL, a future writer, or a restore from a doctored dump. A self-contradictory
     * audit row is worse than a missing one — a reader reconciling spend cannot tell which half to believe.
     */
    it('refuses cancellation provenance on a call that was not cancelled', async () => {
      const ws = await pool.query<{ id: string }>(
        `INSERT INTO workspaces (name) VALUES ('grant-audit') RETURNING id`,
      );
      const workspaceId = ws.rows[0]?.id ?? '';
      const project = await pool.query<{ id: string }>(
        `INSERT INTO projects (workspace_id, title, production_policy_version)
         VALUES ($1, 'p', 'policy/standard@1') RETURNING id`,
        [workspaceId],
      );
      const projectId = project.rows[0]?.id ?? '';
      const provenance = {
        reason: 'operator_cancelled',
        outcome: 'operator_cancelled',
        remote_cancellation: 'unsupported',
        usage_status: 'unknown',
        billing_status: 'unknown',
        response_discarded: false,
        before_first_attempt: true,
      };
      const insert = (status: string, cancellation: unknown): Promise<unknown> =>
        pool.query(
          `INSERT INTO llm_calls
             (id, workspace_id, project_id, idempotency_key, role, prompt_version_id, prompt_hash,
              production_policy_version, model_id, model_class, provider, params, input_hash, usage,
              cost_cents, status, cancellation)
           VALUES (canon.uuid_v7(), $1, $2, $3, 'r', 'prompt/x@1.0.0', 'sha256:p',
                   'policy/standard@1', 'm', 'M', 'mock', '{}'::jsonb, 'sha256:i', '{}'::jsonb,
                   0, $4, $5::jsonb)`,
          [
            workspaceId,
            projectId,
            `r3-${status}-${cancellation === null ? 'none' : 'prov'}`,
            status,
            cancellation === null ? null : JSON.stringify(cancellation),
          ],
        );

      // A succeeded or failed call may not carry a cancellation story.
      await expect(insert('succeeded', provenance)).rejects.toThrow(/CANCELLATION_INVALID/);
      await expect(insert('failed', provenance)).rejects.toThrow(/CANCELLATION_INVALID/);
      // Every rule 0012 already enforced still holds after 0013 replaced the function.
      await expect(insert('cancelled', null)).rejects.toThrow(/CANCELLATION_INVALID/);
      await expect(insert('cancelled', { ...provenance, billing_status: 'known' })).rejects.toThrow(
        /CANCELLATION_INVALID/,
      );
      await expect(
        insert('cancelled', { ...provenance, reason: 'because-i-said-so' }),
      ).rejects.toThrow(/CANCELLATION_INVALID/);
      // And the legitimate row is still accepted.
      await expect(insert('cancelled', provenance)).resolves.toBeDefined();
    });

    it('every workspace-owned table has RLS enabled, forced, and at least one policy', async () => {
      // 0006 covers this today; the assertion exists so a later migration that adds a tenant table without a
      // policy fails here instead of in production. Tables listed as intentionally global are excluded.
      const globalTables = [
        'prompt_versions',
        'prompt_sets',
        'schema_migrations',
        'users',
        'sessions',
      ];
      const r = await pool.query<{ relname: string; forced: boolean; policies: number }>(
        `SELECT c.relname,
              c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY($1))
        ORDER BY c.relname`,
        [globalTables],
      );
      expect(r.rows.length).toBeGreaterThan(20);
      const unprotected = r.rows.filter((row) => !row.forced || row.policies === 0);
      expect(unprotected).toEqual([]);
    });

    it('future tables default to read-only for the scoped role, so a new table cannot silently be writable', async () => {
      // 0006's ALTER DEFAULT PRIVILEGES granted full DML on every future table; 0007 narrows it to SELECT.
      await pool.query(
        'CREATE TABLE audit_probe_table (id uuid PRIMARY KEY DEFAULT canon.uuid_v7())',
      );
      try {
        const read = await asAppRole(pool, 'SELECT count(*) FROM audit_probe_table');
        expect(read.permitted).toBe(true);
        const write = await asAppRole(pool, 'INSERT INTO audit_probe_table DEFAULT VALUES');
        expect(write.permitted).toBe(false);
        expect(write.code).toBe(INSUFFICIENT_PRIVILEGE);
      } finally {
        await pool.query('DROP TABLE audit_probe_table');
      }
    });
  },
);
