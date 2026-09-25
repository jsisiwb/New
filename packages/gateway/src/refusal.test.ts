/**
 * Declined requests and error classes (ADR-0080): a content filter, a safety block or a refusal reply is
 * its own class with its own counter; under the policy's refusal rule the same request is retried on the
 * same route and then fails MODEL_REFUSED; without the rule the call behaves as before. Empty replies,
 * 5xx and transport faults keep distinct audit error classes; truncated JSON is labelled apart.
 */
import { describe, expect, it } from 'vitest';
import { asUuid, normalizationCounts } from '@yeonjae/domain';
import { type TimerFns } from './cancellation.js';
import { classifyProviderFailure, ProviderFailure } from './failures.js';
import {
  errorClassOf,
  Gateway,
  MemoryAuditStore,
  MemoryBudget,
  type RoutingTable,
} from './gateway.js';
import { mapFinishReason } from './http-provider.js';
import { notionModelFromEnv, notionRouting } from './provider-mode.js';
import { looksLikeRefusal, looksTruncatedJson } from './refusal.js';
import {
  type FinishReason,
  type GatewayRequest,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderRetryPolicy,
} from './types.js';

type Step = { text: string; finish?: FinishReason } | { throw: ProviderFailure };

class Scripted implements Provider {
  readonly name = 'scripted';
  readonly seen: string[] = [];
  constructor(private readonly steps: Step[]) {}
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    this.seen.push(req.modelId);
    const step = this.steps.shift() ?? { text: 'ok' };
    if ('throw' in step) throw step.throw;
    return {
      modelId: req.modelId,
      provider: this.name,
      usage: { input: 10, output: 5, cached: 0 },
      latencyMs: 3,
      text: step.text,
      finishReason: step.finish ?? 'stop',
    };
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
  P: [route('pool-1', 1), route('pool-2', 2)],
  M: [route('pool-1', 1), route('pool-2', 2)],
  C: [],
  E: [],
};

const timers: TimerFns = {
  setTimeout: (fn, ms) => {
    queueMicrotask(fn);
    return ms;
  },
  clearTimeout: () => undefined,
};

const BASE: ProviderRetryPolicy = {
  max_attempts: 6,
  base_delay_ms: 1_000,
  max_delay_ms: 8_000,
  multiplier: 2,
  jitter: 'none',
  retry_empty_reply: true,
};
const WITH_RULE: ProviderRetryPolicy = { ...BASE, refusal: { max_retries: 1, detect_text: true } };

let seq = 0;
function request(
  retry: ProviderRetryPolicy | undefined,
  kind: 'prose' | 'json' | 'text',
): GatewayRequest {
  seq += 1;
  return {
    workspaceId: asUuid('00000000-0000-7000-8000-000000000001'),
    projectId: asUuid('00000000-0000-7000-8000-000000000002'),
    jobId: asUuid('00000000-0000-7000-8000-000000000003'),
    activityId: `refusal-${String(seq)}`,
    idempotencyKey: `refusal-key-${String(seq)}`,
    role: kind === 'prose' ? 'scene_writer' : 'continuity_checker',
    styleSensitive: false,
    manuscriptProducing: kind === 'prose',
    ...(kind === 'prose'
      ? {
          narrativeIdentityRef: {
            blockHash: 'sha256:block',
            identityVersionId: asUuid('00000000-0000-7000-8000-000000000001'),
            roleVariant: 'writer_full',
            outputLanguage: 'ko' as const,
            outputLanguageContractHash: 'sha256:ol',
            traditionContractHash: 'sha256:tr',
          },
        }
      : {}),
    promptVersionId: asUuid('00000000-0000-7000-8000-000000000004'),
    promptHash: 'sha256:prompt',
    productionPolicyVersion: 'standard.v12',
    pack: {
      id: asUuid('00000000-0000-7000-8000-000000000005'),
      hash: 'sha256:pack',
      renderedSystem: '쓴다.',
      renderedUser: '장면.',
      tokenEstimate: 10,
    },
    outputMode: kind === 'json' ? 'json' : 'text',
    modelClass: kind === 'prose' ? 'P' : 'M',
    ...(retry ? { retry } : {}),
  };
}

function gateway(provider: Provider) {
  const audit = new MemoryAuditStore();
  const gw = new Gateway({
    providers: new Map([['scripted', provider]]),
    routing,
    budget: new MemoryBudget(1_000_000),
    audit,
    timers,
    random: () => 0.5,
  });
  return { gw, audit };
}

const SCENE = '그는 문을 열었다. '.repeat(80);
const KO_REFUSAL = '죄송하지만 요청하신 내용은 작성해 드릴 수 없습니다.';

describe('refusal detection (ADR-0080)', () => {
  it('recognizes short Korean and English refusals and nothing long or ordinary', () => {
    expect(looksLikeRefusal(KO_REFUSAL)).toBe(true);
    expect(looksLikeRefusal('해당 요청은 안전 정책 위반 때문에 처리할 수 없습니다.')).toBe(true);
    expect(looksLikeRefusal("I'm sorry, but I can't help with that request.")).toBe(true);
    expect(looksLikeRefusal('I cannot create that content.')).toBe(true);
    expect(looksLikeRefusal('{"issues": []}')).toBe(false);
    expect(looksLikeRefusal('확인')).toBe(false);
    // A scene that quotes an apology is a scene.
    expect(looksLikeRefusal(`${SCENE}\n“${KO_REFUSAL}”`)).toBe(false);
  });

  it('tells a cut-off JSON answer from a malformed one', () => {
    expect(looksTruncatedJson('{"issues": [{"kind": "x", "quote": "그는')).toBe(true);
    expect(looksTruncatedJson('```json\n[1, 2, 3')).toBe(true);
    expect(looksTruncatedJson('{"a": 1}')).toBe(false);
    expect(looksTruncatedJson('설명입니다. {"a": 1')).toBe(false);
  });

  it('maps Gemini finish reasons by meaning instead of collapsing them to stop', () => {
    expect(mapFinishReason('MAX_TOKENS')).toBe('length');
    expect(mapFinishReason('SAFETY')).toBe('content_filter');
    expect(mapFinishReason('PROHIBITED_CONTENT')).toBe('content_filter');
    expect(mapFinishReason('RECITATION')).toBe('content_filter');
    expect(mapFinishReason('stop')).toBe('stop');
    expect(mapFinishReason('STOP')).toBe('stop');
    expect(mapFinishReason(undefined)).toBe('stop');
  });

  it('classifies a safety block as refused and keeps empty, 5xx and transport faults apart', () => {
    expect(classifyProviderFailure(new Error('blocked: SAFETY'))).toBe('refused');
    expect(classifyProviderFailure(new Error('content filter triggered'))).toBe('refused');
    const empty = new ProviderFailure('retryable_provider', 'empty', { reason: 'empty_reply' });
    const fivexx = new ProviderFailure('retryable_provider', 'HTTP 503', { reason: 'http_5xx' });
    const net = new ProviderFailure('retryable_transport', 'reset', { reason: 'transport' });
    const safety = new ProviderFailure('refused', 'HTTP 400', { reason: 'safety_block' });
    expect(errorClassOf(empty, 'retryable_provider')).toBe('EMPTY_REPLY');
    expect(errorClassOf(fivexx, 'retryable_provider')).toBe('HTTP_5XX');
    expect(errorClassOf(net, 'retryable_transport')).toBe('TRANSPORT');
    expect(errorClassOf(safety, 'refused')).toBe('REFUSED');
    expect(errorClassOf(new Error('x'), 'non_retryable_unknown')).toBe('PROVIDER_FAILED');
  });
});

describe('refusal retry rule (ADR-0080)', () => {
  it('retries a content-filter finish on the same route, then fails MODEL_REFUSED', async () => {
    const provider = new Scripted([
      { text: '', finish: 'content_filter' },
      { text: '', finish: 'content_filter' },
      { text: 'never' },
    ]);
    const { gw, audit } = gateway(provider);
    await expect(gw.call(request(WITH_RULE, 'text'))).rejects.toThrow(/MODEL_REFUSED/);
    // Same route both times: a refusal is judged on the request, not on a transport route.
    expect(provider.seen).toEqual(['pool-1', 'pool-1']);
    const records = audit.records.at(-1)?.attempt_records ?? [];
    expect(records.map((r) => [r.failure_class, r.error_class, r.refusal_reason])).toEqual([
      ['refused', 'REFUSED', 'content_filter'],
      ['refused', 'REFUSED', 'content_filter'],
    ]);
    expect(audit.records.at(-1)?.error?.class).toBe('MODEL_REFUSED');
  });

  it('retries a refusal reply where prose belongs and accepts the next real draft', async () => {
    const provider = new Scripted([{ text: KO_REFUSAL }, { text: SCENE }]);
    const { gw, audit } = gateway(provider);
    const res = await gw.call(request(WITH_RULE, 'prose'));
    expect(res.output.text).toBe(SCENE);
    const records = audit.records.at(-1)?.attempt_records ?? [];
    expect(records.map((r) => [r.outcome, r.error_class ?? null])).toEqual([
      ['failed', 'REFUSED'],
      ['succeeded', null],
    ]);
  });

  it('treats a refusal instead of JSON as declined, not as a schema repair', async () => {
    const provider = new Scripted([{ text: KO_REFUSAL }, { text: '{"issues": []}' }]);
    const { gw, audit } = gateway(provider);
    const res = await gw.call(request(WITH_RULE, 'json'));
    expect(res.output.json).toEqual({ issues: [] });
    const failed = (audit.records.at(-1)?.attempt_records ?? []).filter(
      (r) => r.outcome === 'failed',
    );
    expect(failed.map((r) => r.error_class)).toEqual(['REFUSED']);
    expect(audit.records.at(-1)?.repair_attempts).toBe(0);
  });

  it('without the rule, a refusal reply passes through exactly as before', async () => {
    const provider = new Scripted([{ text: KO_REFUSAL }]);
    const { gw } = gateway(provider);
    const res = await gw.call(request(BASE, 'prose'));
    expect(res.output.text).toBe(KO_REFUSAL);
    expect(provider.seen).toHaveLength(1);
  });

  it('retries a thrown safety block under the rule and stops without it', async () => {
    const block = () =>
      new ProviderFailure('refused', 'HTTP 400', { status: 400, reason: 'safety_block' });
    const withRule = new Scripted([{ throw: block() }, { text: '{"ok": true}' }]);
    const a = gateway(withRule);
    expect((await a.gw.call(request(WITH_RULE, 'json'))).output.json).toEqual({ ok: true });
    expect(withRule.seen).toEqual(['pool-1', 'pool-1']);
    const without = new Scripted([{ throw: block() }, { text: 'never' }]);
    const b = gateway(without);
    await expect(b.gw.call(request(BASE, 'json'))).rejects.toThrow(/MODEL_REFUSED/);
    expect(without.seen).toHaveLength(1);
  });

  it('labels a fenced JSON answer and a cut-off one on the attempt record', async () => {
    const before = normalizationCounts().json_fence_stripped;
    const provider = new Scripted([
      { text: '{"issues": [{"kind": "x"' },
      { text: '```json\n{"issues": []}\n```' },
    ]);
    const { gw, audit } = gateway(provider);
    await gw.call(request(BASE, 'json'));
    const records = audit.records.at(-1)?.attempt_records ?? [];
    expect(
      records.map((r) => [r.error_class ?? null, r.truncated_json ?? false, r.normalizers ?? []]),
    ).toEqual([
      ['SCHEMA_INVALID', true, []],
      [null, false, ['json_fence_stripped']],
    ]);
    expect(normalizationCounts().json_fence_stripped).toBe(before + 1);
  });
});

describe('notion model id variables (ADR-0080)', () => {
  it('accepts both names, YEONJAE_NOTION_MODEL winning, and reports a conflict without values', () => {
    expect(notionModelFromEnv({})).toEqual({
      model: 'notion-ai',
      source: 'default',
      conflict: false,
    });
    expect(notionModelFromEnv({ YEONJAE_MODEL_NOTION: 'm-alias' })).toEqual({
      model: 'm-alias',
      source: 'YEONJAE_MODEL_NOTION',
      conflict: false,
    });
    expect(
      notionModelFromEnv({ YEONJAE_NOTION_MODEL: 'm-main', YEONJAE_MODEL_NOTION: 'm-alias' }),
    ).toEqual({ model: 'm-main', source: 'YEONJAE_NOTION_MODEL', conflict: true });
    expect(
      notionModelFromEnv({ YEONJAE_NOTION_MODEL: 'same', YEONJAE_MODEL_NOTION: 'same' }).conflict,
    ).toBe(false);
    expect(notionRouting({ YEONJAE_MODEL_NOTION: 'm-alias' }).P[0]?.modelId).toBe('m-alias');
  });
});
