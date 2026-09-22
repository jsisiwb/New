/**
 * An HTTP provider adapter.
 *
 * This is the adapter shape a real provider would use, exercised against the local synthetic service so
 * the transport boundary is tested without contacting anyone. `MockProvider` returns values; this one
 * opens a socket, so it is the only place where a reset connection, a truncated body, a 429 with
 * `Retry-After` or an oversized response can actually be observed.
 *
 * FOUR DECISIONS carry the weight, and each one is a place a naive adapter quietly does the wrong thing:
 *
 *   1. EVERY FAILURE IS CLASSIFIED, never passed through raw. The gateway decides whether to retry and
 *      whether fallback is AUTHORIZED from the failure class (B-4-2), so an unclassified error would
 *      default to the most expensive interpretation. A 429 and a 503 are retryable; a 400 or a 401 are
 *      not, because re-sending the same bytes to a second paid model cannot fix them.
 *   2. CANCELLATION IS PROPAGATED AND THEN TOLD APART FROM A FAILURE. An abort raises a
 *      `CancellationError`, not a transport failure — the classifier's transport pattern matches the word
 *      "aborted", so treating an abort as retryable would turn one cancellation into N paid attempts
 *      (ADR-0049).
 *   3. THE BODY IS BOUNDED. A response is read with a byte ceiling and the socket is destroyed when it is
 *      exceeded, so a misbehaving or hostile endpoint cannot exhaust memory.
 *   4. MISSING USAGE STAYS MISSING. A provider that reports no usage yields `undefined`, never zeros, so
 *      the accounting layer can record "unknown" rather than a false zero.
 *
 * The endpoint is configuration, and it is validated: only http/https, and by default only loopback, so a
 * misconfigured or attacker-supplied endpoint cannot be used to reach internal services (SSRF).
 */
import { CancellationError } from './cancellation.js';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ProviderFailure, type FailureClass } from './failures.js';
import {
  type FinishReason,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
} from './types.js';

export interface HttpProviderOptions {
  readonly name: string;
  /** Base URL of the provider endpoint. Validated at construction. */
  readonly baseUrl: string;
  /** Extra headers per request. Never logged; never a credential in this repository. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Hard ceiling on a response body. Default 1 MiB. */
  readonly maxResponseBytes?: number | undefined;
  /** Whole-request deadline in milliseconds. Default 30 s. */
  readonly timeoutMs?: number | undefined;
  /**
   * Allow a non-loopback endpoint.
   *
   * Default false. A provider URL is configuration, and configuration is sometimes attacker-influenced;
   * refusing anything but loopback by default means a mistake cannot turn this adapter into an SSRF
   * primitive against internal services. A real deployment sets this deliberately.
   */
  readonly allowNonLoopback?: boolean | undefined;
}

/** Wire shape the adapter accepts. A response that does not match is a provider failure, not a guess. */
interface WireResponse {
  readonly modelId?: unknown;
  readonly provider?: unknown;
  readonly providerRequestId?: unknown;
  readonly text?: unknown;
  readonly json?: unknown;
  readonly finishReason?: unknown;
  readonly usage?: unknown;
  readonly remote_cancellation?: unknown;
}

const FINISH_REASONS: readonly FinishReason[] = ['stop', 'length', 'content_filter', 'error'];

/**
 * Map an HTTP status onto the gateway's failure classes.
 *
 * The mapping is the security-relevant part: `policy_rejected` and `auth_failed` are NOT retryable and
 * NOT eligible for fallback, so a rejected or unauthorised request is never re-sent to a second paid
 * model.
 */
export function classifyHttpStatus(status: number): FailureClass {
  if (status === 429) return 'retryable_throttled';
  if (status >= 500) return 'retryable_provider';
  // 4xx is the request itself being wrong -- auth, schema, a content refusal. Re-sending the same bytes
  // to a second paid model cannot fix any of them, so fallback must NOT be authorized (B-4-2).
  if (status >= 400) return 'non_retryable_request';
  return 'non_retryable_unknown';
}

function parseUsage(raw: unknown): ProviderResponse['usage'] | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as { input?: unknown; output?: unknown; cached?: unknown };
  const num = (v: unknown): number | undefined => (typeof v === 'number' && v >= 0 ? v : undefined);
  const input = num(u.input);
  const output = num(u.output);
  // PARTIAL usage is not usage. Completing it by assuming zero for the missing half would fabricate an
  // input count and understate cost, so a partial report is reported as unknown.
  if (input === undefined || output === undefined) return undefined;
  return { input, output, cached: num(u.cached) ?? 0 };
}

export class HttpProvider implements Provider {
  readonly name: string;
  private readonly endpoint: URL;

  constructor(private readonly opts: HttpProviderOptions) {
    this.name = opts.name;
    let url: URL;
    try {
      url = new URL(opts.baseUrl);
    } catch {
      throw new Error(`HttpProvider: baseUrl is not a URL: ${opts.baseUrl}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`HttpProvider: refusing protocol ${url.protocol}`);
    }
    const loopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
    if (!loopback && opts.allowNonLoopback !== true) {
      throw new Error(
        `HttpProvider: refusing non-loopback endpoint ${url.hostname} without allowNonLoopback`,
      );
    }
    // A path-prefixed endpoint (e.g. https://host/genspark/v1/complete behind a reverse proxy) must
    // keep its prefix: resolving '/v1/complete' absolutely would strip it.
    const path = url.pathname.replace(/\/+$/, '');
    this.endpoint = path.endsWith('/v1/complete')
      ? url
      : new URL(`${url.origin}${path}/v1/complete`);
  }

  /**
   * Complete one request.
   *
   * Returns the response plus `usageReported`, so a caller can tell "the provider said zero" from "the
   * provider said nothing". The distinction is the whole point: without it, an unreported usage would be
   * indistinguishable from a genuinely free call and would settle as a false zero.
   */
  async complete(
    req: ProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse & { readonly usageReported: boolean }> {
    const started = Date.now();
    const maxBytes = this.opts.maxResponseBytes ?? 1024 * 1024;
    const timeoutMs = this.opts.timeoutMs ?? 30_000;

    // One controller for the request, aborted by either the caller's signal or our own deadline. The
    // timer is always cleared, so a completed call leaves no pending timer behind.
    const controller = new AbortController();
    const onCallerAbort = (): void => {
      controller.abort();
    };
    if (signal?.aborted === true) {
      // No request was ever dispatched, so nothing remote was asked to stop: `not_requested` is the
      // truthful remote status here, not `unknown`.
      throw new CancellationError('activity_cancelled', {
        remoteCancellation: 'not_requested',
      });
    }
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    /**
     * Held in an object rather than a `let` boolean.
     *
     * TypeScript's control-flow analysis cannot see a value assigned inside a timer callback: with a
     * plain `let`, it narrows the flag to `false` and reports every later check as statically
     * impossible. This is the same narrowing trap the gateway's cancellation flags and the SSE stream's
     * write-after-disconnect both document.
     */
    const deadline = { exceeded: false };
    const timer = setTimeout(() => {
      deadline.exceeded = true;
      controller.abort();
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const url = new URL('/v1/complete', this.endpoint);
      const payload = JSON.stringify({
        modelId: req.modelId,
        system: req.system,
        user: req.user,
        params: req.params,
        // Structured-output contract, when the call declares one; bridges/upstreams that support it
        // can enforce it, others ignore the extra key harmlessly.
        ...(req.outputSchema !== undefined ? { outputSchema: req.outputSchema } : {}),
        idempotencyKey: req.trace?.idempotencyKey,
      });
      // Raw node transport, not global fetch: undici imposes its own ~300 s headers/body idle
      // timeouts, which silently abort any call whose buffered response takes longer (a
      // non-streaming bridge on long bible-stage prompts). The provider's own deadline above is
      // the only timeout this adapter honors.
      const response = await this.rawPost(url, payload, controller.signal, maxBytes);

      if (!response.ok) {
        throw new ProviderFailure(
          classifyHttpStatus(response.status),
          `provider ${this.name} returned HTTP ${String(response.status)}`,
          {
            status: response.status,
            // A 5xx may have been processed before it failed, which the gateway needs in order to
            // decide whether a retry could duplicate work.
            ...(response.status >= 500 ? { possiblyCompleted: true } : {}),
          },
        );
      }

      const body = response.text;
      let parsed: WireResponse;
      try {
        parsed = JSON.parse(body) as WireResponse;
      } catch {
        // A truncated or malformed body is a transport fault, not a model judgment: retrying the same
        // request is reasonable, substituting a draft is not.
        throw new ProviderFailure(
          'retryable_transport',
          `provider ${this.name} returned a body that is not JSON`,
        );
      }

      const text = parsed.text;
      if (text !== undefined && typeof text !== 'string') {
        throw new ProviderFailure(
          'non_retryable_request',
          `provider ${this.name} returned a non-string completion`,
        );
      }
      const finish = FINISH_REASONS.includes(parsed.finishReason as FinishReason)
        ? (parsed.finishReason as FinishReason)
        : 'stop';
      const usage = parseUsage(parsed.usage);

      return {
        modelId: typeof parsed.modelId === 'string' ? parsed.modelId : req.modelId,
        provider: this.name,
        ...(typeof parsed.providerRequestId === 'string'
          ? { providerRequestId: parsed.providerRequestId }
          : {}),
        ...(text !== undefined ? { text } : {}),
        ...(parsed.json !== undefined ? { json: parsed.json } : {}),
        finishReason: finish,
        // Missing or partial usage stays missing. The accounting layer records `unknown`, never a zero.
        // Zeros here are a PLACEHOLDER required by the interface, and `usageReported: false` is what
        // tells the accounting layer they are not a measurement.
        usage: usage ?? { input: 0, output: 0, cached: 0 },
        usageReported: usage !== undefined,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof ProviderFailure || err instanceof CancellationError) throw err;
      const aborted = (err as { name?: string }).name === 'AbortError';
      if (aborted && !deadline.exceeded) {
        // The CALLER cancelled. This must not be classified as a transport fault: the classifier's
        // transport pattern matches "aborted", and a retryable classification would turn one
        // cancellation into N paid attempts (ADR-0049).
        // The socket was closed. That says nothing about whether the provider kept generating, so the
        // remote status is left at its `unknown` default rather than claiming the remote side stopped.
        throw new CancellationError('activity_cancelled');
      }
      if (aborted && deadline.exceeded) {
        throw new ProviderFailure(
          'retryable_transport',
          `provider ${this.name} exceeded ${String(timeoutMs)} ms`,
          { possiblyCompleted: true },
        );
      }
      throw new ProviderFailure(
        'retryable_transport',
        `provider ${this.name} transport error: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
      // Always removed: a long-lived caller signal must not accumulate one listener per call.
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  /**
   * Read a response body with a hard byte ceiling, destroying the stream when it is exceeded.
   *
   * `response.text()` would buffer whatever arrives, so a hostile or broken endpoint could exhaust
   * memory. This reads incrementally and gives up at the limit.
   */
  /**
   * POST via node:http/https with the caller's abort signal and an incrementally bounded read.
   * Node's undici-based global fetch imposes ~300 s headers/body idle timeouts that silently abort
   * any longer buffered response (a non-streaming bridge on long bible-stage prompts); raw node has
   * no such ceiling, so this provider's own deadline is the only timeout honored. Caller aborts are
   * re-raised with `AbortError` names so complete()'s cancellation classification keeps working;
   * everything else keeps its message for the transport classifier.
   */
  private rawPost(
    url: URL,
    payload: string,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const lib = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      let abortedBySignal = false;
      const toAbortError = (err: Error) => {
        if (!abortedBySignal) return err;
        const e = new Error('aborted');
        e.name = 'AbortError';
        return e;
      };
      const r = lib(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(this.opts.headers ?? {}) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let total = 0;
          let done = false;
          res.on('data', (c: Buffer) => {
            if (done) return;
            total += c.byteLength;
            if (total > maxBytes) {
              // Destroy the socket immediately: a hostile or broken endpoint cannot exhaust memory.
              done = true;
              res.destroy();
              reject(
                new ProviderFailure(
                  'non_retryable_request',
                  `provider ${this.name} response exceeded ${String(maxBytes)} bytes`,
                ),
              );
              return;
            }
            chunks.push(c);
          });
          res.on(
            'end',
            () =>
              done ||
              resolve({
                ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
                status: res.statusCode ?? 0,
                text: Buffer.concat(chunks).toString('utf8'),
              }),
          );
          res.on('error', (err: Error) => {
            if (!done) reject(toAbortError(err));
          });
        },
      );
      r.on('error', (err: Error) => reject(toAbortError(err)));
      const onAbort = () => {
        abortedBySignal = true;
        r.destroy();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      r.end(payload);
    });
  }
}
