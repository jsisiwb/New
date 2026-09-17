/**
 * Active-request cancellation: the vocabulary, the signal composition and the bounded durable observer.
 *
 * WHY THIS EXISTS. Before this module, `jobs.control = 'cancel'` was an intent observed only at a
 * `runStep` boundary (packages/workflows/src/runtime.ts). That is safe but not prompt: a provider call
 * already in flight ran to completion, so an operator cancelling a chapter mid-draft waited for the
 * current model call — the longest operation in the pipeline — before anything stopped. `Provider.complete`
 * has always accepted an `AbortSignal`; nothing ever supplied one. This module supplies it.
 *
 * THREE PROPERTIES SHAPE EVERYTHING HERE.
 *
 *  * A REASON IS NOT A RETRY CLASS. Operator cancellation, a provider timeout, Temporal activity
 *    cancellation, worker shutdown and lease loss all abort the same local request, and they mean five
 *    different things to an operator reading the audit. They are therefore carried as distinct reasons on
 *    one error type, and the FIRST reason to fire wins — a composed signal never relabels an operator
 *    cancel as a timeout because the timeout fired a millisecond later.
 *
 *  * ABORTING A LOCAL REQUEST IS NOT STOPPING REMOTE COMPUTATION. Closing a socket says nothing about
 *    whether the provider stopped generating or will bill for it. `remoteCancellation` therefore records
 *    what is actually known — `acknowledged`, `unsupported`, `unknown` — and defaults to `unknown` rather
 *    than to a comfortable claim. Nothing in this repository may report that a remote provider stopped
 *    working without a positive acknowledgement.
 *
 *  * OBSERVATION IS BOUNDED AND DISPOSED. The durable observer polls the job's control column on a fixed
 *    interval with a fixed query, and every exit path — success, failure, timeout, cancellation — clears
 *    the timer and removes the listener. An unbounded or undisposed observer would turn cancellation
 *    support into a connection leak and a denial-of-service surface.
 */

/**
 * Why a request was aborted. Stable identifiers: they are persisted on the audit record and rendered to
 * operators, so they are part of the contract, not internal labels.
 *
 *  * `operator_cancelled` — a human asked for it (`jobs.control = 'cancel'`). Never a retryable failure.
 *  * `timeout`            — the call exceeded its own deadline. A fault, classified separately.
 *  * `activity_cancelled` — Temporal cancelled the activity (workflow cancelled, or its scope torn down).
 *  * `worker_shutdown`    — this worker is draining; the work is not lost, it is not ours any more.
 *  * `lease_lost`         — a rival holder owns the target; every protected write is already refused.
 */
export const CANCELLATION_REASONS = [
  'operator_cancelled',
  'timeout',
  'activity_cancelled',
  'worker_shutdown',
  'lease_lost',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

/**
 * Terminal classifications a cancelled or raced call can settle on, beyond the reasons above.
 *
 *  * `provider_failed`       — the provider failed on its own before any cancellation was requested.
 *  * `late_result_discarded` — a response (success or failure) arrived after an authoritative abort and was
 *                             thrown away. The abort stays the terminal state.
 *  * `cancel_too_late`       — cancellation arrived after the atomic canon commit. History is not retracted.
 */
export const CANCELLATION_OUTCOMES = [
  ...CANCELLATION_REASONS,
  'provider_failed',
  'late_result_discarded',
  'cancel_too_late',
] as const;

export type CancellationOutcome = (typeof CANCELLATION_OUTCOMES)[number];

/**
 * What is known about the REMOTE side of a cancelled call.
 *
 * There is deliberately no `stopped` member. A provider that acknowledges a cancellation gets
 * `acknowledged`; one whose API has no cancellation endpoint gets `unsupported`; everything else is
 * `unknown`. Absence of evidence is recorded as absence of evidence.
 */
export type RemoteCancellationStatus =
  /** No cancellation was requested for this call. */
  | 'not_requested'
  /** We aborted locally and the provider positively acknowledged the cancellation. */
  | 'acknowledged'
  /** We aborted locally; this provider offers no way to cancel remote work. */
  | 'unsupported'
  /** We aborted locally; whether the provider stopped is genuinely not known. */
  | 'unknown';

/**
 * Reasons that are an OPERATOR DECISION rather than a fault.
 *
 * The distinction drives retry, repair and fallback: a fault may be worth trying elsewhere, a decision
 * never is. Re-routing an operator cancel to a second paid model would spend money to produce output the
 * operator has already said they do not want.
 */
const AUTHORITATIVE_REASONS: readonly CancellationReason[] = [
  'operator_cancelled',
  'activity_cancelled',
  'worker_shutdown',
  'lease_lost',
];

export function isAuthoritativeCancellation(reason: CancellationReason): boolean {
  return AUTHORITATIVE_REASONS.includes(reason);
}

/**
 * The error an aborted provider call raises.
 *
 * It is NOT a `ProviderFailure`: classification must never fold it into a retry class. `failures.ts`
 * checks for this type first, precisely because the historical transport regex matches the word
 * "aborted" and would otherwise have classified every cancellation as a retryable transport fault — which
 * would have rerouted an operator cancel to the next paid model.
 */
export class CancellationError extends Error {
  override readonly name = 'CancellationError';

  constructor(
    readonly reason: CancellationReason,
    readonly detail: {
      /** What is known about remote work. Defaults to `unknown`, never to a claim. */
      readonly remoteCancellation?: RemoteCancellationStatus | undefined;
      /** Usage the provider reported even though the local request was aborted, when it reported any. */
      readonly usage?:
        { readonly input: number; readonly output: number; readonly cached: number } | undefined;
      /** True when a response arrived after the abort and was discarded. */
      readonly lateResultDiscarded?: boolean | undefined;
      readonly abortedAt?: string | undefined;
    } = {},
  ) {
    super(`CANCELLED(${reason})`);
  }

  get remoteCancellation(): RemoteCancellationStatus {
    return this.detail.remoteCancellation ?? 'unknown';
  }
}

export function isCancellationError(err: unknown): err is CancellationError {
  return err instanceof CancellationError;
}

/**
 * A composed cancellation signal plus the reason that fired, and a disposer.
 *
 * `reason()` is a function rather than a property because the value is set asynchronously by a listener:
 * a property read narrowed once by TypeScript would report every later check as unreachable, which is the
 * same narrowing trap the workflow's signal flags document.
 */
export interface CancellationHandle {
  readonly signal: AbortSignal;
  /** The reason that aborted this handle, or undefined while it is live. First writer wins. */
  reason(): CancellationReason | undefined;
  /** Abort this handle explicitly. Later calls are ignored, so the first reason stays authoritative. */
  cancel(reason: CancellationReason): void;
  /** Release every listener, timer and poll handle. Idempotent. */
  dispose(): void;
}

/** One input to a composition: an upstream signal and the reason it represents. */
export interface CancellationInput {
  readonly signal: AbortSignal;
  readonly reason: CancellationReason;
}

/**
 * Compose upstream signals (and an optional deadline) into one handle whose reason is the first to fire.
 *
 * FIRST-WINS IS THE WHOLE POINT. A cancelled workflow whose activity deadline also expires must still be
 * recorded as `activity_cancelled`, and an operator cancel that races a timeout must still read
 * `operator_cancelled`; otherwise the audit tells an operator their own action was a provider fault.
 *
 * Every listener is registered with `{ once: true }` and also removed in `dispose`, and the deadline timer
 * is cleared there too, so no path leaves a handle attached to a long-lived upstream signal.
 */
export function composeCancellation(
  inputs: readonly CancellationInput[],
  options: {
    readonly timeoutMs?: number | undefined;
    readonly setTimer?: TimerFns | undefined;
  } = {},
): CancellationHandle {
  const controller = new AbortController();
  let firedReason: CancellationReason | undefined;
  let disposed = false;
  const detach: (() => void)[] = [];

  const fire = (reason: CancellationReason): void => {
    // First writer wins: a second abort must not relabel the first.
    if (firedReason !== undefined) return;
    firedReason = reason;
    controller.abort(new CancellationError(reason));
  };

  for (const input of inputs) {
    if (input.signal.aborted) {
      fire(input.reason);
      continue;
    }
    const onAbort = (): void => {
      fire(input.reason);
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    detach.push(() => {
      input.signal.removeEventListener('abort', onAbort);
    });
  }

  const timers = options.setTimer ?? realTimers;
  if (options.timeoutMs !== undefined && firedReason === undefined) {
    const handle = timers.setTimeout(() => {
      fire('timeout');
    }, options.timeoutMs);
    detach.push(() => {
      timers.clearTimeout(handle);
    });
  }

  return {
    signal: controller.signal,
    reason: () => firedReason,
    cancel: fire,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const off of detach) off();
      detach.length = 0;
    },
  };
}

/**
 * Injectable timers so a test can drive a deadline deterministically instead of sleeping.
 *
 * `unref` is applied to real timers: a pending cancellation deadline must never be the reason a CLI
 * process refuses to exit.
 */
export interface TimerFns {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: TimerFns = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    if (typeof (t as { unref?: () => void }).unref === 'function')
      (t as { unref: () => void }).unref();
    return t;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** How often a durable cancellation intent is polled while a provider call is in flight. */
export const DURABLE_CANCEL_POLL_MS = 1_000;

/**
 * Watch a durable cancellation intent while a call is in flight, and abort the handle when it appears.
 *
 * WHY POLLING. The durable intent lives in one Postgres row that an operator writes from the API. A
 * Postgres `LISTEN` would need a dedicated connection held for the life of every provider call, and
 * Temporal signals do not reach into an activity's provider call. A single bounded `SELECT control` on a
 * fixed interval is the smallest mechanism that observes the intent promptly without adding a second
 * notification substrate — and it is bounded in every direction: fixed interval, fixed query, stopped by
 * the first positive observation, and always cleared on dispose.
 *
 * A POLL FAILURE IS NOT A CANCELLATION. A transport blip must not abort a healthy paid call, so an error
 * from `isCancelled` is counted and ignored; the step boundary's durable check remains the guarantee.
 */
export function watchDurableCancellation(input: {
  readonly handle: CancellationHandle;
  readonly isCancelled: () => Promise<boolean>;
  readonly reason?: CancellationReason | undefined;
  readonly intervalMs?: number | undefined;
  readonly timers?: TimerFns | undefined;
}): { dispose(): void; pollErrors(): number } {
  const timers = input.timers ?? realTimers;
  const reason = input.reason ?? 'operator_cancelled';
  const interval = input.intervalMs ?? DURABLE_CANCEL_POLL_MS;
  let stopped = false;
  let pending: unknown;
  let errors = 0;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (pending !== undefined) {
      timers.clearTimeout(pending);
      pending = undefined;
    }
  };

  const tick = (): void => {
    if (stopped || input.handle.signal.aborted) {
      stop();
      return;
    }
    void input
      .isCancelled()
      .then((cancelled) => {
        if (stopped) return;
        if (cancelled) {
          input.handle.cancel(reason);
          stop();
          return;
        }
        schedule();
      })
      .catch(() => {
        // Recorded, never escalated: an unreachable database says nothing about operator intent, and
        // failing closed here would abort healthy runs on a blip.
        errors++;
        if (!stopped) schedule();
      });
  };

  const schedule = (): void => {
    if (stopped) return;
    pending = timers.setTimeout(tick, interval);
  };

  // Abort of the handle for any other reason also retires the poller, so a completed call leaves nothing
  // behind.
  const onAbort = (): void => {
    stop();
  };
  input.handle.signal.addEventListener('abort', onAbort, { once: true });

  schedule();

  return {
    dispose: () => {
      stop();
      input.handle.signal.removeEventListener('abort', onAbort);
    },
    pollErrors: () => errors,
  };
}

/**
 * Await `promise` but reject with the handle's `CancellationError` as soon as it aborts.
 *
 * Two properties matter and both are covered by tests:
 *
 *  * NO DOUBLE SETTLEMENT. The returned promise settles exactly once; whichever of the two paths arrives
 *    second is ignored.
 *  * NO UNHANDLED REJECTION. A provider promise that rejects AFTER the abort already won the race is
 *    still explicitly consumed (`void promise.catch(…)`), because an ignored rejected promise is an
 *    unhandled rejection that can take a worker process down.
 */
export async function raceCancellation<T>(
  promise: Promise<T>,
  handle: CancellationHandle,
  onLateResult?: (outcome: LateResult<T>) => void,
): Promise<T> {
  /**
   * Exactly ONE observer of `promise`.
   *
   * An earlier revision attached a second `.then` in the abort path as well as the main one, so a late
   * settlement invoked `onLateResult` TWICE — which in the gateway would have double-counted a discarded
   * response. There is now a single observer; whether its settlement counts as "late" is decided by
   * whether the returned promise had already settled.
   *
   * It is attached unconditionally, which is also what guarantees the eventual settlement of an ignored
   * provider promise is consumed and can never surface as an unhandled rejection.
   */
  let raceSettled = false;
  let lateReported = false;
  const reportLate = (outcome: LateResult<T>): void => {
    if (!raceSettled || lateReported) return;
    lateReported = true;
    /**
     * The callback is ISOLATED from the observer chain.
     *
     * `reportLate` runs inside `observed`'s handlers, so a callback that throws used to reject that
     * internal promise — and because nothing awaits `observed` on the late path, the rejection surfaced
     * as an UNHANDLED REJECTION, which can take a worker process down. That is precisely the failure this
     * module promises to prevent, so a caller's bug must not be able to cause it: the throw is contained
     * and the late result is still recorded as delivered.
     */
    try {
      onLateResult?.(outcome);
    } catch {
      // Deliberately swallowed. A late-result notification is advisory bookkeeping about a response that
      // has already been discarded; it must never alter the cancellation outcome or crash the process.
    }
  };
  const observed: Promise<LateResult<T>> = promise.then(
    (value) => {
      const outcome: LateResult<T> = { ok: true, value };
      reportLate(outcome);
      return outcome;
    },
    (error: unknown) => {
      const outcome: LateResult<T> = { ok: false, error };
      reportLate(outcome);
      return outcome;
    },
  );

  const cancelled = async (): Promise<never> => {
    raceSettled = true;
    throw await adapterVerdict(observed, handle);
  };

  if (handle.signal.aborted) return cancelled();

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      if (raceSettled) return;
      cancelled().catch(reject);
    };
    handle.signal.addEventListener('abort', onAbort, { once: true });
    void observed.then((outcome) => {
      handle.signal.removeEventListener('abort', onAbort);
      if (raceSettled) return;
      raceSettled = true;
      if (outcome.ok) resolve(outcome.value);
      // Rethrown verbatim: the provider's own error is what the gateway classifies, so wrapping it here
      // would destroy the `ProviderFailure` verdict that authorizes (or refuses) a fallback.
      else
        reject(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error)));
    });
  });
}

export type LateResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Prefer the ADAPTER's own cancellation verdict over the generic one, when it is already available.
 *
 * This is what makes remote-cancellation status and post-abort usage truthful rather than always
 * `unknown`: only the adapter knows whether the provider acknowledged the cancellation or reported tokens
 * on its way out, and that knowledge arrives on the rejection of its own promise.
 *
 * The wait is bounded to ONE macrotask, and the bound is deterministic rather than hopeful: promise
 * callbacks are microtasks and always drain before a `setTimeout(…, 0)`, so a cooperative adapter that
 * rejects when the signal fires is always observed, while an adapter that ignores the signal cannot delay
 * the cancellation beyond a single turn of the event loop.
 */
async function adapterVerdict(
  observed: Promise<LateResult<unknown>>,
  handle: CancellationHandle,
): Promise<CancellationError> {
  const generic = cancellationErrorOf(handle);
  const pending = Symbol('no-adapter-verdict');
  const settled = await Promise.race([
    observed,
    new Promise<typeof pending>((resolve) => {
      const t = setTimeout(() => {
        resolve(pending);
      }, 0);
      if (typeof (t as { unref?: () => void }).unref === 'function')
        (t as { unref: () => void }).unref();
    }),
  ]);
  if (settled === pending || settled.ok) return generic;
  const fromAdapter = settled.error;
  if (!isCancellationError(fromAdapter)) return generic;
  // The REASON stays whichever one actually fired upstream — an adapter must never be able to relabel an
  // operator's cancellation — while the remote status and the usage it observed are adopted.
  return new CancellationError(generic.reason, {
    remoteCancellation: fromAdapter.detail.remoteCancellation ?? generic.remoteCancellation,
    ...(fromAdapter.detail.usage ? { usage: fromAdapter.detail.usage } : {}),
    ...(generic.detail.abortedAt ? { abortedAt: generic.detail.abortedAt } : {}),
  });
}

/** The error a handle's abort should raise, preserving the reason that actually fired. */
export function cancellationErrorOf(handle: CancellationHandle): CancellationError {
  const reason = handle.reason();
  // `AbortSignal.reason` is typed `any`; narrow it before use so no untyped value escapes into the audit.
  const fromSignal: unknown = handle.signal.reason;
  if (isCancellationError(fromSignal)) return fromSignal;
  return new CancellationError(reason ?? 'operator_cancelled');
}

/**
 * Throw if the handle has already aborted. Called before every attempt, every repair and every fallback,
 * so no new provider work begins after an authoritative cancellation.
 */
export function throwIfCancelled(handle: CancellationHandle | undefined): void {
  if (handle?.signal.aborted) throw cancellationErrorOf(handle);
}
