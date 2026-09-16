/**
 * CORS: an explicit origin allowlist, default-deny (Checkpoint 7; security plan §2, API plan §2).
 *
 * The browser's same-origin policy is what stops a malicious page reading an authenticated response from
 * this API. CORS is the mechanism for *relaxing* that, so every decision here is about relaxing it as
 * narrowly as possible and never by accident.
 *
 * Four rules, each of which exists because the obvious shortcut is a vulnerability:
 *
 *  1. DEFAULT DENY. With no configured origins, no CORS header is emitted at all. Same-origin requests are
 *     unaffected (the browser never consults CORS for them), so an unconfigured deployment is strict rather
 *     than broken.
 *
 *  2. NEVER REFLECT AN ARBITRARY ORIGIN. Echoing back whatever `Origin` arrived, which is the most common
 *     "just make it work" fix, combined with `Allow-Credentials: true` lets ANY site read authenticated
 *     responses — it is functionally the same as having no same-origin policy. An origin is allowed only if
 *     it is in the configured set.
 *
 *  3. NO WILDCARD WITH CREDENTIALS. `Access-Control-Allow-Origin: *` is refused at configuration time
 *     rather than silently downgraded, because this API authenticates with cookies and the combination is
 *     forbidden by the spec anyway — a deployment that asked for it has a misunderstanding worth failing on.
 *
 *  4. EXACT MATCH ON THE PARSED ORIGIN, never a prefix, suffix or substring test. `startsWith` /
 *     `endsWith` matching is how `https://evil-example.com` is admitted by a rule meant for
 *     `https://example.com`, and how `https://example.com.evil.net` is admitted by a suffix rule. Scheme,
 *     host and port are compared as parsed components.
 */
import { ApiError } from './problem.js';

/** Methods a browser may use cross-origin against this API. */
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

/**
 * Request headers a browser may send cross-origin.
 *
 * An explicit list rather than a reflection of `Access-Control-Request-Headers`: reflecting would let a
 * page probe which headers the server tolerates, and would permit any header the browser is willing to
 * send. These are exactly the ones the operator UI needs.
 */
const ALLOWED_HEADERS = 'content-type, x-workspace-id, x-csrf-token, idempotency-key, traceparent';

/** Response headers a browser page may read cross-origin. */
const EXPOSED_HEADERS = 'x-request-id, x-trace-id, retry-after';

/** How long a browser may cache a preflight result. Ten minutes: long enough to matter, short enough that
 * an allowlist change takes effect promptly. */
const MAX_AGE_SECONDS = 600;

export interface CorsPolicy {
  /** Exact, normalized origins that may make credentialed cross-origin requests. Empty means deny all. */
  readonly origins: readonly string[];
}

/**
 * Normalize an origin to `scheme://host[:port]`, or `undefined` when it is not a usable origin.
 *
 * Parsing rather than string comparison is the point. The default port for the scheme is dropped so
 * `https://example.com` and `https://example.com:443` are the same origin (they are, to a browser), and
 * anything carrying a path, query or fragment is rejected — a browser never sends those in `Origin`, so
 * their presence means the value is not a real origin.
 */
export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  // `null` is a legitimate browser Origin (sandboxed iframes, some redirects) and must never be allowlisted
  // — it is not attributable to any site.
  if (trimmed === '' || trimmed === 'null') return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  // A real `Origin` is scheme + host + port and nothing else.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  if (trimmed.endsWith('/')) return undefined;
  if (url.hostname === '') return undefined;
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  const port = url.port === '' || url.port === defaultPort ? '' : `:${url.port}`;
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
}

/**
 * Build a policy from configured origins, failing loudly on anything unusable.
 *
 * Startup validation rather than per-request tolerance: a typo'd origin that is silently dropped produces a
 * deployment that looks configured and denies every request, which is debugged by staring at browser
 * console errors. Failing at boot names the exact value.
 */
export function corsPolicyFrom(configured: readonly string[]): CorsPolicy {
  const origins: string[] = [];
  for (const raw of configured) {
    const value = raw.trim();
    if (value === '') continue;
    if (value === '*')
      throw new Error(
        'CORS: "*" is not permitted. This API authenticates with cookies, and a wildcard origin cannot be combined with credentials; list exact origins instead.',
      );
    const normalized = normalizeOrigin(value);
    if (!normalized)
      throw new Error(
        `CORS: "${value}" is not a valid origin. Use scheme://host[:port] with no path, query or credentials.`,
      );
    if (!origins.includes(normalized)) origins.push(normalized);
  }
  return { origins };
}

/** Parse the `YEONJAE_CORS_ORIGINS` environment variable: a comma-separated list, empty means deny all. */
export function corsPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): CorsPolicy {
  return corsPolicyFrom((env.YEONJAE_CORS_ORIGINS ?? '').split(','));
}

export interface CorsDecision {
  /** Headers to set on the response. Empty when the request gets no CORS grant at all. */
  readonly headers: Readonly<Record<string, string>>;
  /** True when this is a preflight that should be answered immediately with 204. */
  readonly preflight: boolean;
  /** True when an Origin was present and NOT allowed. */
  readonly denied: boolean;
}

/**
 * Decide the CORS response for one request.
 *
 * A denied cross-origin request is NOT failed with an error status. It is answered with no CORS headers,
 * which is what makes the browser refuse it — and refusing in the browser is the correct layer, because a
 * 403 here would be indistinguishable from an authorization failure and would leak that the origin was
 * considered at all. `denied` is returned so the caller can count it as a metric.
 */
export function corsFor(
  policy: CorsPolicy,
  request: { method: string; origin: string | undefined },
): CorsDecision {
  const isPreflight = request.method === 'OPTIONS';
  const origin = normalizeOrigin(request.origin);

  // No Origin header: a same-origin request, a server-to-server call or a curl. CORS does not apply, and
  // adding headers would only invite caches to vary on nothing.
  if (request.origin === undefined) return { headers: {}, preflight: false, denied: false };

  /**
   * `Vary: Origin` is set even when the origin is refused.
   *
   * Without it a shared cache can serve a response computed for an allowed origin to a disallowed one (or
   * the reverse), which turns a correct allowlist into an incorrect one at the cache layer.
   */
  const vary = { vary: 'Origin' };

  if (!origin || !policy.origins.includes(origin))
    return { headers: vary, preflight: isPreflight, denied: true };

  const headers: Record<string, string> = {
    ...vary,
    // The exact configured origin, never `*`, because credentials are in play.
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-expose-headers': EXPOSED_HEADERS,
  };
  if (isPreflight) {
    headers['access-control-allow-methods'] = ALLOWED_METHODS;
    headers['access-control-allow-headers'] = ALLOWED_HEADERS;
    headers['access-control-max-age'] = String(MAX_AGE_SECONDS);
  }
  return { headers, preflight: isPreflight, denied: false };
}

/** A preflight for an origin that is not allowed. Answered 403 so the failure is legible in dev tools. */
export function corsPreflightDenied(): ApiError {
  return new ApiError('FORBIDDEN', 'This origin is not permitted to make cross-origin requests.');
}
