/**
 * The model gateway (docs/06-system/07). The only path to a provider. Per call: Guard → budget reservation →
 * route → provider → truncation / structured-output validation with bounded repair → output-language check
 * for manuscript roles (discard + regenerate once + reroute) → audit record. Idempotent by key: a completed
 * call is returned from the audit store without new spend.
 */
import { createHash } from 'node:crypto';
import { checkOutputLanguage, toNfcText } from '@yeonjae/prose';
import { uuidv7, validatorFor, type Uuid } from '@yeonjae/domain';
import { classifyProviderFailure, isRetryable, type FailureClass } from './failures.js';
import { guardRequest, type GuardContext } from './guard.js';
import { DEFAULT_PARAMS } from './mock-provider.js';
import {
  GatewayError,
  type FinishReason,
  type GatewayRequest,
  type GatewayResponse,
  type ModelClass,
  type ModelParams,
  type Provider,
  type ProviderResponse,
} from './types.js';

export interface RouteEntry {
  readonly modelId: string;
  readonly provider: string;
  readonly priority: number;
  readonly family: string;
  readonly priceInPerMTokCents: number;
  readonly priceOutPerMTokCents: number;
  readonly maxContextTokens: number;
  readonly supportsJsonSchema: boolean;
}

export type RoutingTable = Readonly<Record<ModelClass, readonly RouteEntry[]>>;

export interface BudgetLedger {
  /** Reserve `cents`; throw GatewayError('BUDGET_EXHAUSTED') when the scope cannot afford it. */
  reserve(
    scope: { projectId: string; jobId: string },
    cents: number,
  ): Promise<{ release(actualCents: number): Promise<void> }>;
}

export interface AuditRecord {
  readonly id: Uuid;
  readonly idempotency_key: string;
  readonly activity_id?: string | undefined;
  readonly role: string;
  readonly prompt_version_id: string;
  readonly prompt_hash: string;
  readonly pack_id: string;
  readonly pack_hash: string;
  readonly production_policy_version: string;
  readonly narrative_identity_version_id?: string | undefined;
  readonly narrative_block_hash?: string | undefined;
  readonly output_language_contract_hash?: string | undefined;
  readonly tradition_contract_hash?: string | undefined;
  readonly output_language_check?:
    | { performed: boolean; passed?: boolean | undefined; english_confidence?: number | undefined }
    | undefined;
  readonly model_id: string;
  readonly model_class: ModelClass;
  readonly provider: string;
  readonly params: ModelParams;
  readonly usage: ProviderResponse['usage'];
  readonly cost_cents: number;
  readonly latency_ms: number;
  readonly attempt: number;
  readonly status: 'succeeded' | 'failed' | 'fallback_succeeded' | 'budget_blocked';
  readonly finish_reason: FinishReason;
  readonly schema_valid: boolean;
  readonly repair_attempts: number;
  readonly fallback_from_model_id?: string | undefined;
  readonly error?: { class: string; message: string } | undefined;
  /**
   * Attempt-level provenance (B-4-2). `attempt_records` carries one entry per ACTUAL provider attempt, so
   * a fallback that succeeded on route 2 still shows why route 1 was abandoned. Cost is attributed per
   * attempt and the summed `cost_cents` stays the authoritative total, so no attempt is double-charged.
   */
  readonly attempt_records?:
    | readonly {
        readonly attempt: number;
        readonly model_id: string;
        readonly provider: string;
        readonly outcome: 'succeeded' | 'failed';
        readonly failure_class?: string | undefined;
        readonly error_class?: string | undefined;
        readonly cost_cents: number;
        readonly usage: ProviderResponse['usage'];
        readonly latency_ms: number;
      }[]
    | undefined;
  /** Prompt and output text are never logged in plaintext; only hashes and sizes live on the record. */
  readonly input_hash: string;
  readonly output_hash?: string | undefined;
  readonly output: { text?: string | undefined; json?: unknown } | undefined;
  readonly created_at: string;
}

export interface AuditStore {
  findByIdempotencyKey(key: string): Promise<AuditRecord | undefined>;
  append(record: AuditRecord): Promise<void>;
}

export class MemoryAuditStore implements AuditStore {
  readonly records: AuditRecord[] = [];
  async findByIdempotencyKey(key: string): Promise<AuditRecord | undefined> {
    return this.records.find(
      (r) => r.idempotency_key === key && r.status !== 'failed' && r.status !== 'budget_blocked',
    );
  }
  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

export class MemoryBudget implements BudgetLedger {
  private spent = new Map<string, number>();
  constructor(private readonly hardLimitCents: number) {}
  async reserve(scope: { projectId: string }, cents: number) {
    const key = scope.projectId;
    const used = this.spent.get(key) ?? 0;
    if (used + cents > this.hardLimitCents) {
      throw new GatewayError(
        'BUDGET_EXHAUSTED',
        `project ${key}: ${used} + ${cents} cents exceeds hard limit ${this.hardLimitCents}`,
      );
    }
    this.spent.set(key, used + cents);
    return {
      release: async (actual: number) => {
        this.spent.set(key, (this.spent.get(key) ?? 0) - cents + actual);
      },
    };
  }
  spentCents(projectId: string): number {
    return this.spent.get(projectId) ?? 0;
  }
}

export interface GatewayOptions {
  readonly providers: ReadonlyMap<string, Provider>;
  readonly routing: RoutingTable;
  readonly budget: BudgetLedger;
  readonly audit: AuditStore;
  readonly guardContext?: GuardContext | undefined;
  /** Minimum English confidence for manuscript roles (policy.output_language.min_english_confidence). */
  readonly minEnglishConfidence?: number | undefined;
  readonly allowlistTerms?: readonly string[] | undefined;
  readonly clock?: (() => Date) | undefined;
  /** Per-call token estimate for reservation; defaults to prompt estimate + max_tokens. */
  readonly tokensPerWord?: number | undefined;
}

function sha(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function costCents(route: RouteEntry, usage: ProviderResponse['usage']): number {
  return (
    (usage.input * route.priceInPerMTokCents + usage.output * route.priceOutPerMTokCents) /
    1_000_000
  );
}

export class Gateway {
  constructor(private readonly opts: GatewayOptions) {}

  private routesFor(cls: ModelClass, excludeFamily?: string): RouteEntry[] {
    const routes = [...this.opts.routing[cls]].sort((a, b) => a.priority - b.priority);
    return excludeFamily ? routes.filter((r) => r.family !== excludeFamily) : routes;
  }

  async call(req: GatewayRequest): Promise<GatewayResponse> {
    // 0. idempotency: a completed call is replayed, never re-spent
    const prior = await this.opts.audit.findByIdempotencyKey(req.idempotencyKey);
    if (prior) return this.fromAudit(prior, true);

    // 1. Guard (fail closed)
    const guard = guardRequest(req, this.opts.guardContext);

    // 2. route + budget reservation
    const routes = this.routesFor(req.modelClass);
    if (routes.length === 0)
      throw new GatewayError('PROVIDER_FAILED', `no route for model class ${req.modelClass}`);
    const params: ModelParams = { ...DEFAULT_PARAMS, ...(req.params ?? {}) };
    const primary = routes[0];
    if (!primary) throw new GatewayError('PROVIDER_FAILED', 'no primary route');
    const predicted = costCents(primary, {
      input: req.pack.tokenEstimate,
      output: params.max_tokens,
      cached: 0,
    });
    const reservation = await this.opts.budget
      .reserve({ projectId: req.projectId, jobId: req.jobId }, predicted)
      .catch(async (err: unknown) => {
        if (err instanceof GatewayError && err.code === 'BUDGET_EXHAUSTED') {
          await this.opts.audit.append(
            this.record(
              req,
              guard,
              primary,
              params,
              undefined,
              0,
              'budget_blocked',
              'stop',
              false,
              0,
              { class: 'BUDGET_EXHAUSTED', message: err.message },
            ),
          );
        }
        throw err;
      });

    let attempt = 0;
    let repairAttempts = 0;
    let fallbackFrom: string | undefined;
    let lastError: { class: string; message: string } | undefined;
    let languageFailures = 0;
    let routeIdx = 0;
    let actualCost = 0;
    let lastFailureClass: FailureClass | undefined;
    const attemptRecords: NonNullable<AuditRecord['attempt_records']>[number][] = [];
    const validator = req.outputSchemaRef ? validatorFor(req.outputSchemaRef) : undefined;

    try {
      while (routeIdx < routes.length && attempt < 4) {
        const route = routes[routeIdx];
        if (!route) break;
        const provider = this.opts.providers.get(route.provider);
        if (!provider)
          throw new GatewayError('PROVIDER_FAILED', `provider ${route.provider} not configured`);
        attempt++;
        let res: ProviderResponse;
        try {
          res = await provider.complete({
            modelId: route.modelId,
            system: req.pack.renderedSystem,
            user: req.pack.renderedUser,
            params,
            trace: {
              role: req.role,
              activityId: req.activityId,
              idempotencyKey: req.idempotencyKey,
            },
          });
        } catch (err) {
          // Fallback is authorized ONLY for a policy-retryable failure. A rejected request, an auth
          // failure, a content refusal or an unrecognized fault stops here: re-sending the same bytes to
          // the next paid model would multiply spend without any prospect of a different answer.
          const failureClass = classifyProviderFailure(err);
          lastFailureClass = failureClass;
          lastError = {
            class: 'PROVIDER_FAILED',
            message: err instanceof Error ? err.message : String(err),
          };
          attemptRecords.push({
            attempt,
            model_id: route.modelId,
            provider: route.provider,
            outcome: 'failed',
            failure_class: failureClass,
            error_class: 'PROVIDER_FAILED',
            cost_cents: 0,
            usage: { input: 0, output: 0, cached: 0 },
            latency_ms: 0,
          });
          if (!isRetryable(failureClass)) break;
          fallbackFrom = route.modelId;
          routeIdx++;
          continue;
        }
        const attemptCost = costCents(route, res.usage);
        actualCost += attemptCost;

        const noteAttempt = (outcome: 'succeeded' | 'failed', errorClass?: string): void => {
          attemptRecords.push({
            attempt,
            model_id: route.modelId,
            provider: route.provider,
            outcome,
            ...(errorClass ? { error_class: errorClass } : {}),
            cost_cents: attemptCost,
            usage: res.usage,
            latency_ms: res.latencyMs,
          });
        };

        // 3. truncation
        if (res.finishReason === 'length') {
          lastError = { class: 'TRUNCATED', message: 'provider stopped at max_tokens' };
          noteAttempt('failed', 'TRUNCATED');
          if (attempt < 2) continue; // one regeneration on the same route
          routeIdx++;
          continue;
        }

        // 4. structured output
        let json: unknown = res.json;
        let schemaValid = true;
        if (validator || req.outputSchemaRef) {
          if (json === undefined && res.text !== undefined) {
            try {
              json = JSON.parse(stripFences(res.text));
            } catch {
              json = undefined;
            }
          }
          if (json === undefined) {
            schemaValid = false;
          } else if (validator) {
            const v = validator(json);
            schemaValid = v.ok;
          }
          if (!schemaValid) {
            repairAttempts++;
            lastError = { class: 'SCHEMA_INVALID', message: 'structured output did not validate' };
            noteAttempt('failed', 'SCHEMA_INVALID');
            if (repairAttempts <= 2) continue; // bounded repair = regenerate on the same route
            routeIdx++;
            continue;
          }
        }

        // 5. output-language check for manuscript roles (OUTPUT-EN-001)
        let languageCheck: GatewayResponse['outputLanguageCheck'] = { performed: false };
        if (req.manuscriptProducing) {
          const prose = extractProse(json, res.text);
          const check = checkOutputLanguage(toNfcText(prose), {
            minConfidence: this.opts.minEnglishConfidence ?? 0.99,
            allowlist: this.opts.allowlistTerms ?? [],
          });
          languageCheck = {
            performed: true,
            passed: check.passed,
            englishConfidence: check.english_confidence,
          };
          if (!check.passed) {
            languageFailures++;
            lastError = {
              class: 'OUTPUT_LANGUAGE_FAILED',
              message: `English confidence ${check.english_confidence}; offending: ${check.offending_segments.map((s) => s.paragraph_id).join(',')}`,
            };
            noteAttempt('failed', 'OUTPUT_LANGUAGE_FAILED');
            // discard; regenerate once on the same route, then reroute to the alternate P-class model
            if (languageFailures === 1) continue;
            fallbackFrom = route.modelId;
            routeIdx++;
            continue;
          }
        }

        // 6. success → audit
        noteAttempt('succeeded');
        const status =
          fallbackFrom && fallbackFrom !== route.modelId ? 'fallback_succeeded' : 'succeeded';
        const output = { text: res.text, json };
        const record = this.record(
          req,
          guard,
          route,
          params,
          res,
          actualCost,
          status,
          res.finishReason,
          schemaValid,
          repairAttempts,
          undefined,
          fallbackFrom,
          languageCheck,
          output,
          attempt,
          attemptRecords,
        );
        await this.opts.audit.append(record);
        await reservation.release(actualCost);
        return this.fromAudit(record, false);
      }
      // exhausted
      const failRoute = routes[Math.min(routeIdx, routes.length - 1)] ?? primary;
      await this.opts.audit.append(
        this.record(
          req,
          guard,
          failRoute,
          params,
          undefined,
          actualCost,
          'failed',
          'error',
          false,
          repairAttempts,
          lastError ?? { class: 'PROVIDER_FAILED', message: 'exhausted routes' },
          fallbackFrom,
          undefined,
          undefined,
          attempt,
          attemptRecords,
        ),
      );
      await reservation.release(actualCost);
      const cls = (lastError?.class ?? 'PROVIDER_FAILED') as GatewayError['code'];
      // The surfaced error names the classification that stopped the call, so an operator can tell a
      // refused request from an exhausted set of retryable routes. Causal detail only; never prose.
      throw new GatewayError(
        cls,
        lastFailureClass
          ? `${lastError?.message ?? 'all routes failed'} [failure_class=${lastFailureClass}]`
          : (lastError?.message ?? 'all routes failed'),
      );
    } catch (err) {
      if (!(err instanceof GatewayError)) {
        await reservation.release(actualCost);
      }
      throw err;
    }
  }

  private record(
    req: GatewayRequest,
    guard: ReturnType<typeof guardRequest>,
    route: RouteEntry,
    params: ModelParams,
    res: ProviderResponse | undefined,
    cost: number,
    status: AuditRecord['status'],
    finish: FinishReason,
    schemaValid: boolean,
    repairAttempts: number,
    error?: { class: string; message: string },
    fallbackFrom?: string,
    languageCheck?: GatewayResponse['outputLanguageCheck'],
    output?: { text?: string | undefined; json?: unknown },
    attempt = 1,
    attemptRecords?: AuditRecord['attempt_records'],
  ): AuditRecord {
    const now = (this.opts.clock ?? (() => new Date()))();
    const outText =
      output?.text ?? (output?.json !== undefined ? JSON.stringify(output.json) : undefined);
    return {
      id: uuidv7(now.getTime()),
      idempotency_key: req.idempotencyKey,
      activity_id: req.activityId,
      role: req.role,
      prompt_version_id: req.promptVersionId,
      prompt_hash: req.promptHash,
      pack_id: req.pack.id,
      pack_hash: req.pack.hash,
      production_policy_version: req.productionPolicyVersion,
      narrative_identity_version_id: req.narrativeIdentityRef?.identityVersionId,
      narrative_block_hash: guard.blockHash,
      output_language_contract_hash: guard.outputLanguageContractHash,
      tradition_contract_hash: guard.traditionContractHash,
      output_language_check: languageCheck?.performed
        ? {
            performed: true,
            passed: languageCheck.passed,
            english_confidence: languageCheck.englishConfidence,
          }
        : { performed: false },
      model_id: route.modelId,
      model_class: req.modelClass,
      provider: route.provider,
      params,
      usage: res?.usage ?? { input: 0, output: 0, cached: 0 },
      cost_cents: cost,
      latency_ms: res?.latencyMs ?? 0,
      attempt,
      status,
      finish_reason: finish,
      schema_valid: schemaValid,
      repair_attempts: repairAttempts,
      fallback_from_model_id: fallbackFrom,
      error,
      ...(attemptRecords && attemptRecords.length > 0 ? { attempt_records: attemptRecords } : {}),
      input_hash: sha(`${req.pack.renderedSystem}\u0000${req.pack.renderedUser}`),
      output_hash: outText !== undefined ? sha(outText) : undefined,
      output,
      created_at: now.toISOString(),
    };
  }

  private fromAudit(r: AuditRecord, replayed: boolean): GatewayResponse {
    return {
      llmCallId: r.id,
      modelId: r.model_id,
      provider: r.provider,
      output: r.output ?? {},
      finishReason: r.finish_reason,
      usage: r.usage,
      costCents: r.cost_cents,
      latencyMs: r.latency_ms,
      schemaValid: r.schema_valid,
      attempts: r.attempt,
      outputLanguageCheck: r.output_language_check?.performed
        ? {
            performed: true,
            passed: r.output_language_check.passed ?? false,
            englishConfidence: r.output_language_check.english_confidence ?? 0,
          }
        : { performed: false },
      replayed,
    };
  }
}

function stripFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (m?.[1] ?? text).trim();
}

/** Manuscript roles return prose inside JSON (`text`, `new_text`, seam patches); collect every prose field. */
export function extractProse(json: unknown, text: string | undefined): string {
  const parts: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (key === 'text' || key === 'new_text' || key === 'title') parts.push(v);
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
    }
  };
  walk(json);
  if (parts.length === 0 && text) parts.push(text);
  return parts.join('\n\n');
}
