/**
 * Rate limiting and spoof-resistant client identity (Checkpoint 7; security plan §2).
 *
 * Two decisions here are the substance of this module, and both are about failing safely rather than
 * conveniently.
 *
 * 1. CLIENT IDENTITY IS NOT TAKEN FROM A HEADER UNLESS A PROXY IS EXPLICITLY TRUSTED.
 *    `X-Forwarded-For` is client-controlled. A limiter keyed on it is not a limiter: an attacker rotates
 *    the header and every request looks like a new client, so the control silently does nothing while
 *    appearing to be configured. Worse, it lets an attacker impersonate a victim's IP and exhaust *their*
 *    budget. So the socket address is the default identity, and a forwarded header is consulted ONLY when
 *    the deployment names its trusted proxies. When it is trusted, the rightmost-untrusted address is
 *    taken — walking from the right skips the addresses a client can prepend.
 *
 * 2. LIMITS ARE PER-PROCESS AND SAID TO BE. This is an in-memory sliding window. It resets on restart and
 *    is not shared between instances, so N instances permit roughly N× the configured rate. That is a real
 *    limitation, documented in the runbooks rather than papered over: calling this "distributed rate
 *    limiting" would be the kind of claim this project exists to avoid. It is still worth having — it stops
 *    a single client hammering one instance, which is the common case — and the interface is narrow enough
 *    that a Redis-backed store can replace the map without touching the call sites.
 */
import { ApiError } from './problem.js';

/** A limit: at most `max` events per `windowMs` for one key. */
export interface LimitRule {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * The default limits, by scope.
 *
 * Authentication is the tightest because it is the one endpoint where a single client can usefully make
 * thousands of attempts (credential stuffing), and where each attempt costs a scrypt verification.
 * Job starts are next: each one can spend real money. Ordinary reads are loose enough that an operator UI
 * polling an inspector never trips them.
 */
export const DEFAULT_LIMITS: Readonly<Record<LimitScope, LimitRule>> = {
  // 10 attempts/minute per client. Slow enough to make online guessing useless, generous enough that a
  // human mistyping a password three times is unaffected.
  auth: { max: 10, windowMs: 60_000 },
  // Mutations can commit canon or start spend.
  mutation: { max: 60, windowMs: 60_000 },
  // Job control and production starts.
  job: { max: 20, windowMs: 60_000 },
  // Long-lived streams: the cost is a held connection, not CPU.
  stream: { max: 30, windowMs: 60_000 },
  read: { max: 300, windowMs: 60_000 },
};

export type LimitScope = 'auth' | 'mutation' | 'job' | 'stream' | 'read';

export interface ClientIdentityOptions {
  /**
   * Addresses of proxies whose forwarding headers may be believed.
   *
   * Empty by default, which means forwarding headers are ignored entirely. That default is deliberate: a
   * deployment that forgets to configure this gets a limiter keyed on the socket address (correct but
   * possibly coarse behind a load balancer), never one keyed on attacker-controlled input.
   */
  readonly trustedProxies?: readonly string[] | undefined;
}

export interface RequestIdentity {
  readonly socketAddress: string | undefined;
  readonly forwardedFor: string | undefined;
}

/**
 * Resolve the identity a rate limit is keyed on.
 *
 * Returns the socket address unless it belongs to a trusted proxy, in which case the rightmost address in
 * `X-Forwarded-For` that is NOT itself a trusted proxy is used. Walking from the right is what makes this
 * spoof-resistant: a client may prepend arbitrary entries, but it cannot append after the ones the trusted
 * proxies themselves added.
 */
export function clientIdentity(
  request: RequestIdentity,
  options: ClientIdentityOptions = {},
): string {
  const socket = request.socketAddress ?? 'unknown';
  const trusted = options.trustedProxies ?? [];
  // No configured proxy: the header is ignored, whatever it says.
  if (trusted.length === 0) return socket;
  if (!trusted.includes(socket)) return socket;
  const chain = (request.forwardedFor ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 64);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const candidate = chain[i];
    if (candidate !== undefined && !trusted.includes(candidate)) return candidate;
  }
  // Every hop was a trusted proxy (or the header was absent): the nearest proxy is the best identity.
  return socket;
}

interface Window {
  /** Event timestamps within the current window, oldest first. */
  readonly hits: number[];
}

/**
 * A sliding-window rate limiter.
 *
 * Sliding rather than fixed-bucket because a fixed bucket permits a double burst across a boundary: 10
 * requests at 59s and 10 more at 61s is 20 in two seconds while satisfying "10 per minute". For an auth
 * limit that difference is the whole point.
 */
export class RateLimiter {
  /**
   * A limiter that enforces nothing.
   *
   * Integration suites authenticate dozens of times from one identity, which legitimately exceeds the
   * production auth limit — so they construct this rather than the suites each inventing a "big enough"
   * number, and rather than the production default being loosened to accommodate tests. The limiter's own
   * behaviour is proved directly in `rate-limit.test.ts` with an injected clock, and end to end in
   * `rate-limit.integration.test.ts` with a deliberately tiny limit, so disabling it elsewhere removes no
   * coverage.
   */
  static disabled(): RateLimiter {
    const unlimited: LimitRule = { max: Number.MAX_SAFE_INTEGER, windowMs: 1 };
    return new RateLimiter({
      limits: {
        auth: unlimited,
        mutation: unlimited,
        job: unlimited,
        stream: unlimited,
        read: unlimited,
      },
    });
  }

  private readonly windows = new Map<string, Window>();
  private readonly limits: Readonly<Record<LimitScope, LimitRule>>;
  /** Injectable clock so the tests are deterministic instead of sleeping through real windows. */
  private readonly now: () => number;

  constructor(
    options: {
      limits?: Partial<Record<LimitScope, LimitRule>> | undefined;
      now?: (() => number) | undefined;
    } = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
    this.now = options.now ?? (() => Date.now());
  }

  ruleFor(scope: LimitScope): LimitRule {
    return this.limits[scope];
  }

  /**
   * Record an event and report whether it is allowed.
   *
   * The event is recorded only when allowed. Counting refused attempts too would let a client that is
   * already over the limit keep its own window permanently full, turning a temporary limit into a
   * self-inflicted lockout that outlives the abuse.
   */
  check(
    scope: LimitScope,
    identity: string,
  ): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    const rule = this.limits[scope];
    const key = `${scope}|${identity}`;
    const now = this.now();
    const cutoff = now - rule.windowMs;
    const existing = this.windows.get(key)?.hits ?? [];
    // Drop expired hits; this is also the only eviction the map needs for an active key.
    const hits = existing.filter((t) => t > cutoff);
    if (hits.length >= rule.max) {
      const oldest = hits[0] ?? now;
      return {
        allowed: false,
        // When the oldest hit leaves the window, one slot frees up. Rounded up so a client that obeys the
        // hint is never refused again immediately.
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
        remaining: 0,
      };
    }
    hits.push(now);
    this.windows.set(key, { hits });
    return { allowed: true, retryAfterSeconds: 0, remaining: rule.max - hits.length };
  }

  /**
   * Drop windows with no recent activity.
   *
   * Without this the map grows once per distinct client forever, which is a memory leak an attacker can
   * drive by rotating identities. Call it periodically; it is cheap and idempotent.
   */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, window] of this.windows) {
      // The scope is recovered from the composite key. It is always one this limiter configured, because
      // `check` is the only writer and it takes a typed scope.
      const scope = key.slice(0, key.indexOf('|')) as LimitScope;
      const rule = this.limits[scope];
      if (window.hits.every((t) => t <= now - rule.windowMs)) {
        this.windows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of tracked windows, for the leak test. */
  size(): number {
    return this.windows.size;
  }
}

/**
 * Raise the rate-limit problem document.
 *
 * `RATE_LIMITED` is an existing code in the problem vocabulary, so this introduces no new error language.
 * `retry_after_seconds` is included in the safe structured data because a client that cannot tell how long
 * to wait will simply retry immediately and stay limited.
 */
export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError('RATE_LIMITED', 'Too many requests; retry later.', {
    data: { retry_after_seconds: retryAfterSeconds },
  });
}

/**
 * Classify a request into a limit scope.
 *
 * Derived from the route pattern and method rather than the resolved path, so the classification cannot be
 * changed by what a client puts in a path segment.
 */
export function scopeFor(method: string, routePattern: string): LimitScope {
  if (routePattern.startsWith('/v1/auth/')) return 'auth';
  if (routePattern.endsWith('/events')) return 'stream';
  if (routePattern.includes('/jobs/') || routePattern.includes(':generate')) return 'job';
  return method === 'GET' || method === 'HEAD' ? 'read' : 'mutation';
}
