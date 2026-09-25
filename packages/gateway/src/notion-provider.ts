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
 *
 * The empty answer has a cause the bridge cannot see: it drives Notion's agent, and the agent answers an
 * authoring request ("write this scene") by writing a page and leaving the chat reply empty. Live, every
 * Korean scene-writer call came back empty in every output format until the request was framed as a
 * stateless completion whose tools are disabled and whose chat reply is the only output; then both pooled
 * workspaces returned the scene. Every request is therefore sent inside `NOTION_COMPLETION_FRAME`. The
 * frame is transport, like a header: it names no craft rule, and the wrapped instructions are unchanged.
 */
import { ProviderFailure } from './failures.js';
import { HttpProvider } from './http-provider.js';
import { type Provider, type ProviderRequest, type ProviderResponse } from './types.js';

export const DEFAULT_NOTION_MODEL = 'notion-ai';
/** The bridge gives one Notion workspace this long to finish, then fails over to the next one once. */
export const NOTION_BRIDGE_ATTEMPT_CAP_MS = 600_000;
/**
 * Outlasts the bridge's own failover (two capped workspace attempts, observed at ~1,205 s end to end).
 * A 600 s client deadline aborted every slow call at the moment the bridge moved it to a second workspace;
 * live, a scene that failed on one workspace was returned by the other at 1,150 s.
 */
export const DEFAULT_NOTION_TIMEOUT_MS = 2 * NOTION_BRIDGE_ATTEMPT_CAP_MS + 60_000;

export const NOTION_COMPLETION_FRAME =
  'You are running as a stateless text-completion API. Tools are disabled: you cannot create, edit, ' +
  'search or open pages, and any tool call fails. Your chat reply is the only output anyone reads. ' +
  'Follow the instructions below exactly and reply with the requested output directly in the chat.';

/** The request as the bridge receives it: the prompt's system text wrapped, verbatim, in the frame. */
export function framedForNotion(req: ProviderRequest): ProviderRequest {
  return {
    ...req,
    system: `${NOTION_COMPLETION_FRAME}\n\n<instructions>\n${req.system}\n</instructions>`,
  };
}

export interface NotionProviderOptions {
  readonly name?: string | undefined;
  /** Bridge endpoint, e.g. `https://host/notion/v1/complete` (the path prefix is preserved). */
  readonly baseUrl: string;
  /** Bearer token for the bridge. Sent as `authorization`; never logged. */
  readonly token?: string | undefined;
  /** Whole-request deadline in milliseconds. Default: two bridge attempts plus a minute. */
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
    const res = await this.adapter.complete(framedForNotion(req), signal);
    const empty = (res.text === undefined || res.text.trim() === '') && res.json === undefined;
    if (empty && res.finishReason !== 'content_filter')
      throw new ProviderFailure(
        'retryable_provider',
        `provider ${this.name} returned an empty completion`,
        {
          ...(res.providerRequestId ? { providerRequestId: res.providerRequestId } : {}),
          possiblyCompleted: true,
          reason: 'empty_reply',
        },
      );
    return res;
  }
}
