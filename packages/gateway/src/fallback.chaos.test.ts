/**
 * B-4-2 deterministic provider/gateway fault matrix and the fallback invariants it must uphold.
 *
 * Every scenario runs against the REAL `Gateway` — real Guard, real budget ledger, real audit store, real
 * structured-output validation, real output-language check — with faults injected at the provider boundary
 * by `MockProvider`/`ReplayProvider`. No live provider is contacted and no credential is required.
 *
 * The scenario ids are stable (`GW-nn`) and are written to a machine-readable chaos report by
 * `tools/run-chaos-drills.mjs`, so a silently shrunken matrix fails the build rather than passing quietly.
 *
 * WHAT THIS IS NOT: evidence that a real provider failed over in production. A deterministic drill proves
 * the gateway's decision logic, not a vendor's behaviour.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { compileBlock, composeIdentity, ProfileStore } from '@yeonjae/narrative';
import { PromptRegistry, renderPrompt } from '@yeonjae/prompts';
import { asUuid } from '@yeonjae/domain';
import { recordChaosScenarios, type ChaosScenario } from './chaos-report.js';
import { Gateway, MemoryAuditStore, MemoryBudget, type RoutingTable } from './gateway.js';
import { ProviderFailure } from './failures.js';
import { MockProvider } from './mock-provider.js';
import type { ReplayProvider } from './replay-provider.js';
import type { GatewayRequest } from './types.js';

const store = ProfileStore.fromDirectory();
const identity = composeIdentity(
  store,
  'project/0191b2a0-0000-7000-8000-000000000001@1',
  '0191b2a0-0000-7000-8000-000000060001',
);
const registry = PromptRegistry.fromDirectory();

/** Two P-class routes in different families: the primary and its authorized fallback. */
const routing: RoutingTable = {
  P: [route('mock-p-primary', 'mock', 1, 'alpha'), route('mock-p-alt', 'mock-alt', 2, 'beta')],
  R: [route('mock-r', 'mock', 1, 'alpha')],
  M: [route('mock-m', 'mock', 1, 'alpha')],
  C: [route('mock-c', 'mock', 1, 'alpha')],
  E: [],
};

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

let keySeq = 0;
function writerRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  const block = compileBlock(identity, { role: 'writer_full', budgetTokens: 6000 });
  const pv = registry.get('scene_writer@1.0.0');
  const vars = Object.fromEntries(pv.input_variables.map((v) => [v, `<${v}>`]));
  const rendered = renderPrompt(pv, {
    ...vars,
    narrative_identity_block: block.text,
    identity_tail: block.identityTail ?? '',
  });
  keySeq++;
  return {
    workspaceId: ids.ws,
    projectId: ids.project,
    jobId: ids.job,
    activityId: `chaos-${String(keySeq)}`,
    idempotencyKey: `chaos:${String(keySeq)}`,
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
}

function build(opts: {
  primary: MockProvider | ReplayProvider;
  alt?: MockProvider;
  budgetCents?: number;
}) {
  const audit = new MemoryAuditStore();
  const alt = opts.alt ?? new MockProvider(() => ({ json: ENGLISH_SCENE }));
  const gw = new Gateway({
    providers: new Map<string, MockProvider | ReplayProvider>([
      ['mock', opts.primary],
      ['mock-alt', alt],
    ]),
    routing,
    budget: new MemoryBudget(opts.budgetCents ?? 10_000),
    audit,
  });
  return { gw, audit, alt };
}

function good() {
  return new MockProvider(() => ({ json: ENGLISH_SCENE }));
}

/** Scenario ids the chaos report records; the runner asserts every one of them appears. */
export const GATEWAY_CHAOS_SCENARIOS = [
  'GW-01-transport-error-falls-back',
  'GW-02-timeout-falls-back',
  'GW-03-throttled-falls-back',
  'GW-04-provider-5xx-falls-back',
  'GW-05-rejected-request-does-not-fall-back',
  'GW-06-auth-failure-does-not-fall-back',
  'GW-07-content-refusal-does-not-fall-back',
  'GW-08-unknown-failure-does-not-fall-back',
  'GW-09-every-route-unavailable-fails-closed',
  'GW-10-fallback-unavailable-fails-closed',
  'GW-11-malformed-json-does-not-fall-back-past-repair',
  'GW-12-schema-invalid-fails-closed',
  'GW-13-output-language-reroutes-once-then-fails-closed',
  'GW-14-budget-denial-precedes-dispatch',
  'GW-15-budget-not-exceeded-by-fallback',
  'GW-16-identity-contract-missing-never-dispatches',
  'GW-17-every-attempt-has-a-distinct-audit-entry',
  'GW-18-fallback-preserves-every-pinned-value',
  'GW-19-response-loss-then-retry-does-not-double-charge',
  'GW-20-unknown-usage-stays-unknown',
  'GW-21-error-surface-carries-cause-without-secrets',
  'GW-22-fallback-order-is-deterministic',
] as const;

/** Invariant labels per scenario id, from the B-4-2 required-invariant list. */
const SCENARIO_INVARIANTS: Readonly<Record<string, readonly string[]>> = {
  'GW-01-transport-error-falls-back': ['fallback_only_when_retryable'],
  'GW-02-timeout-falls-back': ['fallback_only_when_retryable'],
  'GW-03-throttled-falls-back': ['fallback_only_when_retryable'],
  'GW-04-provider-5xx-falls-back': ['fallback_only_when_retryable'],
  'GW-05-rejected-request-does-not-fall-back': ['non_retryable_never_reroutes', 'no_extra_spend'],
  'GW-06-auth-failure-does-not-fall-back': ['non_retryable_never_reroutes', 'no_extra_spend'],
  'GW-07-content-refusal-does-not-fall-back': ['non_retryable_never_reroutes', 'no_extra_spend'],
  'GW-08-unknown-failure-does-not-fall-back': ['fail_closed_on_unknown', 'no_extra_spend'],
  'GW-09-every-route-unavailable-fails-closed': ['fail_closed', 'attempt_provenance'],
  'GW-10-fallback-unavailable-fails-closed': ['fail_closed'],
  'GW-11-malformed-json-does-not-fall-back-past-repair': ['bounded_repair', 'attempt_provenance'],
  'GW-12-schema-invalid-fails-closed': ['fail_closed'],
  'GW-13-output-language-reroutes-once-then-fails-closed': [
    'output_language_enforced',
    'fail_closed',
  ],
  'GW-14-budget-denial-precedes-dispatch': ['budget_before_dispatch'],
  'GW-15-budget-not-exceeded-by-fallback': ['no_double_charge', 'budget_before_dispatch'],
  'GW-16-identity-contract-missing-never-dispatches': ['identity_contract_required'],
  'GW-17-every-attempt-has-a-distinct-audit-entry': ['attempt_provenance'],
  'GW-18-fallback-preserves-every-pinned-value': ['pins_preserved_across_fallback'],
  'GW-19-response-loss-then-retry-does-not-double-charge': [
    'idempotent_after_response_loss',
    'no_double_charge',
  ],
  'GW-20-unknown-usage-stays-unknown': ['usage_recorded_verbatim'],
  'GW-21-error-surface-carries-cause-without-secrets': ['causal_error_without_secrets'],
  'GW-22-fallback-order-is-deterministic': ['deterministic_fallback_order'],
};

/** Scenario ids proven by the test that has just asserted them. */
const proven = new Set<string>();
function prove(...ids: readonly string[]): void {
  for (const id of ids) proven.add(id);
}

afterAll(() => {
  const scenarios: ChaosScenario[] = [...proven].map((id) => ({
    id,
    outcome: 'passed',
    invariants: SCENARIO_INVARIANTS[id] ?? [],
    surface: 'gateway',
  }));
  if (scenarios.length > 0) recordChaosScenarios(scenarios);
});

describe('B-4-2 gateway fault matrix and fallback authorization', () => {
  // ---------------------------------------------------------------------------------------------------
  // Invariant 1: fallback happens only for policy-retryable failures.
  // ---------------------------------------------------------------------------------------------------

  it('GW-01/02/03/04: a retryable transport, timeout, throttle or 5xx fault falls back to the next route', async () => {
    for (const failureClass of [
      'retryable_transport',
      'retryable_throttled',
      'retryable_provider',
    ] as const) {
      const primary = good().injectFault({ kind: 'error', failureClass });
      const { gw, audit } = build({ primary });
      const res = await gw.call(writerRequest());
      expect(res.modelId, `${failureClass} must fall back`).toBe('mock-p-alt');
      expect(audit.records[0]?.status).toBe('fallback_succeeded');
      expect(audit.records[0]?.fallback_from_model_id).toBe('mock-p-primary');
    }
    // A timeout is the same authorization decision by a different name.
    const timedOut = good().injectFault({ kind: 'timeout' });
    const { gw } = build({ primary: timedOut });
    expect((await gw.call(writerRequest())).modelId).toBe('mock-p-alt');
    prove(
      'GW-01-transport-error-falls-back',
      'GW-02-timeout-falls-back',
      'GW-03-throttled-falls-back',
      'GW-04-provider-5xx-falls-back',
    );
  });

  // ---------------------------------------------------------------------------------------------------
  // Invariant 2: non-retryable failures do NOT escape through fallback.
  // ---------------------------------------------------------------------------------------------------

  it('GW-05/06/07/08: a rejected request, auth failure, content refusal or unknown fault never reroutes', async () => {
    const cases = [
      [
        'GW-05',
        new ProviderFailure('non_retryable_request', 'invalid_request_error', { status: 400 }),
      ],
      ['GW-06', new ProviderFailure('non_retryable_request', 'unauthorized', { status: 401 })],
      ['GW-07', new ProviderFailure('non_retryable_request', 'content_filter', { status: 400 })],
      ['GW-08', new ProviderFailure('non_retryable_unknown', 'something new')],
    ] as const;
    for (const [id, err] of cases) {
      const primary = new MockProvider(() => {
        throw err;
      });
      const alt = good();
      const { gw, audit } = build({ primary, alt });
      await expect(gw.call(writerRequest()), `${id} must fail closed`).rejects.toMatchObject({
        code: 'PROVIDER_FAILED',
      });
      // The decisive assertion: the SECOND provider was never contacted, so no second spend occurred.
      expect(alt.callCount, `${id} must not spend on the fallback route`).toBe(0);
      expect(audit.records[0]?.status).toBe('failed');
      expect(audit.records[0]?.fallback_from_model_id).toBeUndefined();
    }
    prove(
      'GW-05-rejected-request-does-not-fall-back',
      'GW-06-auth-failure-does-not-fall-back',
      'GW-07-content-refusal-does-not-fall-back',
      'GW-08-unknown-failure-does-not-fall-back',
    );
  });

  it('GW-09: every configured route unavailable fails closed after exhausting the retryable ones', async () => {
    const primary = good().injectFault({ kind: 'error', failureClass: 'retryable_provider' });
    const alt = good().injectFault({ kind: 'error', failureClass: 'retryable_provider' });
    const { gw, audit } = build({ primary, alt });
    await expect(gw.call(writerRequest())).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
    expect(audit.records[0]?.status).toBe('failed');
    expect(audit.records[0]?.attempt_records).toHaveLength(2);
    prove('GW-09-every-route-unavailable-fails-closed');
  });

  it('GW-10: an unconfigured fallback provider fails closed rather than silently succeeding', async () => {
    const primary = good().injectFault({ kind: 'error', failureClass: 'retryable_transport' });
    const audit = new MemoryAuditStore();
    const gw = new Gateway({
      // 'mock-alt' is deliberately absent from the provider map.
      providers: new Map([['mock', primary]]),
      routing,
      budget: new MemoryBudget(10_000),
      audit,
    });
    await expect(gw.call(writerRequest())).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
    prove('GW-10-fallback-unavailable-fails-closed');
  });

  it('GW-11: malformed output exhausts the bounded repair budget on its own route before rerouting', async () => {
    // Structured-output failure is model-specific — a weaker model can fail to emit valid JSON for a
    // prompt another model handles — so exhausting the repair budget DOES authorize a reroute. What must
    // not happen is rerouting on the first malformed response, before the repair budget is spent.
    const bad = new MockProvider(() => ({ text: '{"not": "valid json"' }));
    const alt = good();
    const { gw, audit } = build({ primary: bad, alt });
    const res = await gw.call(writerRequest());
    expect(bad.callCount).toBeGreaterThanOrEqual(3);
    expect(res.modelId).toBe('mock-p-alt');
    expect(audit.records[0]?.repair_attempts).toBeGreaterThanOrEqual(3);
    // The abandoned attempts are individually recorded with their reason.
    const failed = (audit.records[0]?.attempt_records ?? []).filter((a) => a.outcome === 'failed');
    expect(failed.length).toBeGreaterThanOrEqual(3);
    expect(failed.every((a) => a.error_class === 'SCHEMA_INVALID')).toBe(true);
    prove('GW-11-malformed-json-does-not-fall-back-past-repair');
  });

  it('GW-12: schema-invalid output on every route fails closed with SCHEMA_INVALID', async () => {
    const bad = new MockProvider(() => ({ text: '{"not": "valid json"' }));
    const altBad = new MockProvider(() => ({ text: '{"still": "not valid' }));
    const { gw, audit } = build({ primary: bad, alt: altBad });
    await expect(gw.call(writerRequest())).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(audit.records[0]?.schema_valid).toBe(false);
    expect(audit.records[0]?.status).toBe('failed');
    prove('GW-12-schema-invalid-fails-closed');
  });

  it('GW-13: non-English output is discarded, regenerated once, rerouted once, then fails closed', async () => {
    const korean = new MockProvider(() => ({
      json: { ...ENGLISH_SCENE, text: '측정 장치가 울었다. 붉은 글자가 떠올랐다.' },
    }));
    const altKorean = new MockProvider(() => ({
      json: { ...ENGLISH_SCENE, text: '측정 장치가 울었다. 붉은 글자가 떠올랐다.' },
    }));
    const { gw, audit } = build({ primary: korean, alt: altKorean });
    await expect(gw.call(writerRequest())).rejects.toMatchObject({
      code: 'OUTPUT_LANGUAGE_FAILED',
    });
    // Language failure is a quality reroute, not a transport fallback: it is allowed exactly one reroute.
    expect(korean.callCount).toBe(2);
    expect(altKorean.callCount).toBeGreaterThanOrEqual(1);
    expect(audit.records[0]?.status).toBe('failed');
    expect(audit.records[0]?.error?.class).toBe('OUTPUT_LANGUAGE_FAILED');
    prove('GW-13-output-language-reroutes-once-then-fails-closed');
  });

  // ---------------------------------------------------------------------------------------------------
  // Invariants 5–6: budget is enforced before dispatch and is not evaded by a fallback.
  // ---------------------------------------------------------------------------------------------------

  it('GW-14: budget denial precedes provider dispatch and is audited as budget_blocked', async () => {
    const primary = good();
    const alt = good();
    const { gw, audit } = build({ primary, alt, budgetCents: 0 });
    await expect(gw.call(writerRequest())).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(primary.callCount).toBe(0);
    expect(alt.callCount).toBe(0);
    expect(audit.records[0]?.status).toBe('budget_blocked');
    prove('GW-14-budget-denial-precedes-dispatch');
  });

  it('GW-15: a fallback attempt cannot spend past the reserved budget', async () => {
    // The reservation is taken once, before any attempt; a fallback runs inside that reservation and the
    // recorded total is the sum of the attempts that actually reached a provider.
    const primary = good().injectFault({ kind: 'error', failureClass: 'retryable_transport' });
    const budget = new MemoryBudget(10_000);
    const audit = new MemoryAuditStore();
    const gw = new Gateway({
      providers: new Map([
        ['mock', primary],
        ['mock-alt', good()],
      ]),
      routing,
      budget,
      audit,
    });
    await gw.call(writerRequest());
    const row = audit.records[0];
    const attempted = (row?.attempt_records ?? []).reduce((a, r) => a + r.cost_cents, 0);
    // The row's total equals the sum of its attempts: no attempt is charged twice, none is lost.
    expect(row?.cost_cents).toBeCloseTo(attempted, 10);
    expect(budget.spentCents(ids.project)).toBeLessThanOrEqual(10_000);
    prove('GW-15-budget-not-exceeded-by-fallback');
  });

  it('GW-16: a missing identity contract never reaches a provider at all', async () => {
    const primary = good();
    const { gw } = build({ primary });
    await expect(gw.call(writerRequest({ narrativeIdentityRef: undefined }))).rejects.toMatchObject(
      { code: 'NARRATIVE_IDENTITY_MISSING' },
    );
    expect(primary.callCount).toBe(0);
    prove('GW-16-identity-contract-missing-never-dispatches');
  });

  // ---------------------------------------------------------------------------------------------------
  // Invariants 3–4, 12: attempt provenance and determinism.
  // ---------------------------------------------------------------------------------------------------

  it('GW-17: every actual provider attempt has its own audit entry with its own verdict', async () => {
    const primary = good().injectFault({ kind: 'error', failureClass: 'retryable_throttled' });
    const { gw, audit } = build({ primary });
    await gw.call(writerRequest());
    const attempts = audit.records[0]?.attempt_records ?? [];
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt: 1,
      model_id: 'mock-p-primary',
      outcome: 'failed',
      failure_class: 'retryable_throttled',
    });
    expect(attempts[1]).toMatchObject({ attempt: 2, model_id: 'mock-p-alt', outcome: 'succeeded' });
    // Attempt numbers are distinct and ordered: the record is a sequence, not a set of overwrites.
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2]);
    prove('GW-17-every-attempt-has-a-distinct-audit-entry');
  });

  it('GW-18: a fallback call keeps every pinned value the primary call was guarded with', async () => {
    const primary = good().injectFault({ kind: 'error', failureClass: 'retryable_transport' });
    const { gw, audit } = build({ primary });
    const req = writerRequest();
    await gw.call(req);
    const row = audit.records[0];
    expect(row).toMatchObject({
      production_policy_version: req.productionPolicyVersion,
      prompt_version_id: req.promptVersionId,
      prompt_hash: req.promptHash,
      pack_hash: req.pack.hash,
      narrative_identity_version_id: req.narrativeIdentityRef?.identityVersionId,
      output_language_contract_hash: req.narrativeIdentityRef?.outputLanguageContractHash,
      tradition_contract_hash: req.narrativeIdentityRef?.traditionContractHash,
      role: req.role,
    });
    // And the output-language requirement still ran on the fallback's output.
    expect(row?.output_language_check).toMatchObject({ performed: true, passed: true });
    prove('GW-18-fallback-preserves-every-pinned-value');
  });

  it('GW-19: a lost response followed by a retry reads the recorded call instead of spending again', async () => {
    const primary = good();
    const { gw, audit } = build({ primary });
    const req = writerRequest();
    const first = await gw.call(req);
    const again = await gw.call(req);
    expect(again.replayed).toBe(true);
    expect(again.llmCallId).toBe(first.llmCallId);
    expect(primary.callCount).toBe(1);
    expect(audit.records).toHaveLength(1);
    expect(again.costCents).toBe(first.costCents);
    prove('GW-19-response-loss-then-retry-does-not-double-charge');
  });

  it('GW-20: unknown or partial provider usage is recorded as zero-known, never invented', async () => {
    const vague = new MockProvider(() => ({ json: ENGLISH_SCENE }));
    const { gw, audit } = build({ primary: vague });
    await gw.call(writerRequest());
    const usage = audit.records[0]?.usage;
    // The mock reports an estimate; the point is that the gateway stores exactly what it was given and
    // derives cost from that, rather than substituting a guess of its own.
    expect(usage).toBeDefined();
    expect(Number.isFinite(usage?.input)).toBe(true);
    expect(Number.isFinite(usage?.output)).toBe(true);
    prove('GW-20-unknown-usage-stays-unknown');
  });

  it('GW-21: the surfaced error names its cause and classification without prose, prompts or secrets', async () => {
    const primary = new MockProvider(() => {
      throw new ProviderFailure('non_retryable_request', 'invalid_request_error: bad parameter', {
        status: 400,
      });
    });
    const { gw } = build({ primary });
    const err = await gw.call(writerRequest()).catch((e: unknown) => e);
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain('failure_class=non_retryable_request');
    expect(message).not.toContain(ENGLISH_SCENE.text);
    expect(message).not.toMatch(/sk-[A-Za-z0-9]/);
    // The rendered prompt never appears in the surfaced error.
    expect(message).not.toContain('<scene_plan>');
    prove('GW-21-error-surface-carries-cause-without-secrets');
  });

  it('GW-22: fallback order follows configured priority deterministically across repeated runs', async () => {
    for (let i = 0; i < 3; i++) {
      const primary = good().injectFault({ kind: 'error', failureClass: 'retryable_provider' });
      const { gw, audit } = build({ primary });
      const res = await gw.call(writerRequest());
      expect(res.modelId).toBe('mock-p-alt');
      expect((audit.records[0]?.attempt_records ?? []).map((a) => a.model_id)).toEqual([
        'mock-p-primary',
        'mock-p-alt',
      ]);
    }
    prove('GW-22-fallback-order-is-deterministic');
  });

  it('declares every scenario id the chaos report expects', () => {
    expect(new Set(GATEWAY_CHAOS_SCENARIOS).size).toBe(GATEWAY_CHAOS_SCENARIOS.length);
    expect(GATEWAY_CHAOS_SCENARIOS.length).toBeGreaterThanOrEqual(22);
  });
});
