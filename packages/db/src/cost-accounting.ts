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
 * MONEY IS MILLICENTS INTERNALLY, CENTS AT THE BOUNDARY. This is the correction that matters: the gateway
 * computes cost as `(tokens × pricePerMTokCents) / 1_000_000`, which is FRACTIONAL — a replay-priced call
 * costs `0.3` cents — and `llm_calls.cost_cents` is an unconstrained `numeric` that stores it exactly. An
 * earlier version of this module parsed only the integral part, so every sub-cent call reported as zero
 * and a 1000-call run reported 0 instead of 300. Values are therefore scaled to integer MILLICENTS
 * (cents × 1000) before any arithmetic, summed as integers so no float drift can accumulate, and exposed
 * in both forms: `*_millicents` is the exact integer, `*_cents` is the human-facing decimal derived from
 * it. Nothing is truncated on the way in.
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
 * Integer scale for exact arithmetic. The gateway's price table is per-million-tokens in cents, so a
 * single call's cost can carry three decimal places; millicents represent that exactly as an integer.
 */
export const COST_SCALE = 1000 as const;

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
  /** Authoritative total for the call. Exact integer millicents (cents × 1000). */
  readonly cost_millicents: number;
  /** The same value in cents, derived from `cost_millicents`. May be fractional; never truncated. */
  readonly cost_cents: number;
  /** Sum of the per-attempt attributions, in millicents. Must equal `cost_millicents`. */
  readonly attributed_millicents: number;
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
  /** Exact integer millicents. The authoritative figure for arithmetic and comparison. */
  readonly cost_millicents: number;
  /** Derived from `cost_millicents`; may be fractional because sub-cent calls are real. */
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
  /** Exact integer millicents; `total_cost_cents` is derived from it. */
  readonly total_cost_millicents: number;
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

/**
 * Exact integer millicents from a PostgreSQL `numeric`, which node-postgres returns as a string.
 *
 * The gateway's cost is fractional (`0.3` cents for a replay-priced call), so parsing only the integral
 * part would report every sub-cent call as zero — the defect this function exists to prevent. Parsing is
 * done on the decimal STRING rather than via `Number`, so no float rounding occurs: the fractional digits
 * are padded or truncated to exactly three places and folded into an integer.
 *
 * A value with more than three decimal places is rounded half-up at the millicent, which is the smallest
 * unit this system represents; that is a deliberate, documented quantization rather than silent loss.
 */
function toMillicents(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (text === '' || text === '-') return 0;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fractionRaw = dot === -1 ? '' : unsigned.slice(dot + 1);
  // Four digits so the fourth can decide a half-up rounding at the third.
  const fraction = `${fractionRaw}0000`.slice(0, 4);
  const scaled =
    BigInt(whole === '' ? '0' : whole) * BigInt(COST_SCALE) + BigInt(fraction.slice(0, 3));
  const rounded = Number(fraction[3]) >= 5 ? scaled + 1n : scaled;
  return Number(negative ? -rounded : rounded);
}

/** Millicents rendered back as a cents number for human-facing output. */
function millicentsToCents(millicents: number): number {
  return millicents / COST_SCALE;
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
      cost_millicents: toMillicents(row.cost_cents),
      cost_cents: millicentsToCents(toMillicents(row.cost_cents)),
      attributed_millicents: ordered.reduce((sum, a) => sum + toMillicents(a.cost_cents), 0),
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
      cost_millicents: toMillicents(row.cost_cents),
      cost_cents: millicentsToCents(toMillicents(row.cost_cents)),
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
    total_cost_millicents: items.reduce((sum, i) => sum + i.cost_millicents, 0),
    // Derived from the exact integer sum, so a long run cannot accumulate float drift.
    total_cost_cents: millicentsToCents(items.reduce((sum, i) => sum + i.cost_millicents, 0)),
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
    if (call.models.length > 0 && call.attributed_millicents !== call.cost_millicents)
      violations.push({
        id: 'attribution_does_not_match_total',
        detail:
          `${call.call_id}:${String(call.attributed_millicents)}!=` + String(call.cost_millicents),
      });
    // A fallback must be visible as such, not hidden behind a single-model row.
    if (call.status === 'fallback_succeeded' && !call.fell_back)
      violations.push({ id: 'fallback_not_visible', detail: call.call_id });
    // A failed attempt that charged cost is possible; a SUCCEEDED call with negative cost is not.
    if (call.cost_millicents < 0) violations.push({ id: 'negative_cost', detail: call.call_id });
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
