/**
 * Retry policy (ADR-0072): 502/503/504 and empty replies are retryable, retried with exponential backoff
 * and jitter, wrapping over the class's routes up to the policy's attempt cap, with every attempt and its
 * backoff in the audit record. Without a policy the historical behaviour holds.
 */
import { describe, expect, it } from 'vitest';
import { asUuid } from '@yeonjae/domain';
import { type TimerFns } from './cancellation.js';
import { ProviderFailure } from './failures.js';
import {
  backoffDelayMs,
  Gateway,
  MemoryAuditStore,
  MemoryBudget,
  retryAttemptCap,
  type RoutingTable,
} from './gateway.js';
import { classifyHttpStatus } from './http-provider.js';
import {
  type GatewayRequest,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderRetryPolicy,
} from './types.js';

type Step = { fail: number | 'empty' } | { text: string };

class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  readonly seen: string[] = [];
  constructor(private readonly steps: Step[]) {}
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.seen.push(req.modelId);
    const step = this.steps.shift() ?? { text: 'ok' };
    const base = {
      modelId: req.modelId,
      provider: this.name,
      usage: { input: 10, output: 5, cached: 0 },
      latencyMs: 7,
    };
    if ('text' in step) return { ...base, text: step.text, finishReason: 'stop' };
    if (step.fail === 'empty') return { ...base, text: '  ', finishReason: 'stop' };
    throw new ProviderFailure(classifyHttpStatus(step.fail), `HTTP ${String(step.fail)}`, {
      status: step.fail,
    });
  }
}

const route = (modelId: string, priority: number) => ({
  modelId,
  provider: 'scripted',
  priority,
  family: 'pool',
  priceInPerMTokCents: 0,
  priceOutPerMTokCents: 0,
  maxContextTokens: 128_000,
  supportsJsonSchema: false,
});

const routing: RoutingTable = {
  R: [],
  P: [],
  M: [],
  C: [route('pool-1', 1), route('pool-2', 2), route('pool-3', 3)],
  E: [],
};

/** Timers that record each wait and fire it at once, so backoff is asserted without sleeping. */
function instantTimers(waits: number[]): TimerFns {
  return {
    setTimeout: (fn, ms) => {
      waits.push(ms);
      queueMicrotask(fn);
      return ms;
    },
    clearTimeout: () => undefined,
  };
}

let seq = 0;
function request(retry?: ProviderRetryPolicy): GatewayRequest {
  seq += 1;
  return {
    workspaceId: asUuid('00000000-0000-7000-8000-000000000001'),
    projectId: asUuid('00000000-0000-7000-8000-000000000002'),
    jobId: asUuid('00000000-0000-7000-8000-000000000003'),
    activityId: `retry-${String(seq)}`,
    idempotencyKey: `retry-key-${String(seq)}`,
    role: 'continuity_checker',
    styleSensitive: false,
    manuscriptProducing: false,
    promptVersionId: asUuid('00000000-0000-7000-8000-000000000004'),
    promptHash: 'sha256:prompt',
    productionPolicyVersion: 'standard.v6',
    pack: {
      id: asUuid('00000000-0000-7000-8000-000000000005'),
      hash: 'sha256:pack',
      renderedSystem: '검사한다.',
      renderedUser: '본문.',
      tokenEstimate: 10,
    },
    outputMode: 'text',
    modelClass: 'C',
    ...(retry ? { retry } : {}),
  };
}

const POLICY: ProviderRetryPolicy = {
  max_attempts: 6,
  base_delay_ms: 1_000,
  max_delay_ms: 8_000,
  multiplier: 2,
  jitter: 'full',
  retry_empty_reply: true,
};

function gateway(provider: Provider, waits: number[], random = () => 0.5) {
  const audit = new MemoryAuditStore();
  const gw = new Gateway({
    providers: new Map([['scripted', provider]]),
    routing,
    budget: new MemoryBudget(1_000_000),
    audit,
    timers: instantTimers(waits),
    random,
  });
  return { gw, audit };
}

describe('provider retry policy (ADR-0072)', () => {
  it('classifies 502, 503 and 504 as retryable provider faults and 400 as a refused request', () => {
    for (const status of [502, 503, 504])
      expect(classifyHttpStatus(status)).toBe('retryable_provider');
    expect(classifyHttpStatus(429)).toBe('retryable_throttled');
    expect(classifyHttpStatus(400)).toBe('non_retryable_request');
  });

  it('computes exponential backoff with full jitter, capped', () => {
    const none = { ...POLICY, jitter: 'none' as const };
    expect([1, 2, 3, 4, 5].map((n) => backoffDelayMs(none, n))).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000,
    ]);
    expect(backoffDelayMs(POLICY, 3, () => 0.25)).toBe(1_000);
    expect(backoffDelayMs(POLICY, 3, () => 0)).toBe(0);
    expect(retryAttemptCap(undefined)).toBe(4);
    expect(retryAttemptCap({ ...POLICY, max_attempts: 50 })).toBe(8);
  });

  it('retries 502/503/504 and an empty reply with backoff, wrapping over the routes', async () => {
    const waits: number[] = [];
    const provider = new ScriptedProvider([
      { fail: 502 },
      { fail: 503 },
      { fail: 'empty' },
      { fail: 504 },
      { text: '문제 없음.' },
    ]);
    const { gw, audit } = gateway(provider, waits);
    const res = await gw.call(request(POLICY));
    expect(res.output.text).toBe('문제 없음.');
    expect(res.attempts).toBe(5);
    // Three routes, then back to the first: the pool gets the call again instead of giving up.
    expect(provider.seen).toEqual(['pool-1', 'pool-2', 'pool-3', 'pool-1', 'pool-2']);
    // Full jitter at 0.5 of 1 s, 2 s, 4 s, 8 s.
    expect(waits).toEqual([500, 1_000, 2_000, 4_000]);
    const records = audit.records.at(-1)?.attempt_records ?? [];
    expect(records.map((r) => [r.outcome, r.failure_class ?? null, r.error_class ?? null])).toEqual(
      [
        ['failed', 'retryable_provider', 'PROVIDER_FAILED'],
        ['failed', 'retryable_provider', 'PROVIDER_FAILED'],
        ['failed', 'retryable_provider', 'EMPTY_REPLY'],
        ['failed', 'retryable_provider', 'PROVIDER_FAILED'],
        ['succeeded', null, null],
      ],
    );
    expect(records.slice(0, 4).map((r) => r.backoff_ms)).toEqual([500, 1_000, 2_000, 4_000]);
  });

  it('stops at the attempt cap and records the exhausted call with its failure class', async () => {
    const waits: number[] = [];
    const provider = new ScriptedProvider(Array.from({ length: 10 }, () => ({ fail: 502 })));
    const { gw, audit } = gateway(provider, waits);
    await expect(gw.call(request({ ...POLICY, max_attempts: 3 }))).rejects.toThrow(
      /failure_class=retryable_provider/,
    );
    expect(provider.seen).toHaveLength(3);
    // No wait after the last allowed attempt.
    expect(waits).toHaveLength(2);
    const failed = audit.records.at(-1);
    expect(failed?.status).toBe('failed');
    expect(failed?.attempt_records?.at(-1)?.backoff_ms).toBe(0);
  });

  it('does not retry a refused request', async () => {
    const waits: number[] = [];
    const provider = new ScriptedProvider([{ fail: 400 }, { text: 'never' }]);
    const { gw } = gateway(provider, waits);
    await expect(gw.call(request(POLICY))).rejects.toThrow(/non_retryable_request/);
    expect(provider.seen).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('keeps the historical behaviour without a policy: no wait, no wrap, an empty text reply passes', async () => {
    const waits: number[] = [];
    const failing = new ScriptedProvider([
      { fail: 502 },
      { fail: 502 },
      { fail: 502 },
      { text: 'x' },
    ]);
    const a = gateway(failing, waits);
    await expect(a.gw.call(request())).rejects.toThrow(/failure_class=retryable_provider/);
    expect(failing.seen).toEqual(['pool-1', 'pool-2', 'pool-3']);
    expect(waits).toEqual([]);
    expect(a.audit.records.at(-1)?.attempt_records?.[0]).not.toHaveProperty('backoff_ms');
  });
});
