import { describe, expect, it } from 'vitest';
import { compileBlock, composeIdentity, ProfileStore } from '@yeonjae/narrative';
import { PromptRegistry, renderPrompt } from '@yeonjae/prompts';
import { asUuid } from '@yeonjae/domain';
import {
  Gateway,
  MemoryAuditStore,
  MemoryBudget,
  type RouteEntry,
  type RoutingTable,
} from './gateway.js';
import { guardRequest, sha256 } from './guard.js';
import { MockProvider } from './mock-provider.js';
import { ReplayProvider } from './replay-provider.js';
import { GatewayError, type GatewayRequest } from './types.js';

const store = ProfileStore.fromDirectory();
const identity = composeIdentity(
  store,
  'project/0191b2a0-0000-7000-8000-000000000001@1',
  '0191b2a0-0000-7000-8000-000000060001',
);
const registry = PromptRegistry.fromDirectory();

const routing: RoutingTable = {
  P: [
    {
      modelId: 'mock-p-primary',
      provider: 'mock',
      priority: 1,
      family: 'alpha',
      priceInPerMTokCents: 300,
      priceOutPerMTokCents: 1500,
      maxContextTokens: 128_000,
      supportsJsonSchema: true,
    },
    {
      modelId: 'mock-p-alt',
      provider: 'mock-alt',
      priority: 2,
      family: 'beta',
      priceInPerMTokCents: 300,
      priceOutPerMTokCents: 1500,
      maxContextTokens: 128_000,
      supportsJsonSchema: true,
    },
  ],
  R: [
    {
      modelId: 'mock-r',
      provider: 'mock',
      priority: 1,
      family: 'alpha',
      priceInPerMTokCents: 1000,
      priceOutPerMTokCents: 4000,
      maxContextTokens: 200_000,
      supportsJsonSchema: true,
    },
  ],
  M: [
    {
      modelId: 'mock-m',
      provider: 'mock',
      priority: 1,
      family: 'alpha',
      priceInPerMTokCents: 100,
      priceOutPerMTokCents: 400,
      maxContextTokens: 128_000,
      supportsJsonSchema: true,
    },
  ],
  C: [
    {
      modelId: 'mock-c',
      provider: 'mock',
      priority: 1,
      family: 'alpha',
      priceInPerMTokCents: 10,
      priceOutPerMTokCents: 40,
      maxContextTokens: 128_000,
      supportsJsonSchema: false,
    },
  ],
  E: [],
};

const ids = {
  ws: asUuid('0191b2a0-0000-7000-8000-000000000000'),
  project: asUuid('0191b2a0-0000-7000-8000-000000000001'),
  job: asUuid('0191b2a0-0000-7000-8000-0000000f0001'),
  pack: asUuid('0191b2a0-0000-7000-8000-0000000f0002'),
  prompt: asUuid('0191b2a0-0000-7000-8000-0000000f0003'),
};

const ENGLISH_SCENE = {
  scene_no: 1,
  language: 'en',
  text: 'The device cried out, and the hall went quiet.\n\n“F-rank,” the officer said. “Porter registration is on the left.”\n\nDo-yoon looked at his hand. It was not shaking.',
  paragraphs: [{ id: 'p1', start: 0, end: 46, kind: 'narration' }],
  speaker_annotations: [],
  claims: [],
};

function writerRequest(
  overrides: Partial<GatewayRequest> = {},
  blockBudget = 6000,
): { req: GatewayRequest; system: string } {
  const block = compileBlock(identity, { role: 'writer_full', budgetTokens: blockBudget });
  const pv = registry.get('scene_writer@1.0.0');
  const vars = Object.fromEntries(pv.input_variables.map((v) => [v, `<${v}>`]));
  const rendered = renderPrompt(pv, {
    ...vars,
    narrative_identity_block: block.text,
    identity_tail: block.identityTail ?? '',
  });
  const req: GatewayRequest = {
    workspaceId: ids.ws,
    projectId: ids.project,
    jobId: ids.job,
    activityId: 'scene-1',
    idempotencyKey: `job:${ids.job}:scene:1:${Math.random()}`,
    role: 'scene_writer',
    styleSensitive: true,
    manuscriptProducing: true,
    promptVersionId: ids.prompt,
    promptHash: rendered.promptHash,
    productionPolicyVersion: 'policy/standard@1',
    pack: {
      id: ids.pack,
      hash: 'sha256:pack',
      renderedSystem: rendered.system,
      renderedUser: rendered.user,
      tokenEstimate: 5000,
    },
    narrativeIdentityRef: {
      blockHash: block.hash,
      identityVersionId: asUuid(identity.identityVersionId),
      roleVariant: 'writer_full',
      outputLanguage: 'en',
      outputLanguageContractHash: block.outputLanguageContractHash,
      traditionContractHash: block.traditionContractHash,
    },
    outputSchemaRef: 'scene-draft.schema.json',
    modelClass: 'P',
    ...overrides,
  };
  return { req, system: rendered.system };
}

describe('Narrative Identity Guard (STYLE-GUARD-001)', () => {
  it('passes a well-formed style-sensitive request and returns both contract hashes', () => {
    const { req } = writerRequest();
    const v = guardRequest(req);
    expect(v.checked).toBe(true);
    expect(v.outputLanguageContractHash).toBe(sha256(identity.outputLanguage.contract_text ?? ''));
    expect(v.traditionContractHash).toBe(sha256(identity.tradition.contract_text ?? ''));
  });

  it('fails closed on every missing or stale piece', () => {
    const { req } = writerRequest();
    const ref = req.narrativeIdentityRef;
    if (!ref) throw new Error('no ref');
    expect(() => guardRequest({ ...req, narrativeIdentityRef: undefined })).toThrow(
      /NARRATIVE_IDENTITY_MISSING/,
    );
    expect(() =>
      guardRequest({ ...req, narrativeIdentityRef: { ...ref, outputLanguageContractHash: '' } }),
    ).toThrow(/OUTPUT_LANGUAGE_CONTRACT_MISSING/);
    expect(() =>
      guardRequest({ ...req, narrativeIdentityRef: { ...ref, traditionContractHash: '' } }),
    ).toThrow(/TRADITION_CONTRACT_MISSING/);
    expect(() =>
      guardRequest({
        ...req,
        narrativeIdentityRef: { ...ref, outputLanguage: 'ja' as unknown as 'en' },
      }),
    ).toThrow(/OUTPUT_LANGUAGE_UNSUPPORTED/);
    expect(() =>
      guardRequest({ ...req, narrativeIdentityRef: { ...ref, blockHash: 'sha256:stale' } }),
    ).toThrow(/NARRATIVE_IDENTITY_STALE/);
    expect(() =>
      guardRequest(req, { pinnedIdentityVersionId: '0191b2a0-0000-7000-8000-000000060002' }),
    ).toThrow(/NARRATIVE_IDENTITY_STALE/);
    // The block is referenced but not actually embedded in the rendered system prompt
    expect(() =>
      guardRequest({
        ...req,
        pack: { ...req.pack, renderedSystem: 'You are a writer. Write scene 1.' },
      }),
    ).toThrow(/NARRATIVE_IDENTITY_NOT_EMBEDDED/);
    // Embedded block tampered after hashing (a contract section removed)
    const tampered = req.pack.renderedSystem.replace(
      '## Narrative-Tradition Contract',
      '## Something else',
    );
    expect(() => guardRequest({ ...req, pack: { ...req.pack, renderedSystem: tampered } })).toThrow(
      /NARRATIVE_IDENTITY_STALE|NOT_EMBEDDED/,
    );
  });

  it('non-style-sensitive roles are not guarded', () => {
    const { req } = writerRequest({
      styleSensitive: false,
      manuscriptProducing: false,
      narrativeIdentityRef: undefined,
      role: 'canon_extractor',
    });
    expect(guardRequest(req)).toEqual({ checked: false });
  });
});

describe('Gateway call path', () => {
  function build(extra: { budgetCents?: number; alt?: MockProvider } = {}) {
    const mock = new MockProvider(() => ({ json: ENGLISH_SCENE }));
    const alt = extra.alt ?? new MockProvider(() => ({ json: ENGLISH_SCENE }));
    const audit = new MemoryAuditStore();
    const budget = new MemoryBudget(extra.budgetCents ?? 10_000);
    const gw = new Gateway({
      providers: new Map([
        ['mock', mock],
        ['mock-alt', alt],
      ]),
      routing,
      budget,
      audit,
    });
    return { gw, mock, alt, audit, budget };
  }

  it('sends the answer schema only to a route that declares native JSON-schema output (ADR-0057)', async () => {
    const responseSchema = { name: 'scene_writer', schema: { type: 'object' } };
    const plain = build();
    await plain.gw.call(writerRequest({ responseSchema }).req);
    expect(plain.mock.log[0]?.responseFormat).toBeUndefined();

    const mock = new MockProvider(() => ({ json: ENGLISH_SCENE }));
    const primary: RouteEntry | undefined = routing.P[0];
    if (!primary) throw new Error('the test routing has no P route');
    const native = new Gateway({
      providers: new Map([['mock', mock]]),
      routing: {
        ...routing,
        P: [{ ...primary, nativeStructuredOutput: 'json_schema' }],
      },
      budget: new MemoryBudget(10_000),
      audit: new MemoryAuditStore(),
    });
    await native.call(writerRequest({ responseSchema }).req);
    expect(mock.log[0]?.responseFormat).toEqual({ kind: 'json_schema', ...responseSchema });
    // A request without an answer schema is unchanged even on a capable route.
    await native.call(writerRequest().req);
    expect(mock.log[1]?.responseFormat).toBeUndefined();
  });

  it('records a complete audit row with both contract hashes, prompt/pack hashes, cost and language check', async () => {
    const { gw, audit } = build();
    const { req } = writerRequest();
    const res = await gw.call(req);
    expect(res.replayed).toBe(false);
    expect(res.outputLanguageCheck).toMatchObject({ performed: true, passed: true });
    const row = audit.records[0];
    expect(row).toMatchObject({
      role: 'scene_writer',
      status: 'succeeded',
      schema_valid: true,
      production_policy_version: 'policy/standard@1',
      output_language_contract_hash: req.narrativeIdentityRef?.outputLanguageContractHash,
      tradition_contract_hash: req.narrativeIdentityRef?.traditionContractHash,
      narrative_block_hash: req.narrativeIdentityRef?.blockHash,
    });
    expect(row?.cost_cents).toBeGreaterThan(0);
    expect(row?.input_hash).toMatch(/^sha256:/);
    expect(JSON.stringify(row)).not.toContain('Compose the prose DIRECTLY'); // prompt text is never on the audit row
  });

  it('is idempotent: the same key replays the recorded output without spend', async () => {
    const { gw, mock, budget } = build();
    const { req } = writerRequest({ idempotencyKey: 'fixed-key' });
    const a = await gw.call(req);
    const spent = budget.spentCents(ids.project);
    const b = await gw.call(req);
    expect(b.replayed).toBe(true);
    expect(b.llmCallId).toBe(a.llmCallId);
    expect(mock.callCount).toBe(1);
    expect(budget.spentCents(ids.project)).toBe(spent);
  });

  it('refuses a style-sensitive call without the block before any provider call or spend', async () => {
    const { gw, mock, budget } = build();
    const { req } = writerRequest({ narrativeIdentityRef: undefined });
    await expect(gw.call(req)).rejects.toThrow(GatewayError);
    expect(mock.callCount).toBe(0);
    expect(budget.spentCents(ids.project)).toBe(0);
  });

  it('non-English manuscript output is discarded, regenerated once, then rerouted to the alternate P-class model', async () => {
    const korean = new MockProvider(() => ({
      json: { ...ENGLISH_SCENE, text: '측정 장치가 울었다. 붉은 글자가 떠올랐다. 그는 웃었다.' },
    }));
    const { alt, audit } = build({ alt: new MockProvider(() => ({ json: ENGLISH_SCENE })) });
    const gw2 = new Gateway({
      providers: new Map([
        ['mock', korean],
        ['mock-alt', alt],
      ]),
      routing,
      budget: new MemoryBudget(10_000),
      audit,
    });
    const { req } = writerRequest();
    const res = await gw2.call(req);
    expect(korean.callCount).toBe(2); // first attempt + one regeneration
    expect(alt.callCount).toBe(1); // then reroute
    expect(res.modelId).toBe('mock-p-alt');
    expect(res.outputLanguageCheck).toMatchObject({ performed: true, passed: true });
    expect(audit.records[0]?.status).toBe('fallback_succeeded');
    expect(audit.records[0]?.fallback_from_model_id).toBe('mock-p-primary');
  });

  it('persistent non-English output fails closed with OUTPUT_LANGUAGE_FAILED and a failed audit row', async () => {
    const korean = () =>
      new MockProvider(() => ({
        json: { ...ENGLISH_SCENE, text: '측정 장치가 울었다. 붉은 글자가 떠올랐다.' },
      }));
    const audit = new MemoryAuditStore();
    const gw = new Gateway({
      providers: new Map([
        ['mock', korean()],
        ['mock-alt', korean()],
      ]),
      routing,
      budget: new MemoryBudget(10_000),
      audit,
    });
    const { req } = writerRequest();
    await expect(gw.call(req)).rejects.toMatchObject({ code: 'OUTPUT_LANGUAGE_FAILED' });
    expect(audit.records.at(-1)?.status).toBe('failed');
  });

  it('invalid structured output is retried within the repair budget, then fails with SCHEMA_INVALID', async () => {
    const bad = new MockProvider(() => ({ json: { not: 'a scene' } }));
    const audit = new MemoryAuditStore();
    const gw = new Gateway({
      providers: new Map([
        ['mock', bad],
        ['mock-alt', bad],
      ]),
      routing,
      budget: new MemoryBudget(10_000),
      audit,
    });
    const { req } = writerRequest();
    await expect(gw.call(req)).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(bad.callCount).toBeGreaterThanOrEqual(3);
    expect(audit.records.at(-1)?.schema_valid).toBe(false);
  });

  it('provider failure falls back to the next route and records the fallback', async () => {
    const failing = new MockProvider(() => ({ json: ENGLISH_SCENE })).injectFault({
      kind: 'error',
    });
    const alt = new MockProvider(() => ({ json: ENGLISH_SCENE }));
    const audit = new MemoryAuditStore();
    const gw = new Gateway({
      providers: new Map([
        ['mock', failing],
        ['mock-alt', alt],
      ]),
      routing,
      budget: new MemoryBudget(10_000),
      audit,
    });
    const res = await gw.call(writerRequest().req);
    expect(res.modelId).toBe('mock-p-alt');
    expect(audit.records[0]?.fallback_from_model_id).toBe('mock-p-primary');
  });

  it('budget guard blocks before the call and records budget_blocked', async () => {
    const { gw, mock, audit } = build({ budgetCents: 0 });
    await expect(gw.call(writerRequest().req)).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(mock.callCount).toBe(0);
    expect(audit.records[0]?.status).toBe('budget_blocked');
  });

  it('ReplayProvider replays recordings and refuses unknown prompts (no silent live calls)', async () => {
    const { req } = writerRequest();
    const replay = new ReplayProvider({});
    const gw = new Gateway({
      providers: new Map([
        ['mock', replay],
        ['mock-alt', replay],
      ]),
      routing,
      budget: new MemoryBudget(10_000),
      audit: new MemoryAuditStore(),
    });
    await expect(gw.call(req)).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
    // ONE miss, not two: a missing recording is a non-retryable request failure, so the gateway no longer
    // reroutes it to a second provider to reach the same refusal (B-4-2 fallback authorization).
    expect(replay.misses).toHaveLength(1);
  });
});
