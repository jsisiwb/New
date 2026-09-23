/**
 * Notion AI bridge provider (ADR-0056).
 *
 * The operator's Notion bridge speaks the same `/v1/complete` wire protocol as the Genspark bridge
 * (`HttpProvider`), usually behind a path-prefixed HTTPS endpoint (`https://host/notion/v1/complete`)
 * with a bearer token, and pools several Notion workspaces behind one model id (`notion-ai`).
 *
 * One bridge behaviour must not pass through as success: a workspace can answer HTTP 200 with
 * `finishReason: "stop"` and an EMPTY completion. Treated as success, an empty prose draft would fail a
 * later schema or length gate far from its cause; treated as a JSON repair it would burn the bounded
 * repair budget on a transport fault. It is therefore a `retryable_provider` failure here, so the gateway
 * falls through to the next route — which, on a round-robin pool, lands on another workspace.
 */
import { ProviderFailure } from './failures.js';
import { HttpProvider } from './http-provider.js';
import { type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

export const DEFAULT_NOTION_MODEL = 'notion-ai';
export const DEFAULT_NOTION_TIMEOUT_MS = 600_000;

export interface NotionProviderOptions {
  readonly name?: string | undefined;
  /** Bridge endpoint, e.g. `https://host/notion/v1/complete` (the path prefix is preserved). */
  readonly baseUrl: string;
  /** Bearer token for the bridge. Sent as `authorization`; never logged. */
  readonly token?: string | undefined;
  /** Whole-request deadline in milliseconds. Default 600 s: bible-stage calls are long. */
  readonly timeoutMs?: number | undefined;
  /** Hard ceiling on a response body. Default 4 MiB. */
  readonly maxResponseBytes?: number | undefined;
  /** Allow a non-loopback endpoint. An explicitly configured bridge URL is deliberate operator config. */
  readonly allowNonLoopback?: boolean | undefined;
}

export class NotionProvider implements Provider {
  readonly name: string;
  private readonly adapter: HttpProvider;

  constructor(opts: NotionProviderOptions) {
    this.name = opts.name ?? 'notion';
    this.adapter = new HttpProvider({
      name: this.name,
      baseUrl: opts.baseUrl,
      ...(opts.token ? { headers: { authorization: `Bearer ${opts.token}` } } : {}),
      maxResponseBytes: opts.maxResponseBytes ?? 4 * 1024 * 1024,
      timeoutMs: opts.timeoutMs ?? DEFAULT_NOTION_TIMEOUT_MS,
      ...(opts.allowNonLoopback !== undefined ? { allowNonLoopback: opts.allowNonLoopback } : {}),
    });
  }

  async complete(
    req: ProviderRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse & { readonly usageReported: boolean }> {
    const res = await this.adapter.complete(req, signal);
    const empty = (res.text === undefined || res.text.trim() === '') && res.json === undefined;
    if (empty && res.finishReason !== 'content_filter')
      throw new ProviderFailure(
        'retryable_provider',
        `provider ${this.name} returned an empty completion`,
        {
          ...(res.providerRequestId ? { providerRequestId: res.providerRequestId } : {}),
          possiblyCompleted: true,
        },
      );
    return res;
  }
}
