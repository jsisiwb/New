import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { asUuid } from '@yeonjae/domain';
import { isRetryable, ProviderFailure } from './failures.js';
import { Gateway, MemoryAuditStore, MemoryBudget } from './gateway.js';
import { DEFAULT_PARAMS } from './mock-provider.js';
import { DEFAULT_NOTION_MODEL, NotionProvider } from './notion-provider.js';
import { notionRouting, providerModeFromEnv, resolveProvidersFromEnv } from './provider-mode.js';
import { type GatewayRequest, type ProviderRequest } from './types.js';

/** A stand-in Notion bridge: answers `/notion/v1/complete` from a queue of texts. */
class FakeBridge {
  readonly seen: { path: string; auth: string | undefined; modelId: string }[] = [];
  private server: Server | undefined;
  constructor(private readonly texts: string[]) {}

  async start(): Promise<string> {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { modelId: string };
        this.seen.push({
          path: req.url ?? '',
          auth: req.headers.authorization,
          modelId: body.modelId,
        });
        const text = this.texts.shift() ?? '';
        const payload = JSON.stringify({
          modelId: body.modelId,
          provider: 'notion',
          text,
          finishReason: 'stop',
          usage: { input: 10, output: text.length },
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payload);
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${String(port)}/notion/v1/complete`;
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

const request: ProviderRequest = {
  modelId: DEFAULT_NOTION_MODEL,
  system: '시스템',
  user: '사용자',
  params: DEFAULT_PARAMS,
  trace: { role: 'requirement_interpreter', activityId: 'a1', idempotencyKey: 'k1' },
};

describe('NotionProvider', () => {
  let bridge: FakeBridge;
  let url: string;

  afterEach(async () => {
    await bridge.close();
  });

  describe('with a bridge that answers once empty, then with text', () => {
    beforeEach(async () => {
      bridge = new FakeBridge(['  \n\n', '{"ok": true}']);
      url = await bridge.start();
    });

    it('classifies an empty completion as a retryable provider failure', async () => {
      const provider = new NotionProvider({ baseUrl: url, token: 't0ken' });
      const err = await provider.complete(request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderFailure);
      expect(isRetryable((err as ProviderFailure).failureClass)).toBe(true);
      const ok = await provider.complete(request);
      expect(ok.text).toBe('{"ok": true}');
      // The path prefix is preserved and the bearer token is sent.
      expect(bridge.seen.map((s) => s.path)).toEqual([
        '/notion/v1/complete',
        '/notion/v1/complete',
      ]);
      expect(bridge.seen[0]?.auth).toBe('Bearer t0ken');
    });

    it('falls through to the next route inside the gateway when a route answers empty', async () => {
      const resolved = resolveProvidersFromEnv({
        YEONJAE_PROVIDER_MODE: 'notion',
        YEONJAE_NOTION_URL: url,
        YEONJAE_NOTION_TOKEN: 't0ken',
      });
      const audit = new MemoryAuditStore();
      const gateway = new Gateway({
        providers: resolved.providers(),
        routing: resolved.routing,
        budget: new MemoryBudget(10_000),
        audit,
      });
      const req: GatewayRequest = {
        workspaceId: asUuid('0190a000-0000-7000-8000-000000000001'),
        projectId: asUuid('0190a000-0000-7000-8000-000000000002'),
        jobId: asUuid('0190a000-0000-7000-8000-000000000003'),
        activityId: 'notion-fallback',
        idempotencyKey: 'notion-fallback:1',
        role: 'requirement_interpreter',
        styleSensitive: false,
        manuscriptProducing: false,
        promptVersionId: asUuid('0190a000-0000-7000-8000-000000000004'),
        promptHash: 'sha256:test',
        productionPolicyVersion: 'policy/standard@1',
        pack: {
          id: asUuid('0190a000-0000-7000-8000-000000000005'),
          hash: 'sha256:pack',
          renderedSystem: '시스템',
          renderedUser: '사용자',
          tokenEstimate: 10,
        },
        outputMode: 'json',
        modelClass: 'R',
      };
      const res = await gateway.call(req);
      expect(res.output.json).toEqual({ ok: true });
      expect(bridge.seen).toHaveLength(2);
      const record = audit.records.at(-1);
      expect(record?.attempt_records?.map((a) => a.outcome)).toEqual(['failed', 'succeeded']);
    });
  });
});

describe('notion provider mode', () => {
  it('is an explicit mode', () => {
    expect(providerModeFromEnv({ YEONJAE_PROVIDER_MODE: 'notion' })).toBe('notion');
  });

  it('refuses to start without a bridge URL or with a bad timeout', () => {
    expect(() => resolveProvidersFromEnv({ YEONJAE_PROVIDER_MODE: 'notion' })).toThrow(
      /YEONJAE_NOTION_URL/,
    );
    expect(() =>
      resolveProvidersFromEnv({
        YEONJAE_PROVIDER_MODE: 'notion',
        YEONJAE_NOTION_URL: 'https://bridge.example/notion/v1/complete',
        YEONJAE_NOTION_TIMEOUT_MS: 'soon',
      }),
    ).toThrow(/YEONJAE_NOTION_TIMEOUT_MS/);
  });

  it('routes every class to the pooled model with two same-model fallback routes by default', () => {
    const routing = notionRouting({});
    for (const cls of ['R', 'P', 'M', 'C'] as const) {
      expect(routing[cls].map((r) => [r.modelId, r.priority])).toEqual([
        ['notion-ai', 1],
        ['notion-ai', 2],
        ['notion-ai', 3],
      ]);
      expect(routing[cls].every((r) => r.provider === 'notion')).toBe(true);
    }
    expect(routing.E).toEqual([]);
  });

  it('honours per-class models and explicit fallback models', () => {
    const routing = notionRouting({
      YEONJAE_NOTION_MODEL: 'notion-ai-1',
      YEONJAE_MODEL_P: 'notion-ai-2',
      YEONJAE_NOTION_FALLBACK_MODELS: 'notion-ai-2, notion-ai-1',
    });
    expect(routing.R.map((r) => r.modelId)).toEqual(['notion-ai-1', 'notion-ai-2', 'notion-ai-1']);
    expect(routing.P.map((r) => r.modelId)).toEqual(['notion-ai-2', 'notion-ai-2', 'notion-ai-1']);
  });
});
