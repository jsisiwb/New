/**
 * CORS against the running API (Checkpoint 7; security plan §2).
 *
 * The unit suite proves the matcher. This proves the WIRING, where the realistic mistakes live: a
 * preflight that requires authentication (and so can never succeed), security headers dropped on the
 * OPTIONS path, or a grant emitted on a response the browser should refuse.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, createUser, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { RateLimiter } from './rate-limit.js';
import { WORKSPACE_HEADER } from './auth.js';
import { seedAcceptedChapterOne, type SeededProject } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const ALLOWED = 'https://studio.example.com';
const ALSO_ALLOWED = 'http://localhost:5173';
const DENIED = 'https://evil.example.net';
const PASSWORD = 'operator-password-1';

run('API: CORS allowlist (Checkpoint 7)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  /** A second instance with NO configured origins, for the default-deny case. */
  let strict: FastifyInstance;
  let seeded: SeededProject;
  let cookie: string;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await strict.close();
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

    if (built) {
      await app.close();
      await strict.close();
    }
    built = true;
    app = buildApi({
      pool,
      secureCookies: false,
      corsOrigins: [ALLOWED, ALSO_ALLOWED],
      rateLimiter: RateLimiter.disabled(),
    });
    strict = buildApi({ pool, secureCookies: false, rateLimiter: RateLimiter.disabled() });
    await app.ready();
    await strict.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'operator@example.com', password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    const setCookie = login.headers['set-cookie'];
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';
  }, 300_000);

  let built = false;

  it('grants an allowlisted origin, echoing it exactly and never a wildcard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, origin: ALLOWED },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers.vary).toContain('Origin');
  });

  it('serves a second configured origin, so the allowlist is genuinely a list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, origin: ALSO_ALLOWED },
    });
    expect(res.headers['access-control-allow-origin']).toBe(ALSO_ALLOWED);
  });

  it('emits no grant for a denied origin, and the request itself is not failed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, origin: DENIED },
    });
    // The request succeeds server-side; the BROWSER refuses it for want of a grant. Failing here with a
    // 403 would be indistinguishable from an authorization error and would confirm the origin was seen.
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    // Vary is still set, so a shared cache cannot serve this to an allowed origin or vice versa.
    expect(res.headers.vary).toContain('Origin');
  });

  it('never grants a lookalike, subdomain or wrong-scheme origin', async () => {
    for (const origin of [
      'https://studio.example.com.evil.net',
      'https://evil-studio.example.com',
      'https://sub.studio.example.com',
      'http://studio.example.com',
      'https://studio.example.com:8443',
      'null',
      'not-a-url',
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/projects',
        headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, origin },
      });
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('answers a preflight WITHOUT authentication, with explicit methods and headers', async () => {
    // No cookie: a browser sends no credentials on a preflight, so a preflight that required auth could
    // never succeed and every cross-origin write would fail.
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/projects',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-csrf-token',
      },
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('x-csrf-token');
    expect(res.headers['access-control-allow-headers']).toContain('idempotency-key');
    expect(res.headers['access-control-max-age']).toBeTruthy();
  });

  it('refuses a preflight from a denied origin with an explicit 403', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/projects',
      headers: { origin: DENIED, 'access-control-request-method': 'POST' },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps the standard security headers on CORS and preflight responses', async () => {
    const pre = await app.inject({
      method: 'OPTIONS',
      url: '/v1/projects',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(pre.headers['x-content-type-options']).toBe('nosniff');
    expect(pre.headers['x-frame-options']).toBe('DENY');
    expect(pre.headers['x-request-id']).toBeDefined();
  });

  it('leaves same-origin requests untouched — no Origin, no CORS headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers.vary).toBeUndefined();
  });

  it('denies every origin when nothing is configured, while same-origin still works', async () => {
    const cross = await strict.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, origin: ALLOWED },
    });
    expect(cross.headers['access-control-allow-origin']).toBeUndefined();

    // An unconfigured deployment is STRICT, not broken: same-origin traffic is unaffected.
    const same = await strict.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    expect(same.statusCode, same.body).toBe(200);
  });

  it('does not let a CORS grant substitute for authentication', async () => {
    // An allowlisted origin is still anonymous until it authenticates. Conflating the two would turn the
    // allowlist into an authorization mechanism, which it is not.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { origin: ALLOWED },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
    // The grant is still emitted, so the browser can READ the 401 and react to it.
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('refuses to start with an invalid origin configuration', () => {
    // Startup validation: a typo that was silently dropped would produce a deployment that looks
    // configured and denies everything, debugged only through browser console errors.
    expect(() => buildApi({ pool, corsOrigins: ['*'] })).toThrow(/not permitted/i);
    expect(() => buildApi({ pool, corsOrigins: ['https://ok.example.com', 'nonsense'] })).toThrow(
      /nonsense/,
    );
  });
});
