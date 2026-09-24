/**
 * Per-class routing capability matrix and a configuration check (ADR-0072, P4).
 *
 * Four model classes carry the studio's calls: R (requirements, planning, bible), P (prose), M
 * (evaluation) and C (checking). What a class needs follows from the prompts routed to it — its largest
 * output budget, whether it answers in JSON, how much context its packs carry — so the requirements are
 * derived from the active prompt set rather than written down twice. `checkRouting` compares them with
 * the routes a provider mode configured and reports, per class, what is missing or risky: no route, too
 * little context, no JSON support where JSON is required, no fallback route, and judges on the writer's
 * own model (self-preference).
 *
 * Nothing here calls a provider. `provider:check --probe` (CLI) sends one tiny request per class through
 * the configured providers; tests use fakes.
 */
import { type RouteEntry, type RoutingTable } from './gateway.js';
import { classifyProviderFailure } from './failures.js';
import { type ModelClass, type Provider } from './types.js';

export type RoutedClass = Exclude<ModelClass, 'E'>;
export const ROUTED_CLASSES: readonly RoutedClass[] = ['R', 'P', 'M', 'C'];

export interface ClassRequirement {
  readonly model_class: RoutedClass;
  /** Families routed to the class, from the prompt set. */
  readonly families: readonly string[];
  /** Largest `max_tokens` among them. */
  readonly max_output_tokens: number;
  readonly needs_json: boolean;
  /** Context the class's packs need (a floor per class; packs are budgeted below it). */
  readonly min_context_tokens: number;
}

export interface PromptCapabilityInput {
  readonly family: string;
  readonly model_class: string;
  readonly output_mode?: string | undefined;
  readonly params: { readonly max_tokens?: number | undefined };
}

/** Context floors per class: bible/arc planning reads the complete design; evaluators read chapter + pack. */
const CONTEXT_FLOOR: Readonly<Record<RoutedClass, number>> = {
  R: 64_000,
  P: 32_000,
  M: 32_000,
  C: 32_000,
};

export function requirementsFromPrompts(
  prompts: readonly PromptCapabilityInput[],
): ClassRequirement[] {
  return ROUTED_CLASSES.map((cls) => {
    const mine = prompts.filter((p) => p.model_class === cls);
    return {
      model_class: cls,
      families: [...new Set(mine.map((p) => p.family))].sort(),
      max_output_tokens: Math.max(0, ...mine.map((p) => p.params.max_tokens ?? 0)),
      needs_json: mine.some((p) => p.output_mode === 'json'),
      min_context_tokens: CONTEXT_FLOOR[cls],
    };
  });
}

export type RoutingFindingCode =
  | 'NO_ROUTE'
  | 'CONTEXT_TOO_SMALL'
  | 'NO_NATIVE_JSON'
  | 'NO_FALLBACK_ROUTE'
  | 'JUDGE_SHARES_WRITER_MODEL'
  | 'SINGLE_POOLED_MODEL';

export interface RoutingFinding {
  readonly model_class: RoutedClass | 'all';
  readonly code: RoutingFindingCode;
  /** `error` blocks a run; `warning` is a known limitation or a risk. */
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface ClassCapability {
  readonly model_class: RoutedClass;
  readonly routes: number;
  readonly providers: readonly string[];
  readonly families: readonly string[];
  readonly max_context_tokens: number;
  readonly json_schema: boolean;
  readonly requirement: ClassRequirement;
  /** Provider and model of the primary route; not rendered (a notion model id is operator config). */
  readonly primary?: { readonly provider: string; readonly model_id: string } | undefined;
}

export interface RoutingCheck {
  readonly mode: string;
  readonly classes: readonly ClassCapability[];
  readonly findings: readonly RoutingFinding[];
  readonly ok: boolean;
}

const familiesOf = (routes: readonly RouteEntry[]): string[] => [
  ...new Set(routes.map((r) => r.family)),
];

/**
 * Compare a routing table with the class requirements. `mode` names the provider mode; in `notion` mode
 * every class goes to the bridge's one pooled model, so per-class routing does not apply and judges share
 * the writer's model — reported once as a known limitation, not as an error.
 */
export function checkRouting(
  mode: string,
  routing: RoutingTable,
  requirements: readonly ClassRequirement[],
): RoutingCheck {
  const findings: RoutingFinding[] = [];
  const classes: ClassCapability[] = [];
  for (const req of requirements) {
    const routes = [...routing[req.model_class]].sort((a, b) => a.priority - b.priority);
    const cap: ClassCapability = {
      model_class: req.model_class,
      routes: routes.length,
      providers: [...new Set(routes.map((r) => r.provider))],
      families: familiesOf(routes),
      max_context_tokens: Math.max(0, ...routes.map((r) => r.maxContextTokens)),
      json_schema: routes.some((r) => r.supportsJsonSchema),
      requirement: req,
      ...(routes[0]
        ? { primary: { provider: routes[0].provider, model_id: routes[0].modelId } }
        : {}),
    };
    classes.push(cap);
    if (routes.length === 0) {
      if (req.families.length > 0)
        findings.push({
          model_class: req.model_class,
          code: 'NO_ROUTE',
          severity: 'error',
          message: `class ${req.model_class} has no route but carries ${String(req.families.length)} prompt families`,
        });
      continue;
    }
    const primary = routes[0];
    if (primary && primary.maxContextTokens < req.min_context_tokens)
      findings.push({
        model_class: req.model_class,
        code: 'CONTEXT_TOO_SMALL',
        severity: 'error',
        message: `class ${req.model_class} primary route has ${String(primary.maxContextTokens)} context tokens; its packs need ${String(req.min_context_tokens)}`,
      });
    if (req.needs_json && !cap.json_schema && mode !== 'notion')
      findings.push({
        model_class: req.model_class,
        code: 'NO_NATIVE_JSON',
        severity: 'warning',
        message: `class ${req.model_class} answers in JSON but no route declares native JSON support; the gateway's parse-and-repair path carries it`,
      });
    if (routes.length < 2)
      findings.push({
        model_class: req.model_class,
        code: 'NO_FALLBACK_ROUTE',
        severity: 'warning',
        message: `class ${req.model_class} has one route: a retryable failure has nowhere else to go`,
      });
  }
  const writer = classes.find((c) => c.model_class === 'P');
  const judge = classes.find((c) => c.model_class === 'M');
  if (mode === 'notion')
    findings.push({
      model_class: 'all',
      code: 'SINGLE_POOLED_MODEL',
      severity: 'warning',
      message:
        'notion mode routes every class to the bridge’s pooled model: per-class routing (YEONJAE_MODEL_R/P/M/C) does not apply and judges share the writer’s model (known limitation, ADR-0072)',
    });
  else if (
    writer?.primary !== undefined &&
    writer.primary.provider === judge?.primary?.provider &&
    writer.primary.model_id === judge.primary.model_id
  )
    findings.push({
      model_class: 'M',
      code: 'JUDGE_SHARES_WRITER_MODEL',
      severity: 'warning',
      message:
        'judges (M) run on the writer’s (P) own model: evaluation may prefer its own prose; set YEONJAE_MODEL_M to another model',
    });
  return { mode, classes, findings, ok: !findings.some((f) => f.severity === 'error') };
}

/** A plain-text rendering for the CLI. Model ids are left out: in notion mode they are operator secrets. */
export function renderRoutingCheck(check: RoutingCheck): string {
  const lines = [`provider mode: ${check.mode}`, ''];
  lines.push(
    '| class | routes | providers | families | context | json | needs (out / json / ctx) |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of check.classes)
    lines.push(
      `| ${c.model_class} | ${String(c.routes)} | ${c.providers.join(', ') || '—'} | ${c.families.join(', ') || '—'} | ${String(c.max_context_tokens)} | ${c.json_schema ? 'yes' : 'no'} | ${String(c.requirement.max_output_tokens)} / ${c.requirement.needs_json ? 'yes' : 'no'} / ${String(c.requirement.min_context_tokens)} |`,
    );
  lines.push('');
  if (check.findings.length === 0) lines.push('no findings');
  for (const f of check.findings)
    lines.push(`- ${f.severity.toUpperCase()} ${f.code} (${f.model_class}): ${f.message}`);
  lines.push('', check.ok ? 'routing: OK' : 'routing: NOT OK');
  return lines.join('\n');
}

export interface ProbeResult {
  readonly model_class: RoutedClass;
  readonly provider: string;
  readonly ok: boolean;
  readonly latency_ms: number;
  readonly failure_class?: string | undefined;
}

/**
 * One tiny request per class on its primary route (`provider:check --probe`). It spends a few tokens per
 * class, so the CLI runs it only when asked. The reply text is not returned.
 */
export async function probeRouting(
  providers: ReadonlyMap<string, Provider>,
  routing: RoutingTable,
  opts: { readonly now?: (() => number) | undefined } = {},
): Promise<ProbeResult[]> {
  const now = opts.now ?? (() => Date.now());
  const out: ProbeResult[] = [];
  for (const cls of ROUTED_CLASSES) {
    const route = [...routing[cls]].sort((a, b) => a.priority - b.priority)[0];
    if (!route) continue;
    const provider = providers.get(route.provider);
    const started = now();
    if (!provider) {
      out.push({
        model_class: cls,
        provider: route.provider,
        ok: false,
        latency_ms: 0,
        failure_class: 'not_configured',
      });
      continue;
    }
    try {
      const res = await provider.complete({
        modelId: route.modelId,
        system: 'Reply with the single word: ok',
        user: 'ok',
        params: { temperature: 0, max_tokens: 8, top_p: 1, seed: 0, json_schema_mode: false },
      });
      const empty = (res.text ?? '').trim() === '' && res.json === undefined;
      out.push({
        model_class: cls,
        provider: route.provider,
        ok: !empty,
        latency_ms: now() - started,
        ...(empty ? { failure_class: 'empty_reply' } : {}),
      });
    } catch (err) {
      out.push({
        model_class: cls,
        provider: route.provider,
        ok: false,
        latency_ms: now() - started,
        failure_class: classifyProviderFailure(err),
      });
    }
  }
  return out;
}
