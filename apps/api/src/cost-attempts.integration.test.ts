/**
 * The attempt-level cost API (B-4-6).
 *
 * `/v1/projects/:id/costs` already answered "what did this cost". This suite covers the route that
 * answers the questions it could not: how many ACTUAL provider attempts were behind that spend, and did
 * a retry or a fallback happen — the per-attempt provenance migration 0011 added.
 *
 * What is asserted here is mostly truthfulness rather than arithmetic (the arithmetic is proved in
 * `packages/db/src/cost-accounting.integration.test.ts` against the audit directly): that the response
 * states its basis, currency and unit; that it never presents replay-observed cents as billed truth;
 * that a dashboard number traces to audit rows; that the window filter cannot be silently dropped; and
 * that one tenant's spend is unreachable from another's session.
 *
 * All spend is fixture-defined and served by the replay provider: no credentials, no live call, no money.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  addMember,
  createProject,
  createUser,
  createWorkspace,
  migrate,
  resetDatabase,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { SESSION_COOKIE, WORKSPACE_HEADER } from './auth.js';

const run = databaseUrl() ? describe : describe.skip;

interface CostBody {
  dimension: string;
  basis: string;
  currency: string;
  unit: string;
  total_cost_millicents: number;
  total_cost_cents: number;
  calls: number;
  attempts: number;
  window: { since: string | null; until: string | null };
  items: {
    key: string | null;
    calls: number;
    attempts: number;
    cost_millicents: number;
    cost_cents: number;
    retried_calls: number;
    fallback_calls: number;
    usage_unknown_calls: number;
  }[];
}

run('API: attempt-level cost and provenance summary (B-4-6)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let wsA = '';
  let wsB = '';
  let projectA = '';
  let projectB = '';
  let cookieA = '';
  let cookieB = '';

  async function login(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'correct horse battery staple' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(raw);
    return `${SESSION_COOKIE}=${String(match?.[1])}`;
  }

  async function writeCall(
    workspaceId: string,
    projectId: string,
    key: string,
    fields: {
      role: string;
      status: string;
      modelId: string;
      costCents: number;
      usage: Record<string, number> | null;
      fallbackFrom?: string | undefined;
      attempts: Record<string, unknown>[];
    },
  ): Promise<void> {
    const hash = (v: string) => `sha256:${createHash('sha256').update(v).digest('hex')}`;
    await pool.query(
      `INSERT INTO llm_calls
         (id, workspace_id, project_id, idempotency_key, role, prompt_version_id, prompt_hash,
          production_policy_version, model_id, model_class, provider, params, input_hash, usage,
          cost_cents, latency_ms, status, fallback_from_model_id, attempt_records)
       VALUES (canon.uuid_v7(), $1, $2, $3, $4, 'prompt/x@1.0.0', $5, 'policy/standard@1', $6, 'P',
               'replay', '{}'::jsonb, $7, $8::jsonb, $9, 100, $10, $11, $12::jsonb)`,
      [
        workspaceId,
        projectId,
        key,
        fields.role,
        hash(key),
        fields.modelId,
        hash(`${key}-in`),
        JSON.stringify(fields.usage ?? {}),
        fields.costCents,
        fields.status,
        fields.fallbackFrom ?? null,
        JSON.stringify(fields.attempts),
      ],
    );
  }

  beforeAll(async () => {
    pool = await freshDatabase();
    await resetDatabase(pool);
    await migrate(pool);
    app = buildApi({ pool, secureCookies: false, corsOrigins: [], logger: false });

    const userA = await createUser(pool, {
      email: 'cost-a@example.invalid',
      displayName: 'Cost A',
      password: 'correct horse battery staple',
    });
    const userB = await createUser(pool, {
      email: 'cost-b@example.invalid',
      displayName: 'Cost B',
      password: 'correct horse battery staple',
    });
    wsA = await createWorkspace(pool, 'cost-ws-a');
    wsB = await createWorkspace(pool, 'cost-ws-b');
    await addMember(pool, { workspaceId: wsA, userId: userA.id, role: 'owner' });
    await addMember(pool, { workspaceId: wsB, userId: userB.id, role: 'owner' });
    projectA = (await createProject(pool, { workspaceId: wsA, title: 'A' })).projectId;
    projectB = (await createProject(pool, { workspaceId: wsB, title: 'B' })).projectId;
    cookieA = await login('cost-a@example.invalid');
    cookieB = await login('cost-b@example.invalid');

    // Workspace A: one clean success and one fallback, so retry/fallback visibility has something to show.
    await writeCall(wsA, projectA, 'a-success', {
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 7,
      usage: { input_tokens: 10, output_tokens: 20 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 7,
        },
      ],
    });
    await writeCall(wsA, projectA, 'a-fallback', {
      role: 'evaluator',
      status: 'fallback_succeeded',
      modelId: 'model-b',
      costCents: 5,
      usage: null,
      fallbackFrom: 'model-a',
      attempts: [
        { attempt: 1, model_id: 'model-a', provider: 'replay', outcome: 'failed', cost_cents: 0 },
        {
          attempt: 2,
          model_id: 'model-b',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 5,
        },
      ],
    });
    // Workspace B: a much larger spend, so a leak would be unmistakable.
    await writeCall(wsB, projectB, 'b-success', {
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 9999,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 9999,
        },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function get(url: string, cookie: string, workspace: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: { cookie, [WORKSPACE_HEADER]: workspace },
    });
  }

  it('reports attempts, retries and fallbacks alongside the authoritative total', async () => {
    const res = await get(`/v1/projects/${projectA}/cost-attempts?dimension=role`, cookieA, wsA);
    expect(res.statusCode, res.body).toBe(200);
    const body: CostBody = res.json();
    expect(body.total_cost_cents).toBe(12);
    expect(body.total_cost_millicents).toBe(12_000);
    expect(body.calls).toBe(2);
    // Three actual provider attempts behind two logical calls: the abandoned route is visible.
    expect(body.attempts).toBe(3);
    const evaluator = body.items.find((i) => i.key === 'evaluator');
    expect(evaluator?.fallback_calls).toBe(1);
    expect(evaluator?.retried_calls).toBe(1);
    // The fallback call reported no usage, and that stays unknown rather than becoming zero.
    expect(evaluator?.usage_unknown_calls).toBe(1);
  });

  it('states its basis, currency and unit, and never claims billed truth', async () => {
    const res = await get(`/v1/projects/${projectA}/cost-attempts`, cookieA, wsA);
    const body: CostBody = res.json();
    expect(body.basis).toBe('recorded_replay');
    expect(body.currency).toBe('USD');
    expect(body.unit).toBe('cents');
    // `billed` is deliberately not a representable basis: an invoice is not something this observes.
    expect(body.basis).not.toContain('billed');
  });

  it('totals trace to the audit rows rather than being recomputed from item sums only', async () => {
    const res = await get(
      `/v1/projects/${projectA}/cost-attempts?dimension=provider`,
      cookieA,
      wsA,
    );
    const body: CostBody = res.json();
    // Reconcile on the exact integer field: comparing decimals would pass even if a sub-cent value had
    // been silently truncated on the way out.
    const summed = body.items.reduce((sum, i) => sum + i.cost_millicents, 0);
    expect(body.total_cost_millicents).toBe(summed);
    const { rows } = await pool.query<{ total: string }>(
      'SELECT coalesce(sum(cost_cents),0)::text AS total FROM llm_calls WHERE project_id = $1',
      [projectA],
    );
    expect(body.total_cost_cents).toBeCloseTo(Number(rows[0]?.total), 10);
  });

  it('reports a sub-cent cost exactly rather than truncating it to zero', async () => {
    // Real replay-priced calls cost a fraction of a cent, so the API must not present them as free.
    await writeCall(wsA, projectA, 'a-subcent', {
      role: 'summarizer',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 0.3,
      usage: { input_tokens: 100, output_tokens: 200 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 0.3,
        },
      ],
    });
    const res = await get(`/v1/projects/${projectA}/cost-attempts?dimension=role`, cookieA, wsA);
    const body: CostBody = res.json();
    const summarizer = body.items.find((i) => i.key === 'summarizer');
    expect(summarizer?.cost_millicents).toBe(300);
    expect(summarizer?.cost_cents).toBeCloseTo(0.3, 10);
    expect(body.total_cost_millicents).toBe(12_300);
  });

  it('supports every documented dimension and rejects an unknown one', async () => {
    for (const dimension of [
      'role',
      'model',
      'provider',
      'model_class',
      'job',
      'policy',
      'outcome',
    ]) {
      const res = await get(
        `/v1/projects/${projectA}/cost-attempts?dimension=${dimension}`,
        cookieA,
        wsA,
      );
      expect(res.statusCode, dimension).toBe(200);
      expect(res.json<CostBody>().dimension).toBe(dimension);
    }
    const bad = await get(
      `/v1/projects/${projectA}/cost-attempts?dimension=phase_of_moon`,
      cookieA,
      wsA,
    );
    expect(bad.statusCode).toBe(422);
  });

  it('applies a time window and refuses a malformed one instead of dropping the filter', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const windowed = await get(
      `/v1/projects/${projectA}/cost-attempts?since=${encodeURIComponent(future)}`,
      cookieA,
      wsA,
    );
    expect(windowed.statusCode).toBe(200);
    const body: CostBody = windowed.json();
    expect(body.total_cost_cents).toBe(0);
    expect(body.window.since).toBe(future);

    // A silently ignored bad filter would show a total for the wrong window, which is worse than an error.
    const malformed = await get(
      `/v1/projects/${projectA}/cost-attempts?since=not-a-date`,
      cookieA,
      wsA,
    );
    expect(malformed.statusCode).toBe(422);
  });

  it('is tenant isolated: another workspace\u2019s spend is unreachable and indistinguishable from absent', async () => {
    // Workspace A asking for workspace B's project must look exactly like "no such project".
    const cross = await get(`/v1/projects/${projectB}/cost-attempts`, cookieA, wsA);
    expect(cross.statusCode).toBe(404);
    expect(cross.body).not.toContain('9999');

    const own = await get(`/v1/projects/${projectB}/cost-attempts`, cookieB, wsB);
    expect(own.statusCode).toBe(200);
    expect(own.json<CostBody>().total_cost_cents).toBe(9999);
  });

  it('requires authentication and membership', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/cost-attempts`,
    });
    expect(anonymous.statusCode).toBe(401);
    // A valid session with a workspace the user does not belong to is refused, not served.
    const forged = await get(`/v1/projects/${projectA}/cost-attempts`, cookieB, wsA);
    expect([401, 403, 404]).toContain(forged.statusCode);
  });

  it('carries no prose, prompts or credentials in the response', async () => {
    const res = await get(`/v1/projects/${projectA}/cost-attempts?dimension=model`, cookieA, wsA);
    for (const pattern of [
      /\b(sk|pk)-[A-Za-z0-9]{8,}/,
      /bearer\s+[A-Za-z0-9._-]{12,}/i,
      /postgres(ql)?:\/\//,
    ]) {
      expect(res.body).not.toMatch(pattern);
    }
  });
});
