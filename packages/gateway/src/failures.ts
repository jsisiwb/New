/**
 * Provider-failure classification for policy-authorized fallback (B-4-2).
 *
 * The gateway used to treat EVERY thrown provider error as a reason to move to the next route. That is the
 * wrong default: a transport hiccup and a rejected request are not the same event. Rerouting a rejected
 * request re-sends the same bytes to a second paid model and turns one deterministic refusal into N, while
 * rerouting a throttle or a 5xx is exactly the behaviour fallback exists for.
 *
 * Classification is therefore explicit and data-driven, and the default for an UNRECOGNIZED failure is
 * `non_retryable` — fail closed. A provider adapter states its own verdict by throwing a
 * `ProviderFailure`; anything else is classified from its shape, and a shape we do not recognize stops the
 * call rather than spending again on a guess.
 */

import { isCancellationError } from './cancellation.js';

export type FailureClass =
  /** Transport/availability fault: the request may not have been seen. Fallback is authorized. */
  | 'retryable_transport'
  /** Provider asked us to slow down (429 / rate limit). Fallback is authorized. */
  | 'retryable_throttled'
  /** Provider-side fault (5xx / overloaded / unavailable). Fallback is authorized. */
  | 'retryable_provider'
  /** The request itself is wrong (4xx, bad schema, content refusal, auth). Fallback is NOT authorized. */
  | 'non_retryable_request'
  /**
   * The call was cancelled (operator intent, activity cancellation, worker shutdown, lease loss, or a
   * deadline). Never retried, repaired or rerouted: there is no second model that can satisfy a request
   * whose requester has withdrawn it.
   */
  | 'cancelled'
  /** Anything unrecognized. Treated as non-retryable so an unknown fault cannot multiply spend. */
  | 'non_retryable_unknown';

export const RETRYABLE_CLASSES: readonly FailureClass[] = [
  'retryable_transport',
  'retryable_throttled',
  'retryable_provider',
];

export function isRetryable(cls: FailureClass): boolean {
  return RETRYABLE_CLASSES.includes(cls);
}

/**
 * The typed error a provider adapter raises when it knows what happened. Adapters are the only code with
 * the vendor's status codes in hand, so they get to state the verdict rather than have it guessed from a
 * message string.
 */
export class ProviderFailure extends Error {
  constructor(
    readonly failureClass: FailureClass,
    message: string,
    readonly detail: {
      readonly status?: number | undefined;
      readonly providerRequestId?: string | undefined;
      /** True when the provider may have completed the work even though we never saw the response. */
      readonly possiblyCompleted?: boolean | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderFailure';
  }
}

const TRANSPORT =
  /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|network|fetch failed|aborted)\b/i;
const TIMEOUT = /\b(timeout|timed out|deadline exceeded)\b/i;
const THROTTLE = /\b(rate.?limit|too many requests|429|quota exceeded|overloaded)\b/i;
const SERVER =
  /\b(50[0234]|internal server error|bad gateway|service unavailable|gateway timeout|server_error)\b/i;
const REQUEST =
  /\b(40[0134]|invalid.?request|unauthorized|forbidden|authentication|api.?key|content.?filter|content.?policy|unsupported|not.?found|context.?length)\b/i;

/**
 * Classify a thrown provider error. `ProviderFailure` is authoritative; otherwise the shape is inspected,
 * and an unrecognized shape is `non_retryable_unknown` — never a silent retry.
 */
export function classifyProviderFailure(err: unknown): FailureClass {
  // Checked FIRST and before `ProviderFailure`, because the transport regex below matches the word
  // "aborted" — the historical behaviour would have classified every cancellation as a retryable
  // transport fault and rerouted an operator's cancel to the next paid model.
  if (isCancellationError(err)) return 'cancelled';
  if (err instanceof ProviderFailure) return err.failureClass;

  const status = numericStatus(err);
  if (status !== undefined) {
    if (status === 429) return 'retryable_throttled';
    if (status >= 500) return 'retryable_provider';
    if (status >= 400) return 'non_retryable_request';
  }

  const code =
    typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const message = err instanceof Error ? err.message : String(err);
  const text = `${code} ${message}`;

  // A rejected request is checked FIRST: "invalid request" must not be rerouted just because the vendor's
  // message happens to contain a word that also appears in a transport fault.
  if (REQUEST.test(text)) return 'non_retryable_request';
  if (THROTTLE.test(text)) return 'retryable_throttled';
  if (SERVER.test(text)) return 'retryable_provider';
  if (TRANSPORT.test(text) || TIMEOUT.test(text)) return 'retryable_transport';
  return 'non_retryable_unknown';
}

function numericStatus(err: unknown): number | undefined {
  // `err` may be anything a provider threw, including `undefined` or a string, so the property read is
  // guarded rather than assumed.
  if (typeof err !== 'object' || err === null) return undefined;
  for (const key of ['status', 'statusCode', 'httpStatus']) {
    const v = (err as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 100 && v < 600) return v;
  }
  return undefined;
}
