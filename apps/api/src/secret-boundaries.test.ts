/**
 * Secret and configuration boundaries (B-4-3 rotation-validation portion).
 *
 * Rotating a credential safely is a deployment activity; this repository cannot perform one, and this
 * suite does not pretend to. What it CAN prove, credential-free, is the set of properties that make a
 * rotation survivable when the deployment layer does perform it:
 *
 *  * a missing or malformed secret fails CLOSED at startup rather than producing a running-but-insecure
 *    service, so a half-applied rotation is a failed boot, not a silent downgrade;
 *  * no configuration path silently substitutes a usable default for a secret;
 *  * secrets never reach a log line, a metric label, an error message or a trace — the places an
 *    operator looks DURING a rotation, which is exactly when a leak would be most likely to spread;
 *  * a database error does not carry the connection URL, and a provider error does not carry an API key.
 *
 * Every value below is a synthetic literal in this file. No real credential is read, written or needed.
 */
import { describe, expect, it } from 'vitest';
import { corsPolicyFrom, corsPolicyFromEnv } from './cors.js';
import { logFields, REDACTED, logLine } from './observability.js';

/** Synthetic, obviously-fake credentials. These exist only to be asserted ABSENT from output. */
const FAKE = {
  apiKey: 'sk-fake000000000000000000000000000',
  sessionToken: 'sess_fake0000000000000000000000',
  password: 'fake-database-password',
  connectionUrl: 'postgres://appuser:fake-database-password@db.internal:5432/yeonjae',
} as const;

describe('configuration fails closed rather than defaulting a secret into existence', () => {
  it('the database config refuses to invent a connection string when DATABASE_URL is absent', async () => {
    const { configFromEnv } = await import('@yeonjae/db');
    expect(() => configFromEnv({})).toThrow(/DATABASE_URL/);
  });

  it('the database config error names the variable, never a value', async () => {
    const { configFromEnv } = await import('@yeonjae/db');
    let message = '';
    try {
      configFromEnv({});
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('postgres://');
  });

  it('the worker refuses to start without an explicit provider mode, and never defaults to a paid one', async () => {
    const { providerModeFromEnv } = await import('../../worker/src/deps.js');
    const { resolveProvidersFromEnv } = await import('@yeonjae/gateway');
    // An absent mode, an empty mode and an unrecognized mode all fail: there is no permissive branch.
    for (const env of [{}, { YEONJAE_PROVIDER_MODE: '' }, { YEONJAE_PROVIDER_MODE: 'paid' }]) {
      expect(() => providerModeFromEnv(env)).toThrow(/YEONJAE_PROVIDER_MODE/);
    }
    expect(providerModeFromEnv({ YEONJAE_PROVIDER_MODE: 'replay' })).toBe('replay');
    // `live` is a recognized mode, but it never reaches a provider without an explicit key and model
    // names: the resolver fails closed naming the missing variable rather than defaulting anything.
    expect(() => resolveProvidersFromEnv({ YEONJAE_PROVIDER_MODE: 'live' })).toThrow(
      /YEONJAE_LIVE_API_KEY/,
    );
    expect(() =>
      resolveProvidersFromEnv({ YEONJAE_PROVIDER_MODE: 'live', YEONJAE_LIVE_API_KEY: 'k' }),
    ).toThrow(/YEONJAE_MODEL_R/);
  });

  it('CORS is default-deny: unset, empty and whitespace-only all grant nothing', () => {
    for (const env of [{}, { YEONJAE_CORS_ORIGINS: '' }, { YEONJAE_CORS_ORIGINS: '  ,  ' }]) {
      expect(corsPolicyFromEnv(env).origins).toEqual([]);
    }
  });

  it('CORS rejects a credentialed wildcard rather than accepting it as "allow everything"', () => {
    expect(() => corsPolicyFrom(['*'])).toThrow();
  });

  it('CORS rejects a malformed origin at startup instead of silently dropping the typo', () => {
    // A dropped typo produces a deployment that looks configured and refuses every browser request.
    for (const bad of [
      'https://example.com/path',
      'not-an-origin',
      'https://user:pw@example.com',
    ]) {
      expect(() => corsPolicyFrom([bad])).toThrow();
    }
  });
});

describe('secrets never reach logs, metrics, errors or traces', () => {
  it('drops secret-named fields entirely rather than logging their values', () => {
    const fields = logFields({
      password: FAKE.password,
      session_token: FAKE.sessionToken,
      api_key: FAKE.apiKey,
      authorization: `Bearer ${FAKE.sessionToken}`,
      cookie: `sid=${FAKE.sessionToken}`,
      database_url: FAKE.connectionUrl,
      connection_string: FAKE.connectionUrl,
      csrf_token: 'fake-csrf',
    });
    const serialized = JSON.stringify(fields);
    for (const value of Object.values(FAKE)) expect(serialized).not.toContain(value);
    // Dropped entirely: keeping the key would leak that the field existed at all.
    for (const key of ['password', 'session_token', 'api_key', 'authorization', 'cookie']) {
      expect(fields).not.toHaveProperty(key);
    }
  });

  it('is an allowlist, not a blocklist: an unanticipated field is not logged verbatim', () => {
    // The point of default-deny is that a field nobody thought about is absent, not exposed.
    const fields = logFields({
      some_future_credential_holder: FAKE.apiKey,
      provider_bearer_material: FAKE.sessionToken,
    });
    expect(JSON.stringify(fields)).not.toContain(FAKE.apiKey);
    expect(JSON.stringify(fields)).not.toContain(FAKE.sessionToken);
  });

  it('replaces a disallowed value under an allowed key with an explicit marker', () => {
    // Under an allowed key the key itself is useful signal, so the value is marked rather than dropped —
    // absence there would read as "not measured" instead of "withheld".
    const fields = logFields({ job_id: { nested: FAKE.apiKey } });
    expect(fields.job_id).toBe(REDACTED);
    expect(JSON.stringify(fields)).not.toContain(FAKE.apiKey);
  });

  it('a rendered log line carries no credential material', () => {
    const line = logLine(
      { level: 'info', msg: 'job.completed', job_id: '018f0000-0000-7000-8000-000000000000' },
      { api_key: FAKE.apiKey, authorization: `Bearer ${FAKE.sessionToken}` },
    );
    for (const value of Object.values(FAKE)) expect(line).not.toContain(value);
    expect(line).toContain('job.completed');
  });
});

describe('error paths do not reveal credentials', () => {
  it('a database configuration error does not carry a complete connection URL', async () => {
    const { parseDatabaseTarget, describeTarget, redactConnectionUrl } =
      await import('../../../packages/db/src/restore-safety.js');
    const rendered = describeTarget(parseDatabaseTarget(FAKE.connectionUrl));
    expect(rendered).not.toContain(FAKE.password);
    expect(rendered).not.toContain('postgres://');
    expect(redactConnectionUrl(FAKE.connectionUrl)).not.toContain(FAKE.password);
  });

  it('a provider failure classification carries no key material', async () => {
    const { classifyProviderFailure } = await import('@yeonjae/gateway');
    // A provider error object that happens to carry a key must not propagate it into the verdict: the
    // classifier returns a fixed enum member, never an echo of the input.
    const verdict = classifyProviderFailure({
      status: 401,
      message: `invalid api key ${FAKE.apiKey}`,
    });
    expect(verdict).toBe('non_retryable_request');
    expect(JSON.stringify(verdict)).not.toContain(FAKE.apiKey);
  });

  it('provider failure classification fails closed on values it cannot understand', async () => {
    const { classifyProviderFailure, isRetryable } = await import('@yeonjae/gateway');
    // Defect D-3 was a throw on non-object input. Unknown shapes must classify as non-retryable, which
    // is what keeps an unrecognized fault from being rerouted to a second paid model.
    for (const value of [null, undefined, 'a string', 42, [], true]) {
      const verdict = classifyProviderFailure(value);
      expect(isRetryable(verdict)).toBe(false);
    }
  });
});

describe('rotation readiness: what is and is not verified here', () => {
  it('every provider and session secret is referenced by NAME only in .env.example', async () => {
    const { readFileSync } = await import('node:fs');
    const example = readFileSync('.env.example', 'utf8');
    for (const line of example.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [name, ...rest] = trimmed.split('=');
      expect(name, 'each entry must be NAME=').toBeTruthy();
      // A value here would be a committed secret, which AGENTS.md rule 5 forbids outright.
      expect(rest.join('='), `${String(name)} must have no value`).toBe('');
    }
  });

  it('names the secrets a real rotation must cover, so the runbook and the code cannot drift', async () => {
    const { readFileSync } = await import('node:fs');
    const example = readFileSync('.env.example', 'utf8');
    for (const name of [
      'DATABASE_URL',
      'SESSION_SECRET',
      'YEONJAE_LIVE_API_KEY',
      'YEONJAE_LIVE_FALLBACK_API_KEY',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
      'KMS_KEY_REF',
    ]) {
      expect(example).toContain(name);
    }
  });
});
