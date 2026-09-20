/**
 * Live provider adapters: OpenAI-compatible chat completions and the Anthropic Messages API.
 *
 * These are the two wire protocols that cover essentially every hosted and self-hosted model an operator
 * is likely to hold a key for (OpenAI, Gemini's OpenAI-compatible endpoint, OpenRouter, Groq, DeepSeek,
 * Together, vLLM/Ollama locally; Claude directly). Both adapters keep the same discipline as
 * `HttpProvider`, because the gateway's retry, fallback and cost accounting depend on it:
 *
 *   * every failure is CLASSIFIED (`ProviderFailure`) so the gateway can decide retry/fallback by class;
 *   * a caller abort is a `CancellationError`, never a retryable transport fault (ADR-0049);
 *   * the response body is read with a byte ceiling;
 *   * usage the provider does not report stays `undefined` (`usageReported: false`), never a false zero;
 *   * the API key is held in a closure and never appears on the object, in logs or in error messages.
 *
 * JSON mode: when a request declares an output schema the gateway expects JSON. The OpenAI adapter asks
 * for `response_format: json_object` when `params.json_schema_mode` is set; Anthropic has no equivalent,
 * so the system prompt already demands JSON-only output and the gateway's fence stripping and bounded
 * repair handle the rest.
 */
import { CancellationError } from './cancellation.js';
import { ProviderFailure } from './failures.js';
import { classifyHttpStatus } from './http-provider.js';
import {
  type FinishReason,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
} from './types.js';

export type LiveProviderKind = 'openai' | 'anthropic';

export interface LiveProviderOptions {
  readonly name: string;
  /** Base URL of the API, e.g. `https://api.openai.com/v1` or `https://api.anthropic.com`. */
  readonly baseUrl: string;
  /** Read once and captured; never stored on the instance. */
  readonly apiKey: string;
  readonly maxResponseBytes?: number | undefined;
  /** Whole-request deadline. Long-form drafting needs minutes, not the transport default of 30 s. */
  readonly timeoutMs?: number | undefined;
  readonly extraHeaders?: Readonly<Record<string, string>> | undefined;
  /** Anthropic API version header. */
  readonly anthropicVersion?: string | undefined;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch | undefined;
}

export const DEFAULT_LIVE_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

type LiveResponse = ProviderResponse & { readonly usageReported: boolean };

function requireUrl(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name}: baseUrl is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`${name}: refusing protocol ${url.protocol}`);
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  // A key must not travel over plaintext to anything but a local process.
  if (url.protocol === 'http:' && !loopback)
    throw new Error(`${name}: refusing plaintext http to a non-loopback host`);
  return url;
}

function joinPath(base: URL, path: string): URL {
  const trimmed = base.pathname.replace(/\/+$/, '');
  return new URL(`${trimmed}${path}`, base.origin);
}

async function readBounded(response: Response, maxBytes: number, name: string): Promise<string> {
  const body = response.body;
  if (body === null) return '';
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: Uint8Array = chunk.value;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProviderFailure(
          'non_retryable_request',
          `provider ${name} response exceeded ${String(maxBytes)} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Shared request lifecycle: deadline + caller abort composition, status classification, bounded body,
 * and the cancellation-versus-timeout distinction. The protocol-specific parts are the body builder and
 * the response parser.
 */
async function performRequest(
  opts: LiveProviderOptions,
  url: URL,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<{ text: string; started: number }> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS;
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  if (signal?.aborted === true)
    throw new CancellationError('activity_cancelled', { remoteCancellation: 'not_requested' });
  const onAbort = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = { exceeded: false };
  const timer = setTimeout(() => {
    deadline.exceeded = true;
    controller.abort();
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers, ...(opts.extraHeaders ?? {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The body is read (bounded) only to classify; it is never quoted, because provider error text
      // can echo request content.
      await readBounded(response, 64 * 1024, opts.name).catch(() => '');
      throw new ProviderFailure(
        classifyHttpStatus(response.status),
        `provider ${opts.name} returned HTTP ${String(response.status)}`,
        { status: response.status, ...(response.status >= 500 ? { possiblyCompleted: true } : {}) },
      );
    }
    const text = await readBounded(response, maxBytes, opts.name);
    return { text, started };
  } catch (err) {
    if (err instanceof ProviderFailure || err instanceof CancellationError) throw err;
    const aborted = (err as { name?: string }).name === 'AbortError';
    if (aborted && !deadline.exceeded) throw new CancellationError('activity_cancelled');
    if (aborted)
      throw new ProviderFailure(
        'retryable_transport',
        `provider ${opts.name} exceeded ${String(timeoutMs)} ms`,
        { possiblyCompleted: true },
      );
    throw new ProviderFailure(
      'retryable_transport',
      `provider ${opts.name} transport error: ${(err as Error).name}`,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseJson(text: string, name: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new ProviderFailure(
      'retryable_transport',
      `provider ${name} returned a body that is not JSON`,
    );
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** OpenAI-compatible `/chat/completions`. */
export class OpenAiCompatibleProvider implements Provider {
  readonly name: string;
  private readonly complete_: (req: ProviderRequest, signal?: AbortSignal) => Promise<LiveResponse>;

  constructor(opts: LiveProviderOptions) {
    this.name = opts.name;
    const base = requireUrl(opts.baseUrl, opts.name);
    if (opts.apiKey.length === 0) throw new Error(`${opts.name}: apiKey is empty`);
    const url = joinPath(base, '/chat/completions');
    const authorization = `Bearer ${opts.apiKey}`;
    this.complete_ = async (req, signal) => {
      const body: Record<string, unknown> = {
        model: req.modelId,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.params.temperature,
        max_tokens: req.params.max_tokens,
        top_p: req.params.top_p,
        ...(req.outputSchema !== undefined || req.params.json_schema_mode
          ? { response_format: { type: 'json_object' } }
          : {}),
      };
      const { text, started } = await performRequest(opts, url, { authorization }, body, signal);
      const parsed = parseJson(text, opts.name);
      const choices = Array.isArray(parsed.choices) ? (parsed.choices as unknown[]) : [];
      const first = (choices[0] ?? {}) as {
        message?: { content?: unknown; refusal?: unknown };
        finish_reason?: unknown;
      };
      const content = first.message?.content;
      const outText =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((part) => {
                  const t = (part as { text?: unknown }).text;
                  return typeof t === 'string' ? t : '';
                })
                .join('')
            : undefined;
      if (typeof first.message?.refusal === 'string' && outText === undefined)
        throw new ProviderFailure(
          'non_retryable_request',
          `provider ${opts.name} refused the request`,
        );
      if (outText === undefined)
        throw new ProviderFailure(
          'retryable_provider',
          `provider ${opts.name} returned no completion content`,
        );
      const finish = mapOpenAiFinish(first.finish_reason);
      const usageRaw = (parsed.usage ?? undefined) as
        | { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: unknown }
        | undefined;
      const input = num(usageRaw?.prompt_tokens);
      const output = num(usageRaw?.completion_tokens);
      const cached = num(
        (usageRaw?.prompt_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens,
      );
      const usageReported = input !== undefined && output !== undefined;
      return {
        modelId: typeof parsed.model === 'string' ? parsed.model : req.modelId,
        provider: opts.name,
        ...(typeof parsed.id === 'string' ? { providerRequestId: parsed.id } : {}),
        text: outText,
        finishReason: finish,
        usage: usageReported
          ? { input, output, cached: cached ?? 0 }
          : { input: 0, output: 0, cached: 0 },
        usageReported,
        latencyMs: Date.now() - started,
      };
    };
  }

  complete(req: ProviderRequest, signal?: AbortSignal): Promise<LiveResponse> {
    return this.complete_(req, signal);
  }
}

function mapOpenAiFinish(reason: unknown): FinishReason {
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content_filter';
  return 'stop';
}

/** Anthropic Messages API (`/v1/messages`). */
export class AnthropicProvider implements Provider {
  readonly name: string;
  private readonly complete_: (req: ProviderRequest, signal?: AbortSignal) => Promise<LiveResponse>;

  constructor(opts: LiveProviderOptions) {
    this.name = opts.name;
    const base = requireUrl(opts.baseUrl, opts.name);
    if (opts.apiKey.length === 0) throw new Error(`${opts.name}: apiKey is empty`);
    const versioned = base.pathname.replace(/\/+$/, '').endsWith('/v1');
    const url = joinPath(base, versioned ? '/messages' : '/v1/messages');
    const headers = {
      'x-api-key': opts.apiKey,
      'anthropic-version': opts.anthropicVersion ?? '2023-06-01',
    };
    this.complete_ = async (req, signal) => {
      const body: Record<string, unknown> = {
        model: req.modelId,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        max_tokens: req.params.max_tokens,
        temperature: req.params.temperature,
      };
      const { text, started } = await performRequest(opts, url, headers, body, signal);
      const parsed = parseJson(text, opts.name);
      const blocks = Array.isArray(parsed.content) ? (parsed.content as unknown[]) : [];
      const outText = blocks
        .map((b) => {
          const block = b as { type?: unknown; text?: unknown };
          return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
        })
        .join('');
      if (outText.length === 0)
        throw new ProviderFailure(
          'retryable_provider',
          `provider ${opts.name} returned no text content`,
        );
      const usageRaw = (parsed.usage ?? undefined) as
        | {
            input_tokens?: unknown;
            output_tokens?: unknown;
            cache_read_input_tokens?: unknown;
          }
        | undefined;
      const input = num(usageRaw?.input_tokens);
      const output = num(usageRaw?.output_tokens);
      const cached = num(usageRaw?.cache_read_input_tokens);
      const usageReported = input !== undefined && output !== undefined;
      return {
        modelId: typeof parsed.model === 'string' ? parsed.model : req.modelId,
        provider: opts.name,
        ...(typeof parsed.id === 'string' ? { providerRequestId: parsed.id } : {}),
        text: outText,
        finishReason: mapAnthropicStop(parsed.stop_reason),
        usage: usageReported
          ? { input, output, cached: cached ?? 0 }
          : { input: 0, output: 0, cached: 0 },
        usageReported,
        latencyMs: Date.now() - started,
      };
    };
  }

  complete(req: ProviderRequest, signal?: AbortSignal): Promise<LiveResponse> {
    return this.complete_(req, signal);
  }
}

function mapAnthropicStop(reason: unknown): FinishReason {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'refusal') return 'content_filter';
  return 'stop';
}

export function liveProvider(kind: LiveProviderKind, opts: LiveProviderOptions): Provider {
  return kind === 'anthropic' ? new AnthropicProvider(opts) : new OpenAiCompatibleProvider(opts);
}
