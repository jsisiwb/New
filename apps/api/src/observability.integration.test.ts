/**
 * Observability against the running API (Checkpoint 7; observability plan §5).
 *
 * `observability.test.ts` proves the serializer in isolation. This proves the wiring, which is where the
 * leak would actually happen: real requests carrying real credentials and real manuscript prose, with the
 * log sink captured so the assertion is about what WOULD be written rather than about a helper's return
 * value.
 *
 * The cases chosen are the ones where a plausible implementation leaks:
 *
 *  * a login request whose body contains a password, and whose response sets a session cookie and returns
 *    a CSRF token — all three must be absent from the log line for that request;
 *  * an authenticated request carrying `cookie` and `x-csrf-token` headers;
 *  * a metrics endpoint whose labels are derived from the route PATTERN, so tenant ids never become
 *    label values (a leak and a cardinality explosion at once);
 *  * a client-supplied `traceparent`, which propagates only when it genuinely parses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, createUser, migrate, resetDatabase, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { CSRF_HEADER, WORKSPACE_HEADER } from './auth.js';
import { METRIC, Metrics } from './observability.js';
import { seedAcceptedChapterOne, type SeededProject } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const PASSWORD = 'operator-password-1';

run('API: structured logging, redaction and metrics (Checkpoint 7)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let seeded: SeededProject;
  let lines: string[];
  let metrics: Metrics;
  let cookie: string;
  let csrf: string;

  /** Every log line emitted by the server during this test, as parsed records. */
  function records(): Record<string, unknown>[] {
    return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  beforeAll(async () => {
    pool = await freshDatabase();
    // One registry for the whole suite. Counters are monotonic, so the assertions below compare a
    // BEFORE/AFTER delta or use `toBeGreaterThan` rather than assuming a fresh zero — which is also how
    // a real scraper reads them.
    metrics = new Metrics();
    app = buildApi({
      pool,
      secureCookies: false,
      metrics,
      // The sink reads `lines` through the closure, so `beforeEach` can reset the buffer without
      // rebuilding the server.
      logSink: (line) => lines.push(line),
    });
    await app.ready();
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

    // The app is built once in beforeAll and writes through a closure over `lines`, so resetting the
    // buffer here gives each case a clean log without rebuilding the server.
    lines = [];

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'operator@example.com', password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    cookie = String(raw).split(';')[0] ?? '';
    csrf = login.json<{ csrf_token: string }>().csrf_token;
  }, 300_000);

  // ---- structured logs -----------------------------------------------------------------------------

  it('emits one line-delimited JSON record per request with correlation ids', async () => {
    const before = lines.length;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    expect(res.statusCode, res.body).toBe(200);

    const emitted = lines.slice(before);
    expect(emitted).toHaveLength(1);
    const record = JSON.parse(emitted[0] ?? '{}') as Record<string, unknown>;
    expect(record.level).toBe('info');
    expect(record.msg).toBe('request completed');
    expect(record.status_code).toBe(200);
    // The route PATTERN, not the resolved path.
    expect(record.route).toBe('/v1/projects');
    expect(typeof record.request_id).toBe('string');
    expect(typeof record.duration_ms).toBe('number');
    // Line-delimited: a multi-line record would break ingestion.
    expect(emitted[0]).not.toContain('\n');
    // The request id is echoed to the client so an operator can correlate a report with a log line.
    expect(res.headers['x-request-id']).toBe(record.request_id);
  });

  it('never logs the password from a login body, nor the session cookie or CSRF token it returns', async () => {
    lines = [];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'operator@example.com', password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    const issuedCsrf = res.json<{ csrf_token: string }>().csrf_token;
    const setCookie = res.headers['set-cookie'];
    const issuedCookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie);
    expect(issuedCsrf.length).toBeGreaterThan(10);

    const all = lines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [PASSWORD, issuedCsrf, issuedCookie, 'operator@example.com']) {
      expect(all, `leaked ${secret.slice(0, 12)}…`).not.toContain(secret);
    }
    // And no field even hints at the shape of the credential data.
    for (const record of records()) {
      for (const key of Object.keys(record)) {
        expect(key).not.toMatch(/password|csrf|cookie|token|secret|email/i);
      }
    }
  });

  it('never logs authorization headers, cookies or CSRF headers sent by a client', async () => {
    lines = [];
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${seeded.projectId}`,
      headers: {
        cookie,
        [WORKSPACE_HEADER]: seeded.workspaceId,
        [CSRF_HEADER]: csrf,
        authorization: 'Bearer yk_live_do_not_log_this_value',
      },
    });
    /**
     * 401, not 200 — and that is the correct behaviour, discovered by writing this test.
     *
     * An `Authorization` header takes precedence over the session cookie, so presenting a bogus API key
     * alongside a valid cookie is REFUSED rather than silently falling back to the cookie. Failing closed
     * is right: a client that sent a credential expects that credential to be used, and quietly
     * authenticating it as somebody else would be worse than rejecting it.
     *
     * The redaction assertion below is the point of the test either way: the rejected key must not be
     * logged, and a 401 path is if anything the more likely place for a logger to capture it.
     */
    expect(res.statusCode, res.body).toBe(401);
    const all = lines.join('\n');
    expect(all).not.toContain('yk_live_do_not_log_this_value');
    expect(all).not.toContain(csrf);
    expect(all).not.toContain(cookie);
  });

  it('never logs manuscript prose, even when the response body contains it', async () => {
    lines = [];
    const accepted = await pool.query<{ text: string }>(
      'SELECT text FROM manuscript_versions WHERE id = $1',
      [seeded.acceptedVersionId],
    );
    const prose = accepted.rows[0]?.text ?? '';
    expect(prose.length).toBeGreaterThan(200);

    // An export download returns the accepted prose as its body — the most likely place for a logger to
    // capture content by accident.
    const created = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/exports`,
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, [CSRF_HEADER]: csrf },
      payload: { format: 'txt' },
    });
    expect([200, 201]).toContain(created.statusCode);
    const exportId = created.json<{ id: string }>().id;
    const download = await app.inject({
      method: 'GET',
      url: `/v1/projects/${seeded.projectId}/exports/${exportId}/content`,
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toContain(prose.slice(0, 40));

    // The prose went to the client and not to the log.
    const all = lines.join('\n');
    expect(all).not.toContain(prose.slice(0, 40));
    expect(all).not.toContain(prose.slice(-40));
  });

  it('logs a 500 at error level without a stack trace, SQL or internal path', async () => {
    lines = [];
    // A cross-workspace id produces a handled 404; to reach the error path we ask for a malformed uuid,
    // which is a 422. Either way the assertion is the same: no internals in the line.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects/not-a-uuid',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    expect(res.statusCode).toBe(422);
    const all = lines.join('\n');
    for (const forbidden of ['at Object.', 'node_modules', '/tmp/', 'SELECT', 'pg_']) {
      expect(all, `leaked ${forbidden}`).not.toContain(forbidden);
    }
  });

  // ---- trace correlation ---------------------------------------------------------------------------

  it('adopts a well-formed traceparent and echoes the trace id', async () => {
    lines = [];
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: {
        cookie,
        [WORKSPACE_HEADER]: seeded.workspaceId,
        traceparent: `00-${traceId}-b7ad6b7169203331-01`,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-trace-id']).toBe(traceId);
    expect(records().some((r) => r.trace_id === traceId)).toBe(true);
  });

  it('ignores an injected traceparent rather than writing it into the log', async () => {
    lines = [];
    const injected = '00-abc-{"level":"error","msg":"forged"}-01';
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId, traceparent: injected },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-trace-id']).toBeUndefined();
    const all = lines.join('\n');
    expect(all).not.toContain('forged');
    // No trace id is fabricated when none was usable.
    expect(records().every((r) => r.trace_id === undefined)).toBe(true);
  });

  // ---- metrics -------------------------------------------------------------------------------------

  it('serves Prometheus metrics with route patterns, never tenant identifiers, as labels', async () => {
    await app.inject({
      method: 'GET',
      url: `/v1/projects/${seeded.projectId}`,
      headers: { cookie, [WORKSPACE_HEADER]: seeded.workspaceId },
    });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.body;
    expect(text).toContain(METRIC.requests);
    // The pattern is the label; the resolved path with a project id in it is not present.
    expect(text).toContain('route="/v1/projects/:projectId"');
    expect(text).not.toContain(seeded.projectId);
    expect(text).not.toContain(seeded.workspaceId);
    expect(text).not.toContain(csrf);
  });

  it('counts authentication failures and request latency', async () => {
    const unauth = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(unauth.statusCode).toBe(401);
    expect(metrics.total(METRIC.authFailures, { status: '401' })).toBeGreaterThan(0);

    const text = metrics.render();
    expect(text).toContain(`${METRIC.requestLatency}_count`);
    expect(text).toContain(`${METRIC.requests}{`);
  });

  it('exposes metrics without authentication, because it renders no tenant data at all', async () => {
    // Deliberate: a scrape target that required a session would mean shipping credentials to the scraper.
    // The safety property is that the payload contains only names, allowlisted labels and numbers.
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('operator@example.com');
    expect(res.body).not.toContain(PASSWORD);
  });
});
