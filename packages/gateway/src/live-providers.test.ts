import { describe, expect, it } from 'vitest';
import { isCancellationError } from './cancellation.js';
import { ProviderFailure } from './failures.js';
import { liveConfigured, liveGatewayFromEnv, LiveConfigError } from './live-config.js';
import { AnthropicProvider, OpenAiCompatibleProvider } from './live-providers.js';
import { DEFAULT_PARAMS } from './mock-provider.js';
import { type ProviderRequest } from './types.js';

const REQ: ProviderRequest = {
  modelId: 'test-model',
  system: 'Return JSON.',
  user: 'Say hello.',
  params: { ...DEFAULT_PARAMS, max_tokens: 64 },
  outputSchema: { $ref: 'concept.schema.json' },
  trace: { role: 'concept_generator', activityId: 'a', idempotencyKey: 'k' },
};

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  const raw = init?.body;
  if (typeof raw !== 'string') throw new Error('expected a string request body');
  return JSON.parse(raw) as Record<string, unknown>;
}

function fetchReturning(
  status: number,
  body: unknown,
  capture?: (init: RequestInit, url: string) => void,
): typeof fetch {
  return async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(
      init ?? {},
      url instanceof URL ? url.toString() : typeof url === 'string' ? url : url.url,
    );
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('OpenAiCompatibleProvider', () => {
  it('sends a chat completion with JSON mode and parses text, finish reason and usage', async () => {
    let seen: { init: RequestInit; url: string } | undefined;
    const provider = new OpenAiCompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchReturning(
        200,
        {
          id: 'chatcmpl-1',
          model: 'test-model-2025',
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        },
        (init, url) => {
          seen = { init, url };
        },
      ),
    });
    const res = await provider.complete(REQ);
    expect(seen?.url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    const body = bodyOf(seen?.init);
    expect(body.model).toBe('test-model');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.max_tokens).toBe(64);
    expect(res.text).toBe('{"ok":true}');
    expect(res.finishReason).toBe('stop');
    expect(res.usage).toEqual({ input: 12, output: 3, cached: 0 });
    expect(res.usageReported).toBe(true);
    expect(res.modelId).toBe('test-model-2025');
    expect(res.providerRequestId).toBe('chatcmpl-1');
    // The key never lands on the instance.
    expect(JSON.stringify(provider)).not.toContain('sk-test');
  });

  it('maps length and reports missing usage as unknown rather than zero', async () => {
    const provider = new OpenAiCompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchReturning(200, {
        choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
      }),
    });
    const res = await provider.complete(REQ);
    expect(res.finishReason).toBe('length');
    expect(res.usageReported).toBe(false);
  });

  it('classifies HTTP failures without quoting the provider body', async () => {
    const provider = new OpenAiCompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchReturning(429, { error: { message: 'secret echo sk-test' } }),
    });
    const err = await provider.complete(REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderFailure);
    expect((err as ProviderFailure).failureClass).toBe('retryable_throttled');
    expect((err as Error).message).not.toContain('secret');
    const bad = new OpenAiCompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchReturning(401, {}),
    });
    const e2 = await bad.complete(REQ).catch((e: unknown) => e);
    expect((e2 as ProviderFailure).failureClass).toBe('non_retryable_request');
  });

  it('treats a caller abort as cancellation, not a transport fault', async () => {
    const controller = new AbortController();
    const provider = new OpenAiCompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchImpl: (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    });
    const pending = provider.complete(REQ, controller.signal);
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(isCancellationError(err)).toBe(true);
  });

  it('refuses plaintext http to a non-loopback host', () => {
    expect(
      () =>
        new OpenAiCompatibleProvider({
          name: 'x',
          baseUrl: 'http://example.com/v1',
          apiKey: 'k',
        }),
    ).toThrow(/plaintext/);
  });
});

describe('AnthropicProvider', () => {
  it('sends a messages request and parses content blocks, stop reason and usage', async () => {
    let seen: { init: RequestInit; url: string } | undefined;
    const provider = new AnthropicProvider({
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'ak-test',
      fetchImpl: fetchReturning(
        200,
        {
          id: 'msg_1',
          model: 'claude-x',
          content: [{ type: 'text', text: '{"a":1}' }],
          stop_reason: 'max_tokens',
          usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 2 },
        },
        (init, url) => {
          seen = { init, url };
        },
      ),
    });
    const res = await provider.complete(REQ);
    expect(seen?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = seen?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('ak-test');
    expect(headers['anthropic-version']).toBeTruthy();
    const body = bodyOf(seen?.init);
    expect(body.system).toBe('Return JSON.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hello.' }]);
    expect(res.text).toBe('{"a":1}');
    expect(res.finishReason).toBe('length');
    expect(res.usage).toEqual({ input: 5, output: 7, cached: 2 });
  });
});

describe('liveGatewayFromEnv', () => {
  it('builds a primary + fallback routing table from names only', () => {
    const env = {
      YEONJAE_LIVE_PROVIDER: 'anthropic',
      YEONJAE_LIVE_API_KEY: 'ak',
      YEONJAE_MODEL_DEFAULT: 'claude-sonnet',
      YEONJAE_MODEL_R: 'claude-opus',
      YEONJAE_LIVE_PRICE_IN_CENTS_PER_MTOK: '300',
      YEONJAE_LIVE_PRICE_OUT_CENTS_PER_MTOK: '1500',
      YEONJAE_LIVE_FALLBACK_PROVIDER: 'openai',
      YEONJAE_LIVE_FALLBACK_API_KEY: 'sk',
      YEONJAE_LIVE_FALLBACK_BASE_URL: 'https://openrouter.ai/api/v1',
      YEONJAE_FALLBACK_MODEL_DEFAULT: 'gpt-x',
    };
    const { config, providers, routing } = liveGatewayFromEnv(env);
    expect([...providers.keys()]).toEqual(['live', 'live-fallback']);
    expect(routing.R.map((r) => r.modelId)).toEqual(['claude-opus', 'gpt-x']);
    expect(routing.P.map((r) => r.modelId)).toEqual(['claude-sonnet', 'gpt-x']);
    expect(routing.R[0]?.priceInPerMTokCents).toBe(300);
    expect(routing.E).toEqual([]);
    expect(config.fallback?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(JSON.stringify(config)).not.toContain('"ak"');
    expect(liveConfigured(env)).toBe(true);
    expect(liveConfigured({})).toBe(false);
  });

  it('names the missing variable instead of defaulting to a paid call', () => {
    expect(() => liveGatewayFromEnv({ YEONJAE_LIVE_API_KEY: 'k' })).toThrow(LiveConfigError);
    expect(() => liveGatewayFromEnv({ YEONJAE_LIVE_API_KEY: 'k' })).toThrow(/YEONJAE_MODEL_R/);
    expect(() =>
      liveGatewayFromEnv({ YEONJAE_LIVE_API_KEY: 'k', YEONJAE_LIVE_PROVIDER: 'nope' }),
    ).toThrow(/YEONJAE_LIVE_PROVIDER/);
  });

  it('declares native JSON-schema output only when configured, and only for OpenAI-compatible endpoints (ADR-0057)', () => {
    const base = { YEONJAE_LIVE_API_KEY: 'k', YEONJAE_MODEL_DEFAULT: 'm' };
    const plain = liveGatewayFromEnv(base);
    expect(plain.routing.M[0]?.nativeStructuredOutput).toBeUndefined();
    expect(plain.config.primary.structuredOutput).toBe('json_object');
    const native = liveGatewayFromEnv({ ...base, YEONJAE_LIVE_STRUCTURED_OUTPUT: 'json_schema' });
    expect(native.routing.M[0]?.nativeStructuredOutput).toBe('json_schema');
    expect(() =>
      liveGatewayFromEnv({
        ...base,
        YEONJAE_LIVE_PROVIDER: 'anthropic',
        YEONJAE_LIVE_STRUCTURED_OUTPUT: 'json_schema',
      }),
    ).toThrow(/OpenAI-compatible/);
    expect(() => liveGatewayFromEnv({ ...base, YEONJAE_LIVE_STRUCTURED_OUTPUT: 'yes' })).toThrow(
      /YEONJAE_LIVE_STRUCTURED_OUTPUT/,
    );
  });
});

describe('native structured output (ADR-0057)', () => {
  it('sends the answer schema as a non-strict json_schema response format', async () => {
    let seen: RequestInit | undefined;
    const provider = new OpenAiCompatibleProvider({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchReturning(
        200,
        { choices: [{ message: { content: '{"issues":[]}' }, finish_reason: 'stop' }] },
        (init) => {
          seen = init;
        },
      ),
    });
    const schema = {
      type: 'object',
      required: ['issues'],
      properties: { issues: { type: 'array' } },
    };
    await provider.complete({
      ...REQ,
      responseFormat: { kind: 'json_schema', name: 'continuity_checker', schema },
    });
    expect(bodyOf(seen).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'continuity_checker', schema, strict: false },
    });
  });
});
