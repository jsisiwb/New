/**
 * Rate limiting against the running API (Checkpoint 7; security plan §2).
 *
 * The unit suite proves the window algorithm. This proves the WIRING, with a deliberately tiny limit so the
 * assertions are about behaviour rather than about waiting:
 *
 *  * the limit is enforced BEFORE authentication, which is the only placement that stops credential
 *    stuffing — a limiter running after the auth check still pays for every scrypt verification;
 *  * the refusal is a proper RFC 9457 problem document with `Retry-After`, not a bare 429;
 *  * health, readiness and metrics are exempt, because throttling a probe would make a load balancer eject
 *    a healthy instance under exactly the load the limit exists to survive;
 *  * scopes are independent, so an exhausted read budget does not lock an operator out of authenticating;
 *  * a forwarded header does not create a new identity unless a proxy is explicitly trusted — otherwise
 *    the limiter is decorative, since an attacker just rotates the header.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, createUser, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { RateLimiter } from './rate-limit.js';
import { WORKSPACE_HEADER } from './auth.js';
import { METRIC, Metrics } from './observability.js';
import { seedAcceptedChapterOne, type SeededProject } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const PASSWORD = 'operator-password-1';

run('API: rate limiting (Checkpoint 7)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let seeded: SeededProject;
  let metrics: Metrics;
  let closePrevious = false;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    seeded = await seedAcceptedChapterOne(pool);
    const user = await createUser(pool, {
      email: 'operator@example.com',
      displayName: 'Operator',
      password: PASSWORD,
    });
    await addMember(pool, { workspaceId: seeded.workspaceId, userId: user.id, role: 'owner' });

    metrics = new Metrics();
    // Each case needs its own limiter and registry, so the app is rebuilt per test rather than shared.
    // `closePrevious` tracks whether there is anything to close without an `app !== undefined` test that
    // TypeScript considers impossible (the declaration is not optional).
    if (closePrevious) await app.close();
    closePrevious = true;
    app = buildApi({
      pool,
      secureCookies: false,
      metrics,
      // Tiny limits so the behaviour is observable without waiting out a real window. Two auth attempts
      // and three reads per minute.
      rateLimiter: new RateLimiter({
        limits: {
          auth: { max: 2, windowMs: 60_000 },
          read: { max: 3, windowMs: 60_000 },
        },
      }),
    });
    await app.ready();
  }, 300_000);

  async function login(password: string) {
    return app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'operator@example.com', password },
    });
  }

  it('limits authentication attempts BEFORE verifying the credential', async () => {
    // Two WRONG passwords consume the allowance. If the limiter ran after authentication, each of these
    // would still have paid for a scrypt verification — which is the cost credential stuffing exploits.
    expect((await login('wrong-password-1')).statusCode).toBe(401);
    expect((await login('wrong-password-2')).statusCode).toBe(401);

    const limited = await login(PASSWORD);
    // The CORRECT password is now refused too: the limit is on attempts, not on failures, so an attacker
    // cannot probe indefinitely by mixing in valid-looking requests.
    expect(limited.statusCode, limited.body).toBe(429);
    const problem = limited.json<{ code: string; data?: { retry_after_seconds?: number } }>();
    expect(problem.code).toBe('RATE_LIMITED');
    expect(problem.data?.retry_after_seconds).toBeGreaterThan(0);
    // A client that cannot tell how long to wait retries immediately and stays limited.
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('answers a refusal as an RFC 9457 problem document with security headers intact', async () => {
    await login('wrong-1');
    await login('wrong-2');
    const limited = await login('wrong-3');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    // Security headers are applied on every response including errors, so a 429 is not a gap.
    expect(limited.headers['x-content-type-options']).toBe('nosniff');
    expect(limited.headers['x-request-id']).toBeDefined();
    // No internals leak through the refusal.
    for (const forbidden of ['SELECT', 'node_modules', '/tmp/', 'scrypt']) {
      expect(limited.body).not.toContain(forbidden);
    }
  });

  it('counts refusals in the metrics registry, by scope', async () => {
    await login('wrong-1');
    await login('wrong-2');
    await login('wrong-3');
    expect(metrics.total(METRIC.rateLimited, { scope: 'auth' })).toBeGreaterThan(0);
  });

  it('keeps scopes independent, so an exhausted read budget still allows authentication', async () => {
    const authed = await login(PASSWORD);
    expect(authed.statusCode, authed.body).toBe(200);
    const setCookie = authed.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';

    // Exhaust the read scope (3/minute).
    for (let i = 0; i < 3; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/projects',
        headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
      });
      expect(res.statusCode, `read ${i}: ${res.body}`).toBe(200);
    }
    const limitedRead = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    expect(limitedRead.statusCode).toBe(429);

    // Authentication has one attempt left and is unaffected by the read flood.
    expect((await login(PASSWORD)).statusCode).toBe(200);
  });

  it('never throttles health, readiness or metrics', async () => {
    // Well past every configured limit. A throttled probe would make a load balancer eject a healthy
    // instance under exactly the load the limiter exists to survive.
    for (let i = 0; i < 25; i += 1) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode, `health ${i}`).toBe(
        200,
      );
      expect((await app.inject({ method: 'GET', url: '/ready' })).statusCode, `ready ${i}`).toBe(
        200,
      );
      expect(
        (await app.inject({ method: 'GET', url: '/metrics' })).statusCode,
        `metrics ${i}`,
      ).toBe(200);
    }
  });

  it('does not let a forwarded header mint fresh identities when no proxy is trusted', async () => {
    // The default configuration. If `X-Forwarded-For` were believed, each of these would look like a new
    // client and the limiter would be decorative — an attacker rotates the header and never hits a limit.
    expect((await loginFrom('1.1.1.1')).statusCode).toBe(401);
    expect((await loginFrom('2.2.2.2')).statusCode).toBe(401);
    const third = await loginFrom('3.3.3.3');
    expect(third.statusCode, third.body).toBe(429);
  });

  async function loginFrom(forwardedFor: string) {
    return app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-forwarded-for': forwardedFor },
      payload: { email: 'operator@example.com', password: 'wrong-password' },
    });
  }
});
