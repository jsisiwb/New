/**
 * P4 (ADR-0072): the per-class capability matrix comes from the active prompt set, the routing check
 * reports what each provider mode lacks, and the probe classifies each class's primary route. Fakes only:
 * no provider is contacted and no credential is read (the API key below is a placeholder string).
 */
import { describe, expect, it } from 'vitest';
import { PromptRegistry } from '@yeonjae/prompts';
import {
  checkRouting,
  probeRouting,
  renderRoutingCheck,
  requirementsFromPrompts,
} from './capabilities.js';
import { ProviderFailure } from './failures.js';
import { liveGatewayFromEnv } from './live-config.js';
import { notionRouting } from './provider-mode.js';
import { type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

const registry = PromptRegistry.fromDirectory();
const active = Object.values(registry.activeSet().mapping).map((id) => registry.get(id));
const requirements = requirementsFromPrompts(active);

describe('capability matrix (ADR-0072)', () => {
  it('derives each class’s needs from the active prompts', () => {
    const byClass = Object.fromEntries(requirements.map((r) => [r.model_class, r]));
    expect(byClass.P?.families).toContain('scene_writer');
    expect(byClass.R?.families).toContain('character_designer');
    expect(byClass.M?.families).toContain('prose_judge');
    expect(byClass.C?.families).toContain('voice_judge');
    expect(byClass.R?.needs_json).toBe(true);
    expect(byClass.M?.needs_json).toBe(true);
    // The bible's largest design output sets R's output budget.
    expect(byClass.R?.max_output_tokens).toBeGreaterThanOrEqual(7_000);
    expect(byClass.R?.min_context_tokens).toBeGreaterThan(byClass.P?.min_context_tokens ?? 0);
  });

  it('reports notion mode’s single pooled model as a known limitation, not an error', () => {
    const check = checkRouting('notion', notionRouting({}), requirements);
    expect(check.ok).toBe(true);
    expect(check.findings.map((f) => f.code)).toEqual(['SINGLE_POOLED_MODEL']);
    expect(check.classes.every((c) => c.routes === 3)).toBe(true);
    const text = renderRoutingCheck(check);
    expect(text).toContain('judges share the writer’s model');
    // No model id is rendered: in notion mode it is operator configuration.
    expect(text).not.toContain('notion-ai');
  });

  it('checks live per-class routing: judge on the writer’s model, no fallback, small context', () => {
    const env = {
      YEONJAE_LIVE_API_KEY: 'placeholder-not-a-key',
      YEONJAE_MODEL_DEFAULT: 'model-default',
      YEONJAE_MODEL_R: 'model-planner',
      YEONJAE_LIVE_MAX_CONTEXT_TOKENS: '16000',
    };
    const { routing } = liveGatewayFromEnv(env);
    const check = checkRouting('live', routing, requirements);
    const codes = check.findings.map((f) => `${f.code}:${f.model_class}`);
    expect(codes).toContain('JUDGE_SHARES_WRITER_MODEL:M');
    expect(codes).toContain('NO_FALLBACK_ROUTE:P');
    expect(codes).toContain('CONTEXT_TOO_SMALL:R');
    expect(check.ok).toBe(false);
  });

  it('passes a live configuration with per-class models, a fallback provider and enough context', () => {
    const env = {
      YEONJAE_LIVE_API_KEY: 'placeholder-not-a-key',
      YEONJAE_MODEL_R: 'model-planner',
      YEONJAE_MODEL_P: 'model-writer',
      YEONJAE_MODEL_M: 'model-judge',
      YEONJAE_MODEL_C: 'model-checker',
      YEONJAE_LIVE_FALLBACK_PROVIDER: 'anthropic',
      YEONJAE_LIVE_FALLBACK_API_KEY: 'placeholder-not-a-key',
      YEONJAE_FALLBACK_MODEL_DEFAULT: 'model-fallback',
    };
    const { routing } = liveGatewayFromEnv(env);
    const check = checkRouting('live', routing, requirements);
    expect(check.findings).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('probes each class’s primary route and classifies failures without returning the reply', async () => {
    const fake = (outcome: (req: ProviderRequest) => ProviderResponse): Provider => ({
      name: 'fake',
      complete: async (req) => outcome(req),
    });
    const ok = (req: ProviderRequest): ProviderResponse => ({
      modelId: req.modelId,
      provider: 'fake',
      text: 'ok',
      finishReason: 'stop',
      usage: { input: 1, output: 1, cached: 0 },
      latencyMs: 1,
    });
    const routing = notionRouting({});
    const providers = new Map<string, Provider>([
      [
        'notion',
        fake((req) => {
          if (req.modelId === 'notion-ai' && req.user === 'ok' && probeCount++ === 1)
            throw new ProviderFailure('retryable_provider', 'HTTP 502', { status: 502 });
          return ok(req);
        }),
      ],
    ]);
    let probeCount = 0;
    let t = 0;
    const results = await probeRouting(providers, routing, { now: () => (t += 5) });
    expect(results.map((r) => [r.model_class, r.ok, r.failure_class ?? null])).toEqual([
      ['R', true, null],
      ['P', false, 'retryable_provider'],
      ['M', true, null],
      ['C', true, null],
    ]);
    expect(results.every((r) => !('text' in r))).toBe(true);
  });
});
