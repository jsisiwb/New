/**
 * Deterministic cost and attempt accounting over the append-only gateway audit (B-4-6).
 *
 * WHY THIS EXISTS. `llm_calls` records one row per logical CALL, and migration 0011's `attempt_records`
 * attributes that row's cost across the ACTUAL provider attempts. Nothing yet read the two together, so
 * two questions an operator must be able to answer had no implementation: "how many provider attempts did
 * this spend actually involve?" and "did a retry or a fallback happen?".
 *
 * THE ONE ARITHMETIC RULE. `llm_calls.cost_cents` is the authoritative total for a call;
 * `attempt_records[].cost_cents` attributes that total across attempts and must never be ADDED to it.
 * Every function here keeps those separate and reports both, because conflating them is the single way
 * cost reporting silently double-counts a fallback.
 *
 * MONEY IS INTEGER CENTS. Costs are summed as integers (PostgreSQL `numeric` → string → BigInt) and never
 * pass through a float, so no rounding drift can accumulate across a long run. Every returned monetary
 * value is an integer count of cents with the currency stated explicitly.
 *
 * TRUTHFULNESS. Recorded usage is what the gateway observed, which is not the same as a provider invoice.
 * Summaries label their basis (`recorded_replay` here, because every call in this repository is served by
 * the replay or mock provider) and never claim billed truth. Usage that a provider did not report stays
 * `unknown` rather than being coerced to zero — a missing token count and a genuine zero are different
 * facts, and only one of them is safe to sum.
 */
import type { Client, Pool } from './client.js';

type Queryable = Pool | Client;

/** The unit every monetary value in this module is expressed in. Stated, never assumed. */
export const COST_CURRENCY = 'USD' as const;
export const COST_UNIT = 'cents' as const;

/**
 * How a summary's numbers were obtained.
 *
 * `recorded_replay` — observed from replay/mock providers: deterministic, synthetic, no money moved.
 * `recorded_live`   — observed from a live provider call. Not reachable in this repository today.
 * `estimated`       — computed from a price table rather than observed.
 *
 * There is deliberately no `billed` member: a provider invoice is not something this system observes.
 */
export type CostBasis = 'recorded_replay' | 'recorded_live' | 'estimated';

export interface AttemptRecord {
  readonly attempt: number;
  readonly model_id: string;
  readonly provider: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly failure_class?: string | undefined;
  readonly error_class?: string | undefined;
  readonly cost_cents?: number | undefined;
  readonly usage?: { input_tokens?: number; output_tokens?: number } | undefined;
  readonly latency_ms?: number | undefined;
}

export interface CallAccounting {
  readonly call_id: string;
  readonly job_id: string | null;
  readonly role: string;
  readonly status: string;
  /** Authoritative total for the call, in integer cents. */
  readonly cost_cents: number;
  /** Sum of the per-attempt attributions. Must equal `cost_cents` when attempts are recorded. */
  readonly attributed_cents: number;
  readonly attempts: number;
  readonly failed_attempts: number;
  readonly retried: boolean;
  readonly fell_back: boolean;
  /** Models actually contacted, in attempt order. */
  readonly models: readonly string[];
  /** True when the provider reported no usable token usage for the winning attempt. */
  readonly usage_unknown: boolean;
}

export interface CostDimension {
  readonly key: string | null;
  readonly calls: number;
  /** Actual provider attempts behind those calls. Greater than `calls` whenever a retry happened. */
  readonly attempts: number;
  readonly cost_cents: number;
  readonly retried_calls: number;
  readonly fallback_calls: number;
  /** Calls whose token usage the provider did not report. Never silently counted as zero. */
  readonly usage_unknown_calls: number;
}

export interface CostSummary {
  readonly basis: CostBasis;
  readonly currency: typeof COST_CURRENCY;
  readonly unit: typeof COST_UNIT;
  readonly total_cost_cents: number;
  readonly calls: number;
  readonly attempts: number;
  readonly dimension: CostDimensionName;
  readonly items: readonly CostDimension[];
}

/**
 * The dimensions a cost summary may be grouped by.
 *
 * A closed set, mapped to a column below, so no caller-supplied string ever reaches SQL text. `outcome`
 * is the call's terminal status, which is how a reader distinguishes spend that produced an accepted
 * result from spend that ended in a failure.
 */
export const COST_DIMENSIONS = [
  'role',
  'model',
  'provider',
  'model_class',
  'job',
  'policy',
  'outcome',
] as const;
export type CostDimensionName = (typeof COST_DIMENSIONS)[number];

const DIMENSION_COLUMN: Record<CostDimensionName, string> = {
  role: 'role',
  model: 'model_id',
  provider: 'provider',
  model_class: 'model_class',
  job: 'job_id::text',
  policy: 'production_policy_version',
  outcome: 'status',
};

function parseAttempts(value: unknown): AttemptRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is AttemptRecord => typeof a === 'object' && a !== null);
}

/** Integer cents from a PostgreSQL `numeric`, which node-postgres returns as a string. */
function cents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  // Money never passes through a float: parse the integral part directly.
  const text = String(value);
  const integral = text.includes('.') ? text.slice(0, text.indexOf('.')) : text;
  return Number(BigInt(integral === '' || integral === '-' ? '0' : integral));
}

function hasUsableUsage(usage: unknown): boolean {
  if (typeof usage !== 'object' || usage === null) return false;
  const u = usage as Record<string, unknown>;
  return typeof u.input_tokens === 'number' || typeof u.output_tokens === 'number';
}

interface AuditRow {
  id: string;
  job_id: string | null;
  role: string;
  status: string;
  model_id: string;
  cost_cents: string;
  usage: unknown;
  fallback_from_model_id: string | null;
  attempt_records: unknown;
}

/** Per-call accounting for one project, with attempts resolved from migration 0011's provenance. */
export async function callAccounting(db: Queryable, projectId: string): Promise<CallAccounting[]> {
  const { rows } = await db.query<AuditRow>(
    `SELECT id, job_id, role, status, model_id, cost_cents, usage, fallback_from_model_id,
            attempt_records
       FROM llm_calls WHERE project_id = $1 ORDER BY created_at, id`,
    [projectId],
  );

  return rows.map((row) => {
    const attempts = parseAttempts(row.attempt_records);
    const ordered = [...attempts].sort((a, b) => a.attempt - b.attempt);
    const models = ordered.map((a) => a.model_id);
    const distinctModels = new Set(models);
    return {
      call_id: row.id,
      job_id: row.job_id,
      role: row.role,
      status: row.status,
      cost_cents: cents(row.cost_cents),
      attributed_cents: ordered.reduce((sum, a) => sum + cents(a.cost_cents), 0),
      // A call with no recorded attempts still involved one actual provider attempt; treating it as
      // zero would under-report the attempt count for every pre-0011 row.
      attempts: ordered.length === 0 ? 1 : ordered.length,
      failed_attempts: ordered.filter((a) => a.outcome === 'failed').length,
      // A retry is more than one attempt. A fallback is more than one MODEL — recorded either by the
      // audit's own fallback column or visible in the attempt models themselves.
      retried: ordered.length > 1,
      fell_back: row.fallback_from_model_id !== null || distinctModels.size > 1,
      models,
      usage_unknown: !hasUsableUsage(row.usage),
    };
  });
}

/**
 * Aggregate cost by one dimension.
 *
 * Grouping happens in SQL for the counts that SQL can compute exactly, and attempt-derived figures are
 * folded in from the per-call accounting — because an attempt count cannot be derived from the call row
 * alone, and a jsonb-array length summed in SQL would silently treat a pre-0011 row as zero attempts.
 */
export async function costSummary(
  db: Queryable,
  projectId: string,
  dimension: CostDimensionName,
  options: {
    readonly basis?: CostBasis | undefined;
    readonly since?: Date | undefined;
    readonly until?: Date | undefined;
  } = {},
): Promise<CostSummary> {
  const column = DIMENSION_COLUMN[dimension];
  const { rows } = await db.query<{
    group_key: string | null;
    call_ids: string[];
    calls: string;
    cost_cents: string;
  }>(
    `SELECT ${column} AS group_key,
            array_agg(id::text) AS call_ids,
            count(*)::text AS calls,
            coalesce(sum(cost_cents), 0)::text AS cost_cents
       FROM llm_calls
      WHERE project_id = $1
        AND ($2::timestamptz IS NULL OR created_at >= $2)
        AND ($3::timestamptz IS NULL OR created_at < $3)
      GROUP BY ${column}
      ORDER BY coalesce(sum(cost_cents), 0) DESC, 1
      LIMIT 500`,
    [projectId, options.since ?? null, options.until ?? null],
  );

  const perCall = new Map(
    (await callAccounting(db, projectId)).map((c) => [c.call_id, c] as const),
  );
  const items: CostDimension[] = rows.map((row) => {
    const calls = row.call_ids.map((id) => perCall.get(id)).filter((c): c is CallAccounting => !!c);
    return {
      key: row.group_key,
      calls: Number(row.calls),
      attempts: calls.reduce((sum, c) => sum + c.attempts, 0),
      cost_cents: cents(row.cost_cents),
      retried_calls: calls.filter((c) => c.retried).length,
      fallback_calls: calls.filter((c) => c.fell_back).length,
      usage_unknown_calls: calls.filter((c) => c.usage_unknown).length,
    };
  });

  return {
    // Defaults to the only basis this repository can actually observe. A caller claiming
    // `recorded_live` must have made a live call, which no code path here can.
    basis: options.basis ?? 'recorded_replay',
    currency: COST_CURRENCY,
    unit: COST_UNIT,
    total_cost_cents: items.reduce((sum, i) => sum + i.cost_cents, 0),
    calls: items.reduce((sum, i) => sum + i.calls, 0),
    attempts: items.reduce((sum, i) => sum + i.attempts, 0),
    dimension,
    items,
  };
}

export interface AccountingViolation {
  readonly id: string;
  readonly detail: string;
}

/**
 * Check the invariants that make a cost figure trustworthy, and return every violation.
 *
 * This is a QUERY, not a test helper: the same function backs the deterministic suite and can be run
 * against any project's audit, which is what makes "the dashboard traces to audit rows" checkable rather
 * than asserted.
 */
export async function verifyCostInvariants(
  db: Queryable,
  projectId: string,
): Promise<AccountingViolation[]> {
  const violations: AccountingViolation[] = [];
  const calls = await callAccounting(db, projectId);

  for (const call of calls) {
    // Every ACTUAL attempt must be attributable once provenance exists.
    if (call.attempts < 1) violations.push({ id: 'attempt_count_below_one', detail: call.call_id });
    // Attribution must reconstruct the authoritative total, never exceed or duplicate it.
    if (call.models.length > 0 && call.attributed_cents !== call.cost_cents)
      violations.push({
        id: 'attribution_does_not_match_total',
        detail: `${call.call_id}:${String(call.attributed_cents)}!=${String(call.cost_cents)}`,
      });
    // A fallback must be visible as such, not hidden behind a single-model row.
    if (call.status === 'fallback_succeeded' && !call.fell_back)
      violations.push({ id: 'fallback_not_visible', detail: call.call_id });
    // A failed attempt that charged cost is possible; a SUCCEEDED call with negative cost is not.
    if (call.cost_cents < 0) violations.push({ id: 'negative_cost', detail: call.call_id });
  }

  // The audit is append-only, so a duplicate idempotency key within a project would mean the same
  // logical call was charged twice — the resume/replay double-charge this invariant exists to catch.
  const { rows } = await db.query<{ idempotency_key: string; n: string }>(
    `SELECT idempotency_key, count(*)::text AS n FROM llm_calls
      WHERE project_id = $1 GROUP BY idempotency_key HAVING count(*) > 1`,
    [projectId],
  );
  for (const row of rows)
    violations.push({ id: 'duplicate_charge_for_idempotency_key', detail: row.n });

  return violations;
}
