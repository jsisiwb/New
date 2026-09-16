/**
 * Rate limiting and client-identity unit tests (Checkpoint 7; security plan §2).
 *
 * The clock is injected rather than slept through, so these are deterministic: a `sleep`-based window test
 * is slow and flaky, and flakiness in a security control is how the control ends up disabled.
 *
 * The identity tests are the important half. A limiter keyed on `X-Forwarded-For` is not a limiter at all —
 * an attacker rotates the header and every request looks new, so the control does nothing while appearing
 * configured — and it additionally lets an attacker impersonate a victim's address to exhaust their budget.
 */
import { describe, expect, it } from 'vitest';
import { clientIdentity, DEFAULT_LIMITS, RateLimiter, scopeFor } from './rate-limit.js';

describe('client identity is spoof-resistant', () => {
  it('ignores X-Forwarded-For entirely when no proxy is trusted', () => {
    // The default configuration. A deployment that forgets to configure trusted proxies must get a
    // limiter keyed on the socket, never one keyed on attacker-controlled input.
    expect(clientIdentity({ socketAddress: '10.0.0.1', forwardedFor: '1.2.3.4' })).toBe('10.0.0.1');
    expect(
      clientIdentity(
        { socketAddress: '10.0.0.1', forwardedFor: 'anything, at, all' },
        { trustedProxies: [] },
      ),
    ).toBe('10.0.0.1');
  });

  it('ignores the header when the peer is not one of the trusted proxies', () => {
    // A direct connection claiming to be forwarded is exactly the spoof attempt.
    expect(
      clientIdentity(
        { socketAddress: '203.0.113.9', forwardedFor: '1.2.3.4' },
        { trustedProxies: ['10.0.0.1'] },
      ),
    ).toBe('203.0.113.9');
  });

  it('takes the rightmost untrusted hop when the peer IS a trusted proxy', () => {
    // A client may PREPEND entries, so the leftmost value is attacker-controlled. Walking from the right
    // skips only what the trusted proxies themselves appended.
    expect(
      clientIdentity(
        { socketAddress: '10.0.0.1', forwardedFor: 'spoofed, 198.51.100.7' },
        { trustedProxies: ['10.0.0.1'] },
      ),
    ).toBe('198.51.100.7');
  });

  it('skips trusted hops inside the chain', () => {
    expect(
      clientIdentity(
        { socketAddress: '10.0.0.1', forwardedFor: '198.51.100.7, 10.0.0.2, 10.0.0.1' },
        { trustedProxies: ['10.0.0.1', '10.0.0.2'] },
      ),
    ).toBe('198.51.100.7');
  });

  it('falls back to the peer when every hop is trusted or the header is absent', () => {
    expect(
      clientIdentity(
        { socketAddress: '10.0.0.1', forwardedFor: '10.0.0.2' },
        { trustedProxies: ['10.0.0.1', '10.0.0.2'] },
      ),
    ).toBe('10.0.0.1');
    expect(
      clientIdentity(
        { socketAddress: '10.0.0.1', forwardedFor: undefined },
        { trustedProxies: ['10.0.0.1'] },
      ),
    ).toBe('10.0.0.1');
  });

  it('bounds and discards junk chain entries rather than keying on them', () => {
    const long = 'x'.repeat(500);
    expect(
      clientIdentity(
        { socketAddress: '10.0.0.1', forwardedFor: `${long}, , 198.51.100.7` },
        { trustedProxies: ['10.0.0.1'] },
      ),
    ).toBe('198.51.100.7');
  });

  it('never returns an empty identity, so distinct clients cannot collapse into one bucket', () => {
    expect(clientIdentity({ socketAddress: undefined, forwardedFor: undefined })).toBe('unknown');
  });
});

describe('sliding-window rate limiter', () => {
  it('allows up to the limit and refuses beyond it', () => {
    const now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { auth: { max: 3, windowMs: 60_000 } },
      now: () => now,
    });
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('auth', 'client-a').allowed, `attempt ${i}`).toBe(true);
    }
    const refused = limiter.check('auth', 'client-a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.remaining).toBe(0);
  });

  it('keys per identity, so one client cannot exhaust another’s allowance', () => {
    const now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { auth: { max: 1, windowMs: 60_000 } },
      now: () => now,
    });
    expect(limiter.check('auth', 'client-a').allowed).toBe(true);
    expect(limiter.check('auth', 'client-a').allowed).toBe(false);
    // A different client is unaffected.
    expect(limiter.check('auth', 'client-b').allowed).toBe(true);
  });

  it('keys per scope, so a read flood cannot lock out authentication', () => {
    const now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { read: { max: 1, windowMs: 60_000 }, auth: { max: 1, windowMs: 60_000 } },
      now: () => now,
    });
    expect(limiter.check('read', 'client-a').allowed).toBe(true);
    expect(limiter.check('read', 'client-a').allowed).toBe(false);
    expect(limiter.check('auth', 'client-a').allowed).toBe(true);
  });

  it('slides rather than resetting on a boundary, so a double burst is refused', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { auth: { max: 2, windowMs: 60_000 } },
      now: () => now,
    });
    // Both hits land late in the first nominal minute — the burst a fixed bucket is blind to.
    now += 58_000;
    expect(limiter.check('auth', 'c').allowed).toBe(true);
    now += 1_000;
    expect(limiter.check('auth', 'c').allowed).toBe(true);
    now += 2_000; // t = 61s, where a fixed 1-minute bucket has just rolled over.
    // A fixed bucket would now allow two MORE — 4 requests in 3 seconds while nominally honouring
    // "2 per minute". The sliding window refuses, because both earlier hits are still inside it.
    expect(limiter.check('auth', 'c').allowed).toBe(false);
    // Capacity returns only once the oldest hit genuinely ages out of the window.
    now += 58_000;
    expect(limiter.check('auth', 'c').allowed).toBe(true);
  });

  it('does not count refused attempts, so a limited client is not locked out indefinitely', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { auth: { max: 1, windowMs: 10_000 } },
      now: () => now,
    });
    expect(limiter.check('auth', 'c').allowed).toBe(true);
    // Hammer while refused. If refusals were recorded, they would keep the window permanently full and
    // the lockout would outlive the abuse.
    for (let i = 0; i < 50; i += 1) expect(limiter.check('auth', 'c').allowed).toBe(false);
    now += 10_001;
    expect(limiter.check('auth', 'c').allowed).toBe(true);
  });

  it('reports a retry-after that is actually long enough', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { auth: { max: 1, windowMs: 30_000 } },
      now: () => now,
    });
    limiter.check('auth', 'c');
    const refused = limiter.check('auth', 'c');
    expect(refused.retryAfterSeconds).toBe(30);
    // A client that waits exactly as told succeeds, rather than being refused again immediately.
    now += refused.retryAfterSeconds * 1000;
    expect(limiter.check('auth', 'c').allowed).toBe(true);
  });

  it('sweeps idle windows, so rotating identities cannot grow the map without bound', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({
      limits: { read: { max: 5, windowMs: 1_000 } },
      now: () => now,
    });
    for (let i = 0; i < 500; i += 1) limiter.check('read', `client-${i}`);
    expect(limiter.size()).toBe(500);
    now += 2_000;
    expect(limiter.sweep()).toBe(500);
    expect(limiter.size()).toBe(0);
  });

  it('ships defaults that are tightest where an attempt is most valuable', () => {
    // Auth is the one endpoint where thousands of attempts are useful to an attacker and each costs a
    // scrypt verification, so it must be the tightest; reads must be loose enough for a polling UI.
    expect(DEFAULT_LIMITS.auth.max).toBeLessThan(DEFAULT_LIMITS.job.max);
    expect(DEFAULT_LIMITS.job.max).toBeLessThan(DEFAULT_LIMITS.mutation.max);
    expect(DEFAULT_LIMITS.mutation.max).toBeLessThan(DEFAULT_LIMITS.read.max);
  });
});

describe('scope classification', () => {
  it('classifies from the route pattern and method, not from client-supplied path content', () => {
    expect(scopeFor('POST', '/v1/auth/login')).toBe('auth');
    expect(scopeFor('POST', '/v1/auth/logout')).toBe('auth');
    expect(scopeFor('GET', '/v1/jobs/:jobId/events')).toBe('stream');
    expect(scopeFor('POST', '/v1/jobs/:jobAction')).toBe('job');
    expect(scopeFor('GET', '/v1/projects')).toBe('read');
    expect(scopeFor('GET', '/v1/projects/:projectId/canon/facts')).toBe('read');
    expect(scopeFor('POST', '/v1/projects/:projectId/:canonAction')).toBe('mutation');
    expect(scopeFor('PATCH', '/v1/projects/:projectId')).toBe('mutation');
  });
});
