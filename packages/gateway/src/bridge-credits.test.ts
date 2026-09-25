/** Bridge credit readings and the deep probe's labels (ADR-0080): numbers and labels only, no names. */
import { describe, expect, it } from 'vitest';
import {
  bridgeHealthUrl,
  creditDelta,
  parseBridgeHealth,
  renderBridgeCredits,
} from './bridge-credits.js';
import { deepProbe, modelFamilyOf } from './deep-probe.js';
import { type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

const health = (a: number, b: number) => ({
  status: 'ok',
  workspaces: [
    {
      index: 1,
      name: 'A private workspace name',
      space_id: 'secret-space',
      rate_limited: false,
      completed_requests: 10,
      failed_requests: 1,
      rate_limits: {
        window: { window: '6h', used: 0.5, limit: 100 },
        billingPeriodWindow: { used: a, limit: 100 },
      },
    },
    {
      index: 2,
      rate_limited: true,
      completed_requests: 4,
      failed_requests: 0,
      rate_limits: {
        window: { window: '6h', used: 1 },
        billingPeriodWindow: { used: b, limit: 100 },
      },
    },
  ],
});

describe('bridge credits (ADR-0080)', () => {
  it('keeps numbers and drops names and ids', () => {
    const c = parseBridgeHealth(health(66.2, 76.76), new Date('2026-09-24T00:00:00Z'));
    expect(c.workspaces).toEqual([
      {
        index: 1,
        billing_used: 66.2,
        billing_limit: 100,
        window_used: 0.5,
        window: '6h',
        completed_requests: 10,
        failed_requests: 1,
        rate_limited: false,
      },
      {
        index: 2,
        billing_used: 76.76,
        billing_limit: 100,
        window_used: 1,
        window: '6h',
        completed_requests: 4,
        failed_requests: 0,
        rate_limited: true,
      },
    ]);
    const text = renderBridgeCredits(c);
    expect(text).not.toMatch(/private|secret/);
    expect(text).toContain('ws1 billing 66.2%');
    expect(parseBridgeHealth({ nope: 1 }).workspaces).toEqual([]);
  });

  it('derives the health URL from a path-prefixed endpoint and the spend between two readings', () => {
    expect(bridgeHealthUrl('https://h.example/notion/v1/complete')).toBe(
      'https://h.example/notion/health',
    );
    expect(bridgeHealthUrl('https://h.example/notion/')).toBe('https://h.example/notion/health');
    const d = creditDelta(
      parseBridgeHealth(health(66.2, 76.76)),
      parseBridgeHealth(health(67.5, 78)),
    );
    expect(d.per_workspace).toEqual([
      { index: 1, points: 1.3 },
      { index: 2, points: 1.24 },
    ]);
    expect(d.total).toBe(2.54);
  });
});

class Fake implements Provider {
  readonly name = 'fake';
  constructor(private readonly replies: string[]) {}
  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    return {
      modelId: req.modelId,
      provider: this.name,
      text: this.replies.shift() ?? '',
      finishReason: 'stop',
      usage: { input: 1, output: 1, cached: 0 },
      latencyMs: 1,
    };
  }
}

describe('deep probe (ADR-0080)', () => {
  it('names the family a reply claims', () => {
    expect(modelFamilyOf('Google Gemini')).toBe('gemini');
    expect(modelFamilyOf('저는 클로드입니다')).toBe('claude');
    expect(modelFamilyOf('GPT-5')).toBe('gpt');
    expect(modelFamilyOf('잘 모르겠습니다')).toBe('other');
    expect(modelFamilyOf('')).toBe('none');
  });

  it('measures fencing and truncation without returning reply text', async () => {
    const long = `[${Array.from({ length: 1500 }, (_, i) => String(i + 1)).join(', ')}]`;
    const route = {
      modelId: 'm',
      provider: 'fake',
      priority: 1,
      family: 'x',
      priceInPerMTokCents: 0,
      priceOutPerMTokCents: 0,
      maxContextTokens: 1,
      supportsJsonSchema: false,
    };
    const ok = await deepProbe(
      new Fake(['Google Gemini', '```json\n{"숫자": 7}\n```', long]),
      route,
    );
    expect(ok.identity.family).toBe('gemini');
    expect(ok.json).toMatchObject({
      fenced: true,
      clean: false,
      recovered_by: 'json_fence_stripped',
    });
    expect(ok.long).toMatchObject({ returned_items: 1500, complete: true, truncated_json: false });
    expect(JSON.stringify(ok)).not.toContain('Google');
    const cut = await deepProbe(new Fake(['x', '{"숫자": 7}', long.slice(0, 900)]), route);
    expect(cut.json).toMatchObject({ clean: true, recovered_by: 'none' });
    expect(cut.long).toMatchObject({ returned_items: null, complete: false, truncated_json: true });
  });
});
