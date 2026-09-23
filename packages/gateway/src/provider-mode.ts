/**
 * Provider mode: how a process decides which model provider its gateway calls.
 *
 * There is no default that reaches a paid provider. `YEONJAE_PROVIDER_MODE` must be one of:
 *   * `replay`   — recorded fixture responses (tests, CLI demos); needs `YEONJAE_REPLAY_FILE`.
 *   * `genspark` — the local Genspark bridge (`tools/genspark_provider_bridge.py`).
 *   * `notion`   — the operator's Notion AI bridge (`YEONJAE_NOTION_URL`, bearer `YEONJAE_NOTION_TOKEN`);
 *     same `/v1/complete` protocol, pooled workspaces, empty completions retried (ADR-0056).
 *   * `live`     — an OpenAI-compatible or Anthropic API keyed by `YEONJAE_LIVE_*` (see live-config.ts).
 *   * `simulated` — a deterministic role-scripted stand-in supplied by the caller (`@yeonjae/workflows`
 *     ships one); no network, no spend, no prose quality claim. For local dry runs of the whole loop.
 *
 * Shared by the worker and the API so both processes resolve the same providers and routing from the
 * same variables; the enforcement wrapper (budget, admission, audit) stays with the caller.
 */
import { readFileSync } from 'node:fs';
import { type RouteEntry, type RoutingTable } from './gateway.js';
import { DEFAULT_GENSPARK_BRIDGE_URL, GensparkProvider } from './genspark-provider.js';
import { DEFAULT_NOTION_MODEL, NotionProvider } from './notion-provider.js';
import { liveGatewayFromEnv } from './live-config.js';
import { ReplayProvider, type Recording } from './replay-provider.js';
import { type Provider } from './types.js';

export type ProviderMode = 'replay' | 'genspark' | 'notion' | 'live' | 'simulated';

export function providerModeFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderMode {
  const mode = env.YEONJAE_PROVIDER_MODE;
  if (mode === 'replay') return 'replay';
  if (mode === 'genspark') return 'genspark';
  if (mode === 'notion') return 'notion';
  if (mode === 'live') return 'live';
  if (mode === 'simulated') return 'simulated';
  throw new Error(
    "YEONJAE_PROVIDER_MODE must be set to 'replay', 'genspark', 'notion', 'live' or 'simulated'; the process refuses to start without an explicit " +
      'provider mode so a misconfigured deployment cannot issue paid calls',
  );
}

/** Optional variant: undefined when the variable is absent, so a process can report "not configured". */
export function providerModeIfSet(env: NodeJS.ProcessEnv = process.env): ProviderMode | undefined {
  return env.YEONJAE_PROVIDER_MODE ? providerModeFromEnv(env) : undefined;
}

function replayRoute(modelId: string, family: string) {
  return [
    {
      modelId,
      provider: 'replay',
      priority: 1,
      family,
      priceInPerMTokCents: 100,
      priceOutPerMTokCents: 400,
      maxContextTokens: 200_000,
      supportsJsonSchema: true,
    },
  ];
}

export function replayRouting(): RoutingTable {
  return {
    R: replayRoute('replay-r', 'alpha'),
    P: replayRoute('replay-p', 'alpha'),
    M: replayRoute('replay-m', 'beta'),
    C: replayRoute('replay-c', 'beta'),
    E: [],
  };
}

export function gensparkRouting(env: NodeJS.ProcessEnv = process.env): RoutingTable {
  const route = (modelId: string, family: string) => [
    {
      modelId,
      provider: 'genspark',
      priority: 1,
      family,
      priceInPerMTokCents: 0,
      priceOutPerMTokCents: 0,
      maxContextTokens: 128_000,
      supportsJsonSchema: true,
    },
  ];
  const r = env.YEONJAE_MODEL_R ?? 'claude-opus-4-7';
  const rest = env.YEONJAE_MODEL_DEFAULT ?? 'gemini-3.8-flash';
  return {
    R: route(r, 'anthropic'),
    P: route(env.YEONJAE_MODEL_P ?? rest, 'google'),
    M: route(env.YEONJAE_MODEL_M ?? rest, 'google'),
    C: route(env.YEONJAE_MODEL_C ?? rest, 'google'),
    E: [],
  };
}

/**
 * Notion routing: every class goes to the bridge's pooled model (`notion-ai` unless configured), and each
 * class carries FALLBACK ROUTES so a retryable failure (an empty completion, a 5xx, a throttle) is retried
 * on the next route instead of failing the call. On the bridge's round-robin pool the next attempt lands
 * on another workspace; `YEONJAE_NOTION_FALLBACK_MODELS` (comma-separated) may pin workspace models.
 */
export function notionRouting(env: NodeJS.ProcessEnv = process.env): RoutingTable {
  const base = env.YEONJAE_NOTION_MODEL ?? DEFAULT_NOTION_MODEL;
  const fallbacks = (env.YEONJAE_NOTION_FALLBACK_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  const route = (modelId: string) =>
    [modelId, ...(fallbacks.length > 0 ? fallbacks : [modelId, modelId])].map((m, i) => ({
      modelId: m,
      provider: 'notion',
      priority: i + 1,
      family: 'notion',
      priceInPerMTokCents: 0,
      priceOutPerMTokCents: 0,
      maxContextTokens: 128_000,
      supportsJsonSchema: false,
    }));
  return {
    R: route(env.YEONJAE_MODEL_R ?? base),
    P: route(env.YEONJAE_MODEL_P ?? base),
    M: route(env.YEONJAE_MODEL_M ?? base),
    C: route(env.YEONJAE_MODEL_C ?? base),
    E: [],
  };
}

export interface ResolvedProviders {
  readonly mode: ProviderMode;
  /** A fresh provider map per gateway; replay providers are stateful (misses/served), so a factory. */
  readonly providers: () => Map<string, Provider>;
  readonly routing: RoutingTable;
}

/** Resolve providers and routing from the environment, validating the mode's configuration once. */
export function resolveProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: { readonly simulated?: (() => Provider) | undefined } = {},
): ResolvedProviders {
  const mode = providerModeFromEnv(env);
  if (mode === 'simulated') {
    const make = opts.simulated;
    if (!make)
      throw new Error(
        'YEONJAE_PROVIDER_MODE=simulated needs a simulated provider, which this process does not supply',
      );
    const routing = replayRouting();
    const rename = (rs: readonly RouteEntry[]) => rs.map((r) => ({ ...r, provider: 'simulated' }));
    return {
      mode,
      providers: () => new Map<string, Provider>([['simulated', make()]]),
      routing: {
        R: rename(routing.R),
        P: rename(routing.P),
        M: rename(routing.M),
        C: rename(routing.C),
        E: [],
      },
    };
  }
  if (mode === 'live') {
    const live = liveGatewayFromEnv(env);
    return { mode, providers: () => live.providers, routing: live.routing };
  }
  if (mode === 'notion') {
    const url = env.YEONJAE_NOTION_URL;
    if (!url)
      throw new Error(
        'YEONJAE_NOTION_URL must name the Notion bridge endpoint when YEONJAE_PROVIDER_MODE=notion',
      );
    const timeout = env.YEONJAE_NOTION_TIMEOUT_MS
      ? Number(env.YEONJAE_NOTION_TIMEOUT_MS)
      : undefined;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0))
      throw new Error('YEONJAE_NOTION_TIMEOUT_MS must be a positive number of milliseconds');
    return {
      mode,
      providers: () =>
        new Map<string, Provider>([
          [
            'notion',
            new NotionProvider({
              baseUrl: url,
              // An explicitly configured bridge URL is deliberate operator config.
              allowNonLoopback: true,
              ...(env.YEONJAE_NOTION_TOKEN ? { token: env.YEONJAE_NOTION_TOKEN } : {}),
              ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
            }),
          ],
        ]),
      routing: notionRouting(env),
    };
  }
  if (mode === 'genspark') {
    return {
      mode,
      providers: () =>
        new Map<string, Provider>([
          [
            'genspark',
            new GensparkProvider({
              baseUrl: env.YEONJAE_GENSPARK_URL ?? DEFAULT_GENSPARK_BRIDGE_URL,
              // An explicitly configured bridge URL (e.g. a tunnel to the operator's bridge host) is
              // deliberate operator config; the default stays loopback-only.
              ...(env.YEONJAE_GENSPARK_URL ? { allowNonLoopback: true } : {}),
              // Big bible-stage calls can run many minutes on a long-timeout bridge.
              ...(env.YEONJAE_GENSPARK_TIMEOUT_MS
                ? { timeoutMs: Number(env.YEONJAE_GENSPARK_TIMEOUT_MS) }
                : {}),
              ...(env.YEONJAE_GENSPARK_TOKEN
                ? { headers: { authorization: `Bearer ${env.YEONJAE_GENSPARK_TOKEN}` } }
                : {}),
            }),
          ],
        ]),
      routing: gensparkRouting(env),
    };
  }
  const replayFile = env.YEONJAE_REPLAY_FILE;
  if (!replayFile)
    throw new Error('YEONJAE_REPLAY_FILE must name a recording when YEONJAE_PROVIDER_MODE=replay');
  const recording = JSON.parse(readFileSync(replayFile, 'utf8')) as Record<string, Recording>;
  return {
    mode,
    providers: () => new Map<string, Provider>([['replay', new ReplayProvider(recording)]]),
    routing: replayRouting(),
  };
}
