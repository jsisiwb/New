/**
 * `provider:check --probe --deep` (ADR-0080): what a live model does with the gateway's request shapes,
 * measured with three small Korean requests on one route.
 *
 *  * identity — does the reply name its model family (the operator configures the id; the reply is the
 *    only evidence of which model actually answers)?
 *  * json — is a JSON-only answer fenced, wrapped in chatty text, or clean; which gateway recovery would
 *    fire (`json_fence_stripped`, `json_object_extracted`)?
 *  * long — is a long structured answer returned whole, or cut off (the finish reason and the parse
 *    tell truncation apart from a model that stopped early)?
 *
 * Reply texts are not returned (a reply may echo configuration); only labels and measurements.
 */
import { classifyProviderFailure } from './failures.js';
import { looksLikeRefusal, looksTruncatedJson } from './refusal.js';
import { type RouteEntry } from './gateway.js';
import { type Provider, type ProviderResponse } from './types.js';

export type ModelFamily = 'gemini' | 'gpt' | 'claude' | 'llama' | 'mistral' | 'other' | 'none';

export interface DeepProbeResult {
  readonly provider: string;
  readonly identity: {
    readonly family: ModelFamily;
    readonly latency_ms: number;
    readonly finish_reason?: string | undefined;
    readonly failure_class?: string | undefined;
  };
  readonly json: {
    readonly fenced: boolean;
    readonly clean: boolean;
    readonly recovered_by: 'none' | 'json_fence_stripped' | 'json_object_extracted' | 'failed';
    readonly bridge_parsed_field: boolean;
    readonly latency_ms: number;
    readonly failure_class?: string | undefined;
  };
  readonly long: {
    readonly requested_items: number;
    readonly returned_items: number | null;
    readonly complete: boolean;
    readonly truncated_json: boolean;
    readonly output_chars: number;
    readonly finish_reason?: string | undefined;
    readonly latency_ms: number;
    readonly failure_class?: string | undefined;
  };
  readonly refusals: number;
  readonly usage_reported: boolean;
}

const FAMILY_PATTERNS: readonly [ModelFamily, RegExp][] = [
  ['gemini', /gemini|제미나이|제미니/i],
  ['gpt', /\bgpt|openai|오픈에이아이|챗지피티/i],
  ['claude', /claude|anthropic|클로드/i],
  ['llama', /llama|라마\b|meta ai/i],
  ['mistral', /mistral|미스트랄/i],
];

export function modelFamilyOf(reply: string | undefined): ModelFamily {
  const t = (reply ?? '').trim();
  if (t === '') return 'none';
  for (const [family, re] of FAMILY_PATTERNS) if (re.test(t)) return family;
  return 'other';
}

const LONG_ITEMS = 1500;

export async function deepProbe(
  provider: Provider,
  route: RouteEntry,
  opts: { readonly now?: (() => number) | undefined } = {},
): Promise<DeepProbeResult> {
  const now = opts.now ?? (() => Date.now());
  let usageReported = true;
  let refusals = 0;
  const ask = async (
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ res?: ProviderResponse; ms: number; failure?: string }> => {
    const started = now();
    try {
      const res = await provider.complete({
        modelId: route.modelId,
        system,
        user,
        params: {
          temperature: 0,
          max_tokens: maxTokens,
          top_p: 1,
          seed: 0,
          json_schema_mode: false,
        },
      });
      if ((res as { usageReported?: boolean }).usageReported === false) usageReported = false;
      if (res.finishReason === 'content_filter' || looksLikeRefusal(res.text)) refusals++;
      return { res, ms: now() - started };
    } catch (err) {
      return { ms: now() - started, failure: classifyProviderFailure(err) };
    }
  };

  const id = await ask(
    '질문에 사실대로 짧게 답하라.',
    '당신은 어느 회사가 만든 어떤 언어 모델인가? 모델 이름과 버전만 한 줄로 답하라.',
    64,
  );
  const js = await ask(
    '출력은 JSON 객체 하나뿐이다. 설명, 머리말, 코드 울타리 없이 JSON만 출력하라.',
    '키 "숫자"에 7을, 키 "목록"에 1, 2, 3을 담은 배열을, 키 "문장"에 "안녕"을 담은 JSON 객체를 출력하라.',
    256,
  );
  const long = await ask(
    '출력은 JSON 배열 하나뿐이다. 설명 없이 배열만 출력하라.',
    `1부터 ${String(LONG_ITEMS)}까지의 정수를 빠짐없이 차례대로 담은 JSON 배열 하나를 출력하라.`,
    16_000,
  );

  const jsText = js.res?.text ?? '';
  const fenced = jsText.includes('```');
  let recovered: DeepProbeResult['json']['recovered_by'] = 'failed';
  let clean = false;
  try {
    JSON.parse(jsText);
    clean = true;
    recovered = 'none';
  } catch {
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(jsText);
    try {
      if (m?.[1] !== undefined) {
        JSON.parse(m[1].trim());
        recovered = 'json_fence_stripped';
      } else throw new Error('no fence');
    } catch {
      const s = jsText.indexOf('{');
      const e = jsText.lastIndexOf('}');
      try {
        if (s >= 0 && e > s) {
          JSON.parse(jsText.slice(s, e + 1));
          recovered = 'json_object_extracted';
        }
      } catch {
        recovered = 'failed';
      }
    }
  }

  const longText = long.res?.text ?? '';
  let items: number | null;
  try {
    const body = longText.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const arr: unknown = JSON.parse(body);
    items = Array.isArray(arr) ? arr.length : null;
  } catch {
    items = null;
  }

  return {
    provider: route.provider,
    identity: {
      family: modelFamilyOf(id.res?.text),
      latency_ms: id.ms,
      ...(id.res ? { finish_reason: id.res.finishReason } : {}),
      ...(id.failure ? { failure_class: id.failure } : {}),
    },
    json: {
      fenced,
      clean,
      recovered_by: js.res ? recovered : 'failed',
      bridge_parsed_field: js.res?.json !== undefined,
      latency_ms: js.ms,
      ...(js.failure ? { failure_class: js.failure } : {}),
    },
    long: {
      requested_items: LONG_ITEMS,
      returned_items: items,
      complete: items === LONG_ITEMS,
      truncated_json: looksTruncatedJson(longText),
      output_chars: longText.length,
      ...(long.res ? { finish_reason: long.res.finishReason } : {}),
      latency_ms: long.ms,
      ...(long.failure ? { failure_class: long.failure } : {}),
    },
    refusals,
    usage_reported: usageReported,
  };
}
