/**
 * CORS allowlist unit tests (Checkpoint 7; security plan §2).
 *
 * Written as an attack on the matcher, because the failure modes of CORS are all "looks configured, is
 * wide open". The cases that matter are the ones a naive implementation gets wrong: substring matching,
 * reflection, wildcard-with-credentials, and the `null` origin.
 */
import { describe, expect, it } from 'vitest';
import { corsFor, corsPolicyFrom, corsPolicyFromEnv, normalizeOrigin } from './cors.js';

const POLICY = corsPolicyFrom(['https://studio.example.com', 'http://localhost:5173']);

describe('origin normalization', () => {
  it('normalizes scheme, host case and default ports', () => {
    expect(normalizeOrigin('https://Example.COM')).toBe('https://example.com');
    // A browser treats these as the same origin, so the matcher must too.
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com');
    expect(normalizeOrigin('http://example.com:80')).toBe('http://example.com');
    // A non-default port is part of the origin and must be preserved.
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('rejects anything that is not a bare origin', () => {
    for (const bad of [
      undefined,
      '',
      '   ',
      // A browser never sends a path, query or fragment in Origin; their presence means this is not one.
      'https://example.com/',
      'https://example.com/app',
      'https://example.com?x=1',
      'https://example.com#f',
      // Credentials in the authority are a classic confusion trick.
      'https://user:pass@example.com',
      'https://evil.com@example.com',
      'not-a-url',
      'example.com',
      // Non-HTTP schemes cannot be a web origin this API should trust.
      'file://example.com',
      'javascript:alert(1)',
      'data:text/html,x',
    ]) {
      expect(normalizeOrigin(bad), String(bad)).toBeUndefined();
    }
  });

  it('rejects the null origin, which is not attributable to any site', () => {
    // Sandboxed iframes and some redirects send `null`. Allowlisting it would grant access to content
    // whose origin is deliberately opaque.
    expect(normalizeOrigin('null')).toBeUndefined();
    // It cannot even be CONFIGURED: the allowlist refuses it at startup rather than storing a value that
    // would grant access to content whose origin is deliberately opaque.
    expect(() => corsPolicyFrom(['null'])).toThrow(/not a valid origin/i);
    // And a request presenting it is denied.
    expect(corsFor(POLICY, { method: 'GET', origin: 'null' }).denied).toBe(true);
  });
});

describe('policy construction validates at startup', () => {
  it('refuses a wildcard rather than silently downgrading it', () => {
    // This API authenticates with cookies, and `*` cannot be combined with credentials. A deployment that
    // asked for it has a misunderstanding worth failing on.
    expect(() => corsPolicyFrom(['*'])).toThrow(/not permitted/i);
  });

  it('refuses a malformed origin, naming the value', () => {
    expect(() => corsPolicyFrom(['https://ok.example.com', 'nonsense'])).toThrow(/nonsense/);
    expect(() => corsPolicyFrom(['https://example.com/app'])).toThrow(/example\.com\/app/);
  });

  it('accepts several origins, de-duplicating equivalent forms', () => {
    const policy = corsPolicyFrom([
      'https://a.example.com',
      'https://a.example.com:443',
      ' https://b.example.com ',
      '',
    ]);
    expect(policy.origins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('reads a comma-separated environment variable, empty meaning deny all', () => {
    expect(
      corsPolicyFromEnv({ YEONJAE_CORS_ORIGINS: 'https://a.example.com,https://b.example.com' })
        .origins,
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(corsPolicyFromEnv({}).origins).toEqual([]);
    expect(corsPolicyFromEnv({ YEONJAE_CORS_ORIGINS: '' }).origins).toEqual([]);
  });
});

describe('decisions', () => {
  it('grants an allowlisted origin with credentials and never a wildcard', () => {
    const d = corsFor(POLICY, { method: 'GET', origin: 'https://studio.example.com' });
    expect(d.denied).toBe(false);
    expect(d.headers['access-control-allow-origin']).toBe('https://studio.example.com');
    expect(d.headers['access-control-allow-credentials']).toBe('true');
    // `*` with credentials is forbidden by the spec and would be catastrophic here.
    expect(Object.values(d.headers)).not.toContain('*');
  });

  it('denies an origin that is not configured, without failing the request itself', () => {
    const d = corsFor(POLICY, { method: 'GET', origin: 'https://evil.example.net' });
    expect(d.denied).toBe(true);
    // No grant is emitted; the browser is what refuses. A 403 here would confirm the origin was evaluated.
    expect(d.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never reflects an arbitrary Origin', () => {
    // Reflection plus credentials is functionally "no same-origin policy". This is the single most
    // important assertion in the file.
    for (const origin of [
      'https://attacker.example',
      'http://studio.example.com', // right host, WRONG scheme
      'https://studio.example.com:8443', // right host, wrong port
    ]) {
      const d = corsFor(POLICY, { method: 'GET', origin });
      expect(d.denied, origin).toBe(true);
      expect(d.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('is immune to prefix, suffix and substring lookalikes', () => {
    // Every one of these passes a `startsWith`, `endsWith` or `includes` check against
    // "https://studio.example.com" and must still be refused.
    for (const origin of [
      'https://studio.example.com.evil.net', // suffix attack on the host
      'https://evil-studio.example.com', // prefix attack
      'https://studio.example.company', // TLD extension
      'https://xstudio.example.com',
      'https://studio.example.com.',
      'https://sub.studio.example.com', // a subdomain is a DIFFERENT origin
    ]) {
      expect(corsFor(POLICY, { method: 'GET', origin }).denied, origin).toBe(true);
    }
  });

  it('adds Vary: Origin even when denying, so a cache cannot cross the allowlist', () => {
    // Without Vary a shared cache can serve an allowed-origin response to a denied origin.
    expect(
      corsFor(POLICY, { method: 'GET', origin: 'https://studio.example.com' }).headers.vary,
    ).toBe('Origin');
    expect(
      corsFor(POLICY, { method: 'GET', origin: 'https://evil.example.net' }).headers.vary,
    ).toBe('Origin');
  });

  it('leaves a same-origin request (no Origin header) completely untouched', () => {
    const d = corsFor(POLICY, { method: 'GET', origin: undefined });
    expect(d.denied).toBe(false);
    expect(d.headers).toEqual({});
  });

  it('answers a preflight with explicit methods and headers, not a reflection', () => {
    const d = corsFor(POLICY, { method: 'OPTIONS', origin: 'http://localhost:5173' });
    expect(d.preflight).toBe(true);
    expect(d.headers['access-control-allow-methods']).toContain('POST');
    expect(d.headers['access-control-allow-methods']).toContain('OPTIONS');
    // Explicit list: reflecting Access-Control-Request-Headers would permit any header a page chose.
    expect(d.headers['access-control-allow-headers']).toContain('x-csrf-token');
    expect(d.headers['access-control-allow-headers']).toContain('idempotency-key');
    expect(d.headers['access-control-max-age']).toBeTruthy();
  });

  it('denies every origin when the allowlist is empty', () => {
    const empty = corsPolicyFrom([]);
    expect(corsFor(empty, { method: 'GET', origin: 'https://studio.example.com' }).denied).toBe(
      true,
    );
    // …while same-origin traffic still works, so an unconfigured deployment is strict, not broken.
    expect(corsFor(empty, { method: 'GET', origin: undefined }).headers).toEqual({});
  });
});
