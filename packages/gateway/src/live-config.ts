/**
 * Live provider configuration, read from the environment by NAME only.
 *
 * One primary provider (OpenAI-compatible or Anthropic) plus an optional fallback provider. Each model
 * class (R requirements/planning, P prose, M evaluation, C checking) may name its own model; unnamed
 * classes fall back to `YEONJAE_MODEL_DEFAULT`. Prices are per million tokens in cents and feed the
 * gateway's budget accounting; they default to zero, which the cost report presents as "unpriced" —
 * never as evidence that calls were free.
 *
 * The API key is validated for presence and handed to the adapter; it is never placed on the returned
 * config object, so a config dump cannot leak it.
 */
import { liveProvider, type LiveProviderKind } from './live-providers.js';
import { type RouteEntry, type RoutingTable } from './gateway.js';
import { type ModelClass, type Provider } from './types.js';

export interface LiveProviderSpec {
  readonly name: string;
  readonly kind: LiveProviderKind;
  readonly baseUrl: string;
  readonly models: Readonly<Record<Exclude<ModelClass, 'E'>, string>>;
  readonly priceInPerMTokCents: number;
  readonly priceOutPerMTokCents: number;
  readonly maxContextTokens: number;
  readonly timeoutMs: number;
  /** Native structured output the endpoint accepts (ADR-0057); only OpenAI-compatible endpoints may set it. */
  readonly structuredOutput: 'json_schema' | 'json_object';
}

export interface LiveConfig {
  readonly primary: LiveProviderSpec;
  readonly fallback?: LiveProviderSpec | undefined;
}

export const DEFAULT_BASE_URLS: Readonly<Record<LiveProviderKind, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

export class LiveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveConfigError';
  }
}

function kindOf(raw: string | undefined, variable: string): LiveProviderKind {
  if (raw === undefined || raw === '' || raw === 'openai') return 'openai';
  if (raw === 'anthropic') return 'anthropic';
  throw new LiveConfigError(`${variable} must be 'openai' or 'anthropic'; got '${raw}'`);
}

function intOf(raw: string | undefined, fallback: number, variable: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0)
    throw new LiveConfigError(`${variable} must be a non-negative number`);
  return n;
}

function specFrom(
  env: NodeJS.ProcessEnv,
  prefix: 'YEONJAE_LIVE' | 'YEONJAE_LIVE_FALLBACK',
  name: string,
  required: boolean,
): { spec: LiveProviderSpec; apiKey: string } | undefined {
  const apiKey = env[`${prefix}_API_KEY`];
  const kindRaw = env[`${prefix}_PROVIDER`];
  if (
    !required &&
    (apiKey === undefined || apiKey === '') &&
    (kindRaw === undefined || kindRaw === '')
  )
    return undefined;
  if (apiKey === undefined || apiKey === '')
    throw new LiveConfigError(`${prefix}_API_KEY must be set when the live provider mode is used`);
  const kind = kindOf(kindRaw, `${prefix}_PROVIDER`);
  const modelPrefix = prefix === 'YEONJAE_LIVE' ? 'YEONJAE_MODEL' : 'YEONJAE_FALLBACK_MODEL';
  const fallbackModel = env[`${modelPrefix}_DEFAULT`];
  const model = (cls: Exclude<ModelClass, 'E'>): string => {
    const v = env[`${modelPrefix}_${cls}`] ?? fallbackModel;
    if (v === undefined || v === '')
      throw new LiveConfigError(
        `${modelPrefix}_${cls} or ${modelPrefix}_DEFAULT must name the model for class ${cls}`,
      );
    return v;
  };
  const spec: LiveProviderSpec = {
    name,
    kind,
    baseUrl: env[`${prefix}_BASE_URL`] ?? DEFAULT_BASE_URLS[kind],
    models: { R: model('R'), P: model('P'), M: model('M'), C: model('C') },
    priceInPerMTokCents: intOf(
      env[`${prefix}_PRICE_IN_CENTS_PER_MTOK`],
      0,
      `${prefix}_PRICE_IN_CENTS_PER_MTOK`,
    ),
    priceOutPerMTokCents: intOf(
      env[`${prefix}_PRICE_OUT_CENTS_PER_MTOK`],
      0,
      `${prefix}_PRICE_OUT_CENTS_PER_MTOK`,
    ),
    maxContextTokens: intOf(
      env[`${prefix}_MAX_CONTEXT_TOKENS`],
      128_000,
      `${prefix}_MAX_CONTEXT_TOKENS`,
    ),
    timeoutMs: intOf(env[`${prefix}_TIMEOUT_MS`], 300_000, `${prefix}_TIMEOUT_MS`),
    structuredOutput: structuredOutputOf(env[`${prefix}_STRUCTURED_OUTPUT`], kind, prefix),
  };
  return { spec, apiKey };
}

function structuredOutputOf(
  raw: string | undefined,
  kind: LiveProviderKind,
  prefix: string,
): LiveProviderSpec['structuredOutput'] {
  if (raw === undefined || raw === '' || raw === 'json_object') return 'json_object';
  if (raw !== 'json_schema')
    throw new LiveConfigError(
      `${prefix}_STRUCTURED_OUTPUT must be 'json_schema' or 'json_object'; got '${raw}'`,
    );
  if (kind !== 'openai')
    throw new LiveConfigError(
      `${prefix}_STRUCTURED_OUTPUT=json_schema needs an OpenAI-compatible provider`,
    );
  return 'json_schema';
}

/** Build providers and a routing table from the environment. Throws `LiveConfigError` naming the variable. */
export function liveGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): {
  config: LiveConfig;
  providers: Map<string, Provider>;
  routing: RoutingTable;
} {
  const primary = specFrom(env, 'YEONJAE_LIVE', 'live', true);
  if (!primary) throw new LiveConfigError('YEONJAE_LIVE_API_KEY must be set');
  const fallback = specFrom(env, 'YEONJAE_LIVE_FALLBACK', 'live-fallback', false);
  const providers = new Map<string, Provider>();
  const specs: { spec: LiveProviderSpec; apiKey: string; priority: number }[] = [
    { ...primary, priority: 1 },
    ...(fallback ? [{ ...fallback, priority: 2 }] : []),
  ];
  for (const s of specs) {
    providers.set(
      s.spec.name,
      liveProvider(s.spec.kind, {
        name: s.spec.name,
        baseUrl: s.spec.baseUrl,
        apiKey: s.apiKey,
        timeoutMs: s.spec.timeoutMs,
      }),
    );
  }
  const routesFor = (cls: Exclude<ModelClass, 'E'>): RouteEntry[] =>
    specs.map((s) => ({
      modelId: s.spec.models[cls],
      provider: s.spec.name,
      priority: s.priority,
      family: s.spec.kind,
      priceInPerMTokCents: s.spec.priceInPerMTokCents,
      priceOutPerMTokCents: s.spec.priceOutPerMTokCents,
      maxContextTokens: s.spec.maxContextTokens,
      supportsJsonSchema: s.spec.kind === 'openai',
      ...(s.spec.structuredOutput === 'json_schema'
        ? { nativeStructuredOutput: 'json_schema' as const }
        : {}),
    }));
  const routing: RoutingTable = {
    R: routesFor('R'),
    P: routesFor('P'),
    M: routesFor('M'),
    C: routesFor('C'),
    E: [],
  };
  return {
    config: { primary: primary.spec, ...(fallback ? { fallback: fallback.spec } : {}) },
    providers,
    routing,
  };
}

/** Whether a live configuration is present, without validating it fully. */
export function liveConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.YEONJAE_LIVE_API_KEY ?? '') !== '';
}
