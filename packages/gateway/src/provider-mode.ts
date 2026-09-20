/**
 * Provider mode: how a process decides which model provider its gateway calls.
 *
 * There is no default that reaches a paid provider. `YEONJAE_PROVIDER_MODE` must be one of:
 *   * `replay`   — recorded fixture responses (tests, CLI demos); needs `YEONJAE_REPLAY_FILE`.
 *   * `genspark` — the local Genspark bridge (`tools/genspark_provider_bridge.py`).
 *   * `live`     — an OpenAI-compatible or Anthropic API keyed by `YEONJAE_LIVE_*` (see live-config.ts).
 *
 * Shared by the worker and the API so both processes resolve the same providers and routing from the
 * same variables; the enforcement wrapper (budget, admission, audit) stays with the caller.
 */
import { readFileSync } from 'node:fs';
import { type RoutingTable } from './gateway.js';
import { DEFAULT_GENSPARK_BRIDGE_URL, GensparkProvider } from './genspark-provider.js';
import { liveGatewayFromEnv } from './live-config.js';
import { ReplayProvider, type Recording } from './replay-provider.js';
import { type Provider } from './types.js';

export type ProviderMode = 'replay' | 'genspark' | 'live';

export function providerModeFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderMode {
  const mode = env.YEONJAE_PROVIDER_MODE;
  if (mode === 'replay') return 'replay';
  if (mode === 'genspark') return 'genspark';
  if (mode === 'live') return 'live';
  throw new Error(
    "YEONJAE_PROVIDER_MODE must be set to 'replay', 'genspark' or 'live'; the process refuses to start without an explicit " +
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

export interface ResolvedProviders {
  readonly mode: ProviderMode;
  /** A fresh provider map per gateway; replay providers are stateful (misses/served), so a factory. */
  readonly providers: () => Map<string, Provider>;
  readonly routing: RoutingTable;
}

/** Resolve providers and routing from the environment, validating the mode's configuration once. */
export function resolveProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): ResolvedProviders {
  const mode = providerModeFromEnv(env);
  if (mode === 'live') {
    const live = liveGatewayFromEnv(env);
    return { mode, providers: () => live.providers, routing: live.routing };
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
