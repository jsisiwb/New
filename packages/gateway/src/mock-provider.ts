/**
 * Deterministic test provider (docs/06-system/07 §5). Outputs are keyed by a hash of (system, user, model) so
 * the same prompt always yields the same output; unregistered prompts fall back to a script or throw. Faults
 * can be injected per call for chaos tests.
 */
import { createHash } from 'node:crypto';
import {
  CancellationError,
  isCancellationError,
  type RemoteCancellationStatus,
} from './cancellation.js';
import { ProviderFailure, type FailureClass } from './failures.js';
import {
  type ModelParams,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
  type FinishReason,
} from './types.js';

export function promptKey(req: Pick<ProviderRequest, 'system' | 'user' | 'modelId'>): string {
  return createHash('sha256')
    .update(req.modelId)
    .update('\u0000')
    .update(req.system)
    .update('\u0000')
    .update(req.user)
    .digest('hex');
}

/** Called when no canned output matches; return text/json or throw to simulate a provider failure. */
export type MockScript = (
  req: ProviderRequest,
  callIndex: number,
) => { text?: string; json?: unknown; finishReason?: FinishReason } | undefined;

export interface MockFault {
  readonly kind: 'error' | 'timeout' | 'truncate' | 'invalid_json' | 'korean_prose' | 'block';
  /** Fire on the nth call (1-based) matching `role`-agnostic order; default: next call. */
  readonly onCall?: number | undefined;
  /**
   * Classification the injected transport fault should carry (B-4-2 chaos scenarios). Defaults keep the
   * historical behaviour: `error` and `timeout` are retryable transport faults.
   */
  readonly failureClass?: FailureClass | undefined;
  /** True when the provider may have completed the work before the response was lost. */
  readonly possiblyCompleted?: boolean | undefined;
  /**
   * For `block`: a promise the call awaits before producing its canned output, so a test can hold a
   * provider request OPEN and cancel it mid-flight deterministically — no sleeps, no wall-clock races.
   */
  readonly until?: Promise<unknown> | undefined;
  /**
   * What this mock adapter claims about REMOTE cancellation when aborted. Default `unsupported`, because
   * a deterministic in-process mock has no remote side; a test asserting acknowledgement sets it.
   */
  readonly remoteCancellation?: RemoteCancellationStatus | undefined;
  /** Usage the provider reports even though the request was aborted, when it reports any. */
  readonly usageOnAbort?:
    { readonly input: number; readonly output: number; readonly cached: number } | undefined;
}

export class MockProvider implements Provider {
  readonly name = 'mock';
  private readonly canned = new Map<
    string,
    { text?: string; json?: unknown; finishReason?: FinishReason }
  >();
  private readonly faults: MockFault[] = [];
  private calls = 0;
  readonly log: ProviderRequest[] = [];
  /** Calls that observed an abort, for listener/cleanup assertions. */
  readonly aborted: number[] = [];

  constructor(private readonly script?: MockScript) {}

  register(
    req: Pick<ProviderRequest, 'system' | 'user' | 'modelId'>,
    out: { text?: string; json?: unknown; finishReason?: FinishReason },
  ): this {
    this.canned.set(promptKey(req), out);
    return this;
  }

  injectFault(fault: MockFault): this {
    this.faults.push(fault);
    return this;
  }

  get callCount(): number {
    return this.calls;
  }

  async complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    this.calls++;
    this.log.push(req);
    const started = Date.now();
    const callIndex = this.calls;
    // Fail closed on an ALREADY-aborted signal: a cooperative adapter must not issue a request the
    // caller has already withdrawn.
    if (signal?.aborted) {
      this.aborted.push(callIndex);
      throw abortErrorFor(signal, undefined);
    }
    const faultIdx = this.faults.findIndex((f) => (f.onCall ?? this.calls) === this.calls);
    const fault = faultIdx >= 0 ? this.faults.splice(faultIdx, 1)[0] : undefined;
    /**
     * A deterministically BLOCKING provider request.
     *
     * This is the seam the mid-call cancellation tests need: the call parks on `fault.until` (a deferred
     * a test resolves) or on the abort, whichever happens first. The abort listener is removed on every
     * exit path, so a completed blocking call leaves nothing attached to the signal.
     */
    if (fault?.kind === 'block') {
      const gate = fault.until ?? new Promise<void>(() => undefined);
      let onAbort: (() => void) | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          if (signal) {
            onAbort = () => {
              this.aborted.push(callIndex);
              reject(abortErrorFor(signal, fault));
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
          gate.then(
            () => {
              resolve();
            },
            (err: unknown) => {
              reject(err instanceof Error ? err : new Error(String(err)));
            },
          );
        });
      } finally {
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      }
    }
    if (fault?.kind === 'error')
      throw new ProviderFailure(
        fault.failureClass ?? 'retryable_transport',
        'mock provider failure (injected)',
        { ...(fault.possiblyCompleted ? { possiblyCompleted: true } : {}) },
      );
    if (fault?.kind === 'timeout')
      throw new ProviderFailure(
        fault.failureClass ?? 'retryable_transport',
        'mock provider timeout (injected)',
        { ...(fault.possiblyCompleted ? { possiblyCompleted: true } : {}) },
      );
    const canned = this.canned.get(promptKey(req)) ?? this.script?.(req, this.calls);
    if (!canned) {
      throw new Error(
        `MockProvider: no canned output for prompt ${promptKey(req).slice(0, 12)}… (model ${req.modelId})`,
      );
    }
    let text = canned.text;
    let json = canned.json;
    let finishReason: FinishReason = canned.finishReason ?? 'stop';
    if (fault?.kind === 'truncate' && text !== undefined) {
      text = text.slice(0, Math.floor(text.length / 2));
      finishReason = 'length';
    }
    if (fault?.kind === 'invalid_json') {
      json = undefined;
      text = '{"not": "valid json"';
    }
    if (fault?.kind === 'korean_prose') {
      text = '측정 장치가 울었다. 붉은 글자가 떠올랐다.';
      json = undefined;
    }
    const usage = {
      input: estimateTokens(req.system) + estimateTokens(req.user),
      output: estimateTokens(text ?? JSON.stringify(json ?? '')),
      cached: 0,
    };
    return {
      modelId: req.modelId,
      provider: this.name,
      providerRequestId: `mock-${this.calls}`,
      text,
      json,
      finishReason,
      usage,
      latencyMs: Date.now() - started,
    };
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

/**
 * The error an aborted mock request raises.
 *
 * It preserves the caller's own `CancellationError` (and therefore the REASON that fired) when the signal
 * carries one, so an adapter cannot relabel an operator cancellation as a timeout. Remote-cancellation
 * status and post-abort usage come from the fault declaration, defaulting to honest non-claims.
 */
function abortErrorFor(signal: AbortSignal, fault: MockFault | undefined): Error {
  const upstream: unknown = signal.reason;
  const reason = isCancellationError(upstream) ? upstream.reason : 'operator_cancelled';
  return new CancellationError(reason, {
    remoteCancellation: fault?.remoteCancellation ?? 'unsupported',
    ...(fault?.usageOnAbort ? { usage: fault.usageOnAbort } : {}),
  });
}

export const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.7,
  max_tokens: 4000,
  top_p: 1,
  seed: 7,
  json_schema_mode: false,
};
