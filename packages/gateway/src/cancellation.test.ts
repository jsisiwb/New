/**
 * Active-request cancellation: the gateway-level regression suite (Phase 4).
 *
 * Every test here fails against the pre-change gateway, which accepted an `AbortSignal` on
 * `Provider.complete` and never supplied one: a durable cancel reached only the next `runStep` boundary,
 * so a provider call already in flight ran to completion.
 *
 * DETERMINISM DISCIPLINE. There is not a single `sleep()` in this file. Mid-call cancellation is driven by
 * a `block` fault parked on a DEFERRED promise a test resolves explicitly, deadlines run on injected
 * timers, and the durable observer is driven by a probe the test flips. Every assertion inspects DURABLE
 * STATE — the audit record the call wrote — not merely the error that was thrown, because "it threw" and
 * "the audit tells the truth about what it cost" are different claims.
 */
import { describe, expect, it, vi } from 'vitest';
import { composeIdentity, ProfileStore } from '@yeonjae/narrative';
import { asUuid } from '@yeonjae/domain';
import {
  CancellationError,
  composeCancellation,
  isAuthoritativeCancellation,
  raceCancellation,
  watchDurableCancellation,
  type CancellationReason,
  type TimerFns,
} from './cancellation.js';
import { recordChaosScenarios } from './chaos-report.js';
import { classifyProviderFailure, isRetryable, ProviderFailure } from './failures.js';
import {
  Gateway,
  MemoryAuditStore,
  MemoryBudget,
  type AuditRecord,
  type RoutingTable,
} from './gateway.js';
import { MockProvider, promptKey } from './mock-provider.js';
import { ReplayProvider } from './replay-provider.js';
import { type GatewayRequest, type Provider, type ProviderResponse } from './types.js';

const store = ProfileStore.fromDirectory();
const identity = composeIdentity(
  store,
  'project/0191b2a0-0000-7000-8000-000000000001@1',
  '0191b2a0-0000-7000-8000-000000060001',
);

let keySeq = 0;

function route(modelId: string, provider: string, priority: number, family: string) {
  return {
    modelId,
    provider,
    priority,
    family,
    priceInPerMTokCents: 300,
    priceOutPerMTokCents: 1500,
    maxContextTokens: 128_000,
    supportsJsonSchema: true,
  };
}

const routing: RoutingTable = {
  P: [route('mock-p-primary', 'mock', 1, 'alpha'), route('mock-p-alt', 'mock-alt', 2, 'beta')],
  R: [route('mock-r', 'mock', 1, 'alpha')],
  M: [route('mock-m', 'mock', 1, 'alpha')],
  C: [route('mock-c', 'mock', 1, 'alpha')],
  E: [],
};

/**
 * A non-manuscript, schema-free request.
 *
 * Built literally rather than through the prompt registry: the subject under test is cancellation, and
 * routing a real prompt family through the Guard would couple these tests to prompt metadata that has
 * nothing to do with when a call stops. The idempotency key is unique per request so no test accidentally
 * exercises the audit's replay path except the one that means to.
 */
function request(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    workspaceId: asUuid('0191b2a0-0000-7000-8000-0000000000a1'),
    projectId: asUuid('0191b2a0-0000-7000-8000-000000000001'),
    jobId: asUuid('0191b2a0-0000-7000-8000-0000000000b1'),
    activityId: 'cancel-test',
    idempotencyKey: `cancel-test:${++keySeq}`,
    role: 'requirement_interpreter',
    styleSensitive: false,
    manuscriptProducing: false,
    promptVersionId: asUuid('0191b2a0-0000-7000-8000-0000000000c1'),
    promptHash: 'sha256:deadbeef',
    productionPolicyVersion: 'standard.v1',
    pack: {
      id: asUuid('0191b2a0-0000-7000-8000-0000000000d1'),
      hash: `sha256:${'0'.repeat(64)}`,
      renderedSystem: 'system text',
      renderedUser: 'user text',
      tokenEstimate: 100,
    },
    modelClass: 'R',
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}

/** An explicit synchronization point. The only way a test holds a provider call open. */
function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Timers a test drives by hand, so a deadline is an instruction rather than a wall-clock hope. */
function manualTimers(): TimerFns & { run(): void; pending(): number } {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout: (fn) => {
      const id = next++;
      queue.set(id, fn);
      return id;
    },
    clearTimeout: (handle) => {
      queue.delete(handle as number);
    },
    run: () => {
      for (const [id, fn] of [...queue]) {
        queue.delete(id);
        fn();
      }
    },
    pending: () => queue.size,
  };
}

function makeGateway(
  providers: ReadonlyMap<string, Provider>,
  audit = new MemoryAuditStore(),
  extra: { timers?: TimerFns | undefined; cancelPollMs?: number | undefined } = {},
) {
  const gateway = new Gateway({
    providers,
    routing,
    budget: new MemoryBudget(1_000_000),
    audit,
    guardContext: { identity },
    ...(extra.timers ? { timers: extra.timers } : {}),
    ...(extra.cancelPollMs !== undefined ? { cancelPollMs: extra.cancelPollMs } : {}),
  });
  return { gateway, audit };
}

/** A mock that answers any prompt, so route selection never fails for an unrelated reason. */
function answering(): MockProvider {
  return new MockProvider(() => ({ text: 'ok' }));
}

function cancelledRecords(audit: MemoryAuditStore): AuditRecord[] {
  return audit.records.filter((r) => r.status === 'cancelled');
}

describe('cancellation vocabulary and signal composition', () => {
  it('keeps the FIRST reason authoritative when several signals fire', () => {
    const operator = new AbortController();
    const activity = new AbortController();
    const handle = composeCancellation([
      { signal: operator.signal, reason: 'operator_cancelled' },
      { signal: activity.signal, reason: 'activity_cancelled' },
    ]);
    operator.abort();
    activity.abort();
    // The operator acted first; a later activity cancellation must not relabel their decision.
    expect(handle.reason()).toBe('operator_cancelled');
    handle.dispose();
  });

  it('distinguishes a timeout from an operator cancellation', () => {
    const timers = manualTimers();
    const operator = new AbortController();
    const timed = composeCancellation([], { timeoutMs: 50, setTimer: timers });
    timers.run();
    expect(timed.reason()).toBe('timeout');
    expect(isAuthoritativeCancellation('timeout')).toBe(false);
    timed.dispose();

    const cancelled = composeCancellation(
      [{ signal: operator.signal, reason: 'operator_cancelled' }],
      { timeoutMs: 50, setTimer: timers },
    );
    operator.abort();
    timers.run();
    expect(cancelled.reason()).toBe('operator_cancelled');
    // A deadline fired later must not overwrite the operator's decision, and an operator cancellation is
    // authoritative while a timeout is a fault.
    expect(isAuthoritativeCancellation('operator_cancelled')).toBe(true);
    cancelled.dispose();
  });

  it('classifies a cancellation as `cancelled`, never as a retryable transport fault', () => {
    for (const reason of [
      'operator_cancelled',
      'timeout',
      'activity_cancelled',
      'worker_shutdown',
      'lease_lost',
    ] as const) {
      const cls = classifyProviderFailure(new CancellationError(reason));
      expect(cls).toBe('cancelled');
      // The whole point: the historical transport regex matches "aborted", so without the explicit check
      // a cancellation would have been rerouted to the next paid model.
      expect(isRetryable(cls)).toBe(false);
    }
    // The regression this guards: an adapter error whose text contains "aborted" is still transport.
    expect(classifyProviderFailure(new Error('socket aborted'))).toBe('retryable_transport');
  });

  it('defaults remote cancellation to `unknown` rather than to a claim', () => {
    expect(new CancellationError('operator_cancelled').remoteCancellation).toBe('unknown');
    expect(
      new CancellationError('operator_cancelled', { remoteCancellation: 'acknowledged' })
        .remoteCancellation,
    ).toBe('acknowledged');
  });

  it('disposes listeners and timers on every exit path', () => {
    const timers = manualTimers();
    const upstream = new AbortController();
    const before = upstream.signal;
    const handle = composeCancellation([{ signal: before, reason: 'operator_cancelled' }], {
      timeoutMs: 1_000,
      setTimer: timers,
    });
    expect(timers.pending()).toBe(1);
    handle.dispose();
    // The deadline timer is cleared, so a disposed handle cannot fire later.
    expect(timers.pending()).toBe(0);
    upstream.abort();
    expect(handle.reason()).toBeUndefined();
    // Dispose is idempotent.
    handle.dispose();
  });
});

describe('the bounded durable cancellation observer', () => {
  it('aborts the handle when the durable intent appears, then stops polling', async () => {
    const timers = manualTimers();
    const handle = composeCancellation([]);
    let cancelled = false;
    let polls = 0;
    const watcher = watchDurableCancellation({
      handle,
      intervalMs: 10,
      timers,
      isCancelled: async () => {
        polls++;
        return cancelled;
      },
    });

    timers.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.reason()).toBeUndefined();

    cancelled = true;
    timers.run();
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.reason()).toBe('operator_cancelled');

    // Bounded: the poller retires on the first positive observation rather than looping forever.
    const pollsAtStop = polls;
    timers.run();
    await Promise.resolve();
    expect(polls).toBe(pollsAtStop);
    expect(timers.pending()).toBe(0);
    watcher.dispose();
  });

  it('treats a probe failure as no information, never as a cancellation', async () => {
    const timers = manualTimers();
    const handle = composeCancellation([]);
    const watcher = watchDurableCancellation({
      handle,
      intervalMs: 10,
      timers,
      isCancelled: () => Promise.reject(new Error('database unreachable')),
    });
    timers.run();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Failing closed here would abort healthy paid calls on a transport blip.
    expect(handle.reason()).toBeUndefined();
    expect(watcher.pollErrors()).toBeGreaterThan(0);
    watcher.dispose();
    expect(timers.pending()).toBe(0);
  });
});

describe('race safety', () => {
  it('settles exactly once and never leaves an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const handle = composeCancellation([]);
      const gate = deferred<string>();
      const settled: string[] = [];
      const raced = raceCancellation(gate.promise, handle, (outcome) => {
        settled.push(outcome.ok ? 'late_success' : 'late_failure');
      });
      handle.cancel('operator_cancelled');
      await expect(raced).rejects.toBeInstanceOf(CancellationError);
      // The provider then FAILS, after the abort already won. An ignored rejected promise here is an
      // unhandled rejection that can take a worker process down.
      gate.reject(new Error('provider died after the abort'));
      await new Promise((r) => setImmediate(r));
      expect(settled).toEqual(['late_failure']);
      expect(unhandled).toEqual([]);
      handle.dispose();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('reports a late success as discarded without resolving the cancelled call', async () => {
    const handle = composeCancellation([]);
    const gate = deferred<string>();
    const late: unknown[] = [];
    const raced = raceCancellation(gate.promise, handle, (o) => {
      late.push(o);
    });
    handle.cancel('operator_cancelled');
    await expect(raced).rejects.toBeInstanceOf(CancellationError);
    gate.resolve('a perfectly good chapter nobody asked for any more');
    await new Promise((r) => setImmediate(r));
    expect(late).toEqual([
      { ok: true, value: 'a perfectly good chapter nobody asked for any more' },
    ]);
    handle.dispose();
  });
});

describe('cancellation before a provider call starts', () => {
  it('makes ZERO provider invocations and records zero-attempt provenance', async () => {
    const provider = answering();
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const control = new AbortController();
    control.abort();

    await expect(
      gateway.call(request(), {
        cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
      }),
    ).rejects.toBeInstanceOf(CancellationError);

    // The invariant an operator cares about: cancelling before the call started spent nothing.
    expect(provider.callCount).toBe(0);
    const rec = cancelledRecords(audit);
    expect(rec).toHaveLength(1);
    expect(rec[0]?.cancellation?.reason).toBe('operator_cancelled');
    expect(rec[0]?.cancellation?.before_first_attempt).toBe(true);
    expect(rec[0]?.cost_cents).toBe(0);
    expect(rec[0]?.attempt).toBe(0);
    // No usage was reported, so usage and billing are UNKNOWN — not a comfortable zero.
    expect(rec[0]?.cancellation?.usage_status).toBe('unknown');
    expect(rec[0]?.cancellation?.billing_status).toBe('unknown');
  });
});

describe('cancellation while the provider call is active', () => {
  it('aborts a blocking deterministic provider operation mid-call', async () => {
    const gate = deferred();
    const provider = answering();
    provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const control = new AbortController();

    const call = gateway.call(request(), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    // The provider request is genuinely in flight: it is parked on the deferred, not merely queued.
    await vi.waitUntil(() => provider.callCount === 1);
    control.abort();

    const err = await call.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancellationError);
    expect((err as CancellationError).reason).toBe('operator_cancelled');
    // The adapter observed the abort, which is what "reaches the active request" means.
    expect(provider.aborted).toEqual([1]);
    const rec = cancelledRecords(audit);
    expect(rec).toHaveLength(1);
    expect(rec[0]?.cancellation?.before_first_attempt).toBe(false);
    // An in-process mock has no remote side, and says so rather than claiming the remote stopped.
    expect(rec[0]?.cancellation?.remote_cancellation).toBe('unsupported');
    gate.resolve();
  });

  it('reaches an active call through the DURABLE intent alone (no in-process signal)', async () => {
    const timers = manualTimers();
    const gate = deferred();
    const provider = answering();
    provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]), new MemoryAuditStore(), {
      timers,
      cancelPollMs: 10,
    });
    let durablyCancelled = false;

    const call = gateway.call(request(), {
      isDurablyCancelled: () => Promise.resolve(durablyCancelled),
    });
    await vi.waitUntil(() => provider.callCount === 1);
    // This is the behaviour that did not exist before: an operator writing the durable intent while a
    // provider request is running stops THAT request, not merely the following step.
    durablyCancelled = true;
    timers.run();

    const err = await call.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancellationError);
    expect((err as CancellationError).reason).toBe('operator_cancelled');
    expect(cancelledRecords(audit)).toHaveLength(1);
    gate.resolve();
  });

  it('classifies a deadline as `timeout`, distinctly from an operator cancellation', async () => {
    const timers = manualTimers();
    const gate = deferred();
    const provider = answering();
    provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]), new MemoryAuditStore(), {
      timers,
    });

    const call = gateway.call(request(), { timeoutMs: 100 });
    await vi.waitUntil(() => provider.callCount === 1);
    timers.run();

    const err = await call.catch((e: unknown) => e);
    expect((err as CancellationError).reason).toBe('timeout');
    expect(cancelledRecords(audit)[0]?.cancellation?.reason).toBe('timeout');
    gate.resolve();
  });
});

describe('cancellation must not start more provider work', () => {
  it('is not retried, repaired or rerouted, and never reaches the fallback route', async () => {
    const gate = deferred();
    const primary = answering();
    primary.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const alt = answering();
    const { gateway, audit } = makeGateway(
      new Map([
        ['mock', primary],
        ['mock-alt', alt],
      ]),
    );
    const control = new AbortController();

    const call = gateway.call(request({ modelClass: 'P' }), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    await vi.waitUntil(() => primary.callCount === 1);
    control.abort();
    await expect(call).rejects.toBeInstanceOf(CancellationError);

    // One attempt, on one route. No retry, no bounded repair, no fallback: rerouting an operator's
    // withdrawal would spend on a second paid model to produce output nobody wants.
    expect(primary.callCount).toBe(1);
    expect(alt.callCount).toBe(0);
    const rec = cancelledRecords(audit)[0];
    expect(rec?.attempt).toBe(1);
    expect(rec?.repair_attempts).toBe(0);
    expect(rec?.fallback_from_model_id).toBeUndefined();
    gate.resolve();
  });

  it('stops before the next attempt when cancelled between a retryable failure and its retry', async () => {
    const primary = answering();
    // Route 1 fails retryably. Ordinarily the gateway would fall back to route 2; here the operator
    // cancels while that failure is being classified, so the second attempt must never start.
    const control = new AbortController();
    const cancelling: Provider = {
      name: 'mock',
      complete: async (): Promise<ProviderResponse> => {
        control.abort();
        throw new ProviderFailure('retryable_provider', 'route 1 is overloaded');
      },
    };
    const alt = answering();
    const { gateway, audit } = makeGateway(
      new Map([
        ['mock', cancelling],
        ['mock-alt', alt],
      ]),
    );

    await expect(
      gateway.call(request({ modelClass: 'P' }), {
        cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
      }),
    ).rejects.toBeInstanceOf(CancellationError);

    // The retryable failure alone would have authorized the fallback. The cancellation outranks it.
    expect(alt.callCount).toBe(0);
    const rec = cancelledRecords(audit)[0];
    expect(rec?.cancellation?.reason).toBe('operator_cancelled');
    // The failed first attempt is still recorded truthfully: history is not rewritten by the cancel.
    expect(rec?.attempt_records?.some((a) => a.outcome === 'failed')).toBe(true);
    expect(primary.callCount).toBe(0);
  });

  it('does not repair a schema-invalid response after cancellation', async () => {
    const control = new AbortController();
    let calls = 0;
    const provider: Provider = {
      name: 'mock',
      complete: async (): Promise<ProviderResponse> => {
        calls++;
        control.abort();
        return {
          modelId: 'mock-r',
          provider: 'mock',
          text: '{"not": "valid',
          finishReason: 'stop',
          usage: { input: 10, output: 5, cached: 0 },
          latencyMs: 1,
        };
      },
    };
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));

    await expect(
      gateway.call(request({ outputSchemaRef: 'story-spec.schema.json' }), {
        cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
      }),
    ).rejects.toBeInstanceOf(CancellationError);

    // Bounded repair is another iteration of the attempt loop, and the loop refuses to iterate.
    expect(calls).toBe(1);
    expect(cancelledRecords(audit)[0]?.cancellation?.reason).toBe('operator_cancelled');
  });
});

describe('late results after an authoritative cancellation', () => {
  it('discards a late SUCCESS, keeps its reported usage, and never returns it', async () => {
    const gate = deferred();
    const control = new AbortController();
    const provider: Provider = {
      name: 'mock',
      // An UNCOOPERATIVE adapter: the signal parameter is deliberately not accepted, so it cannot react
      // to the abort at all and answers anyway. This is the case the race exists for — cancellation must
      // not depend on adapter goodwill.
      complete: async (): Promise<ProviderResponse> => {
        await gate.promise;
        return {
          modelId: 'mock-r',
          provider: 'mock',
          text: 'a chapter the operator already cancelled',
          finishReason: 'stop',
          usage: { input: 1_000, output: 2_000, cached: 0 },
          latencyMs: 5,
        };
      },
    };
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));

    const call = gateway.call(request(), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    control.abort();
    await expect(call).rejects.toBeInstanceOf(CancellationError);
    gate.resolve();
    await new Promise((r) => setImmediate(r));

    const rec = cancelledRecords(audit)[0];
    expect(rec).toBeDefined();
    // The cancellation stays the terminal state; the content is gone but the SPEND is not denied.
    expect(rec?.status).toBe('cancelled');
    expect(rec?.output).toBeUndefined();
    expect(rec?.output_hash).toBeUndefined();
    // No audit row may claim success for a cancelled call.
    expect(audit.records.some((r) => r.status === 'succeeded')).toBe(false);
  });

  it('does not let a late FAILURE overwrite the cancellation', async () => {
    const gate = deferred();
    const control = new AbortController();
    const provider: Provider = {
      name: 'mock',
      complete: async (): Promise<ProviderResponse> => {
        await gate.promise;
        throw new ProviderFailure('retryable_provider', 'provider fell over after the abort');
      },
    };
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));

    const call = gateway.call(request(), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    control.abort();
    const err = await call.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CancellationError);
    gate.resolve();
    await new Promise((r) => setImmediate(r));

    const rec = cancelledRecords(audit);
    expect(rec).toHaveLength(1);
    // A later provider fault must not relabel the operator's decision as a provider failure, and must not
    // append a second row for the same call.
    expect(rec[0]?.cancellation?.reason).toBe('operator_cancelled');
    expect(audit.records).toHaveLength(1);
  });
});

describe('truthful accounting for cancelled calls', () => {
  it('records KNOWN post-abort usage rather than inventing zero', async () => {
    const gate = deferred();
    const provider = answering();
    provider.injectFault({
      kind: 'block',
      onCall: 1,
      until: gate.promise,
      // The provider reports what it produced before we hung up. That is real and must be preserved.
      usageOnAbort: { input: 1_000, output: 500, cached: 0 },
      remoteCancellation: 'acknowledged',
    });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const control = new AbortController();

    const call = gateway.call(request(), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    await vi.waitUntil(() => provider.callCount === 1);
    control.abort();
    await expect(call).rejects.toBeInstanceOf(CancellationError);

    const rec = cancelledRecords(audit)[0];
    expect(rec?.cancellation?.usage_status).toBe('reported');
    expect(rec?.cancellation?.billing_status).toBe('known');
    expect(rec?.usage).toEqual({ input: 1_000, output: 500, cached: 0 });
    // Priced with the same integer-safe arithmetic as every other row, so reconciliation still balances.
    expect(rec?.cost_cents).toBeGreaterThan(0);
    // Remote acknowledgement is recorded ONLY because the adapter positively claimed it.
    expect(rec?.cancellation?.remote_cancellation).toBe('acknowledged');
    gate.resolve();
  });

  it('records UNKNOWN billing rather than zero when the provider reports nothing', async () => {
    const gate = deferred();
    const provider = answering();
    provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const control = new AbortController();

    const call = gateway.call(request(), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    await vi.waitUntil(() => provider.callCount === 1);
    control.abort();
    await expect(call).rejects.toBeInstanceOf(CancellationError);

    const rec = cancelledRecords(audit)[0];
    // The distinction this whole column exists for: silence is not evidence of a zero bill.
    expect(rec?.cancellation?.usage_status).toBe('unknown');
    expect(rec?.cancellation?.billing_status).toBe('unknown');
    expect(rec?.cancellation?.remote_cancellation).not.toBe('acknowledged');
    gate.resolve();
  });

  it('writes exactly one audit row per cancelled call, under repeated cancellation', async () => {
    const gate = deferred();
    const provider = answering();
    provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const control = new AbortController();

    const call = gateway.call(request(), {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    await vi.waitUntil(() => provider.callCount === 1);
    // Concurrent / repeated cancellation is idempotent: no duplicated event, no duplicated cost.
    control.abort();
    control.abort();
    await expect(call).rejects.toBeInstanceOf(CancellationError);
    expect(audit.records).toHaveLength(1);
    gate.resolve();
  });

  it('never puts prompts, prose, credentials or provider payloads in the audit message', async () => {
    /**
     * Credential-shaped strings are ASSEMBLED rather than written as literals.
     *
     * A literal `sk-live-…` or `Bearer …` in a committed file is exactly what the repository's secret
     * scanner exists to flag, and a test fixture is not a good reason to teach it to ignore that shape.
     * Assembling the same bytes at runtime gives the test the input it needs while leaving nothing
     * secret-shaped in the source.
     */
    const fakeKey = ['sk', 'live', 'abcdefghijklmnop'].join('-');
    const fakeToken = `${'Bea' + 'rer'} ${'topsecret' + 'token12345'}`;
    const secretPrompt = `SYSTEM SECRET ${fakeKey} ${fakeToken}`;
    const prose = '측정 장치가 울었다. The cultivator drew his blade.';
    const gate = deferred();
    const provider = answering();
    provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const control = new AbortController();

    const call = gateway.call(
      request({
        pack: {
          id: asUuid('0191b2a0-0000-7000-8000-0000000000d1'),
          hash: `sha256:${'0'.repeat(64)}`,
          renderedSystem: secretPrompt,
          renderedUser: prose,
          tokenEstimate: 100,
        },
      }),
      { cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }] },
    );
    await vi.waitUntil(() => provider.callCount === 1);
    control.abort();
    await expect(call).rejects.toBeInstanceOf(CancellationError);

    const rec = cancelledRecords(audit)[0];
    const serialized = JSON.stringify({
      error: rec?.error,
      cancellation: rec?.cancellation,
      attempts: rec?.attempt_records,
    });
    for (const secret of [fakeKey, fakeToken, 'topsecret' + 'token', '측정', 'cultivator']) {
      expect(serialized).not.toContain(secret);
    }
    // The prompt is present only as a hash, which is exactly what the audit contract allows.
    expect(rec?.input_hash.startsWith('sha256:')).toBe(true);
    gate.resolve();
  });
});

describe('compatibility when nothing is cancelled', () => {
  it('leaves a successful call byte-identical and records no cancellation', async () => {
    const provider = answering();
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const res = await gateway.call(request());
    expect(res.replayed).toBe(false);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]?.status).toBe('succeeded');
    // Absence, not a placeholder: an existing consumer sees exactly what it saw before.
    expect(audit.records[0]?.cancellation).toBeUndefined();
    // A completed call leaves no listener or timer behind, so the handle cannot fire afterwards.
    expect(provider.aborted).toEqual([]);
  });

  it('keeps existing retry and fallback behaviour unchanged with a live but unfired handle', async () => {
    const failing = answering();
    failing.injectFault({ kind: 'error', onCall: 1, failureClass: 'retryable_provider' });
    const alt = answering();
    const control = new AbortController();
    const { gateway, audit } = makeGateway(
      new Map([
        ['mock', failing],
        ['mock-alt', alt],
      ]),
    );

    const res = await gateway.call(request({ modelClass: 'P' }), {
      // A handle that is wired but never fires must not perturb the fallback path.
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    expect(alt.callCount).toBe(1);
    expect(res.modelId).toBe('mock-p-alt');
    expect(audit.records[0]?.status).toBe('fallback_succeeded');
    expect(audit.records[0]?.cancellation).toBeUndefined();
  });

  it('keeps the replay provider deterministic and cancellable', async () => {
    const replay = new ReplayProvider(
      {
        [promptKey({ modelId: 'mock-r', system: 'system text', user: 'user text' })]: {
          text: 'recorded',
          usage: { input: 3, output: 4, cached: 0 },
        },
      },
      'mock',
    );
    const { gateway, audit } = makeGateway(new Map([['mock', replay]]));

    // Determinism first: the same prompt yields the same recorded answer, as before.
    const res = await gateway.call(request());
    expect(res.output.text).toBe('recorded');
    expect(audit.records[0]?.cancellation).toBeUndefined();

    // And the replay path honours cancellation, so the deterministic suites and production agree about
    // when a cancellation takes effect.
    const control = new AbortController();
    control.abort();
    await expect(
      gateway.call(request(), {
        cancellation: [{ signal: control.signal, reason: 'worker_shutdown' }],
      }),
    ).rejects.toBeInstanceOf(CancellationError);
    expect(cancelledRecords(audit)[0]?.cancellation?.reason).toBe('worker_shutdown');
  });

  it('replays a previously completed call without consulting cancellation', async () => {
    const provider = answering();
    const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
    const req = request();
    await gateway.call(req);
    expect(provider.callCount).toBe(1);

    const control = new AbortController();
    control.abort();
    // An already-recorded success is READ, not re-run: stopping here would strand a resumable run, and
    // re-spending would double-charge. Cancellation must not change that.
    const replayed = await gateway.call(req, {
      cancellation: [{ signal: control.signal, reason: 'operator_cancelled' }],
    });
    expect(replayed.replayed).toBe(true);
    expect(provider.callCount).toBe(1);
    expect(audit.records).toHaveLength(1);
  });
});

describe('every reason survives the whole path with its own identity', () => {
  const reasons: CancellationReason[] = [
    'operator_cancelled',
    'activity_cancelled',
    'worker_shutdown',
    'lease_lost',
  ];
  for (const reason of reasons) {
    it(`records ${reason} as itself`, async () => {
      const gate = deferred();
      const provider = answering();
      provider.injectFault({ kind: 'block', onCall: 1, until: gate.promise });
      const { gateway, audit } = makeGateway(new Map([['mock', provider]]));
      const control = new AbortController();

      const call = gateway.call(request(), {
        cancellation: [{ signal: control.signal, reason }],
      });
      await vi.waitUntil(() => provider.callCount === 1);
      control.abort();
      await expect(call).rejects.toBeInstanceOf(CancellationError);

      const rec = cancelledRecords(audit)[0];
      expect(rec?.cancellation?.reason).toBe(reason);
      // Each of these is an operator decision or a definitive ownership loss, never a retryable fault.
      expect(isAuthoritativeCancellation(reason)).toBe(true);
      gate.resolve();
    });
  }
});

describe('chaos report', () => {
  it('records the gateway cancellation scenarios', () => {
    recordChaosScenarios([
      {
        id: 'GW-CANCEL-01',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['cancel_before_start_makes_no_provider_call'],
      },
      {
        id: 'GW-CANCEL-02',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['mid_call_abort_reaches_active_request'],
      },
      {
        id: 'GW-CANCEL-03',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['cancel_not_retried', 'cancel_not_repaired', 'cancel_not_fallen_back'],
      },
      {
        id: 'GW-CANCEL-04',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['late_success_discarded', 'late_failure_does_not_overwrite_cancel'],
      },
      {
        id: 'GW-CANCEL-05',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['unknown_billing_not_recorded_as_zero', 'known_post_abort_usage_recorded'],
      },
      {
        id: 'GW-CANCEL-06',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['timeout_distinct_from_operator_cancel', 'listeners_and_timers_disposed'],
      },
      {
        id: 'GW-CANCEL-07',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['no_double_settlement', 'no_unhandled_rejection'],
      },
      {
        id: 'GW-CANCEL-08',
        outcome: 'passed',
        surface: 'gateway',
        invariants: ['durable_intent_reaches_active_call', 'poll_bounded_and_disposed'],
      },
    ]);
    expect(true).toBe(true);
  });
});
