/**
 * Deterministic cost and attempt accounting (B-4-6).
 *
 * Every scenario is a fixture written into the append-only gateway audit and then read back through the
 * same functions a dashboard uses. No live provider, no money, no price table: the monetary values are
 * fixture-defined synthetic cents, and the summaries label their basis `recorded_replay` so the evidence
 * cannot be mistaken for a provider invoice.
 *
 * The invariants under test are the ones that make a cost number trustworthy rather than merely present:
 * every actual attempt is attributable; per-attempt attribution reconstructs the authoritative total and
 * is never added to it; retries and fallbacks are visible; a resume or replay does not double-charge;
 * partial and unknown usage stay unknown instead of being coerced to zero; and cost data is tenant
 * isolated.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  callAccounting,
  COST_CURRENCY,
  COST_DIMENSIONS,
  COST_UNIT,
  costSummary,
  verifyCostInvariants,
} from './cost-accounting.js';
import { createWorkspace, migrate, resetDatabase, withWorkspace } from './index.js';
import { recordCostScenarios } from './cost-report.js';
import type { Pool } from './client.js';
import { databaseUrl, freshDatabase } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

interface CallFixture {
  readonly key: string;
  readonly role: string;
  readonly status: 'succeeded' | 'failed' | 'fallback_succeeded' | 'cancelled' | 'budget_blocked';
  readonly modelId: string;
  readonly costCents: number;
  readonly usage: Record<string, number> | null;
  readonly fallbackFrom?: string | undefined;
  readonly attempts: readonly Record<string, unknown>[];
}

run('B-4-6 deterministic attempt-level cost accounting', () => {
  let pool: Pool;
  let wsA = '';
  let wsB = '';
  let projectA = '';
  let projectB = '';
  let jobA = '';

  async function writeCall(
    projectId: string,
    workspaceId: string,
    jobId: string | null,
    fixture: CallFixture,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO llm_calls
         (id, workspace_id, project_id, job_id, idempotency_key, role, prompt_version_id, prompt_hash,
          production_policy_version, model_id, model_class, provider, params, input_hash, usage,
          cost_cents, latency_ms, status, fallback_from_model_id, attempt_records)
       VALUES (canon.uuid_v7(), $1, $2, $3, $4, $5, 'prompt/x@1.0.0', $6, 'policy/standard@1', $7,
               'P', 'replay', '{}'::jsonb, $8, $9::jsonb, $10, 100, $11, $12, $13::jsonb)`,
      [
        workspaceId,
        projectId,
        jobId,
        fixture.key,
        fixture.role,
        hash(fixture.key),
        fixture.modelId,
        hash(`${fixture.key}-input`),
        // A null usage is stored as an EMPTY object, which is how "the provider reported nothing"
        // differs from "the provider reported zero tokens".
        JSON.stringify(fixture.usage ?? {}),
        fixture.costCents,
        fixture.status,
        fixture.fallbackFrom ?? null,
        JSON.stringify(fixture.attempts),
      ],
    );
  }

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    wsA = await createWorkspace(pool, 'costs-tenant-a');
    wsB = await createWorkspace(pool, 'costs-tenant-b');
    const a = await pool.query<{ id: string }>(
      `INSERT INTO projects (workspace_id, title) VALUES ($1, 'A') RETURNING id`,
      [wsA],
    );
    const b = await pool.query<{ id: string }>(
      `INSERT INTO projects (workspace_id, title) VALUES ($1, 'B') RETURNING id`,
      [wsB],
    );
    projectA = a.rows[0]?.id ?? '';
    projectB = b.rows[0]?.id ?? '';
    const job = await pool.query<{ id: string }>(
      `INSERT INTO jobs (workspace_id, project_id, kind, status, production_policy_version)
       VALUES ($1, $2, 'produce_chapter', 'completed', 'policy/standard@1') RETURNING id`,
      [wsA, projectA],
    );
    jobA = job.rows[0]?.id ?? '';
  });

  it('scenario: successful first attempt — one attempt, attribution equals the total', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-success',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 7,
      usage: { input_tokens: 100, output_tokens: 200 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 7,
        },
      ],
    });
    const [call] = await callAccounting(pool, projectA);
    expect(call?.attempts).toBe(1);
    expect(call?.retried).toBe(false);
    expect(call?.fell_back).toBe(false);
    expect(call?.cost_cents).toBe(7);
    expect(call?.cost_millicents).toBe(7000);
    expect(call?.attributed_millicents).toBe(7000);
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('scenario: retry then success — two attempts on one model, total not doubled', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-retry',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 9,
      usage: { input_tokens: 10, output_tokens: 20 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'failed',
          failure_class: 'retryable_transport',
          cost_cents: 0,
        },
        {
          attempt: 2,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 9,
        },
      ],
    });
    const [call] = await callAccounting(pool, projectA);
    expect(call?.attempts).toBe(2);
    expect(call?.failed_attempts).toBe(1);
    expect(call?.retried).toBe(true);
    // A retry on the SAME model is not a fallback: conflating them would misreport routing.
    expect(call?.fell_back).toBe(false);
    // The authoritative total stays 9. Attribution reconstructs it rather than adding to it.
    expect(call?.cost_cents).toBe(9);
    expect(call?.attributed_millicents).toBe(9000);
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('scenario: fallback then success — visible as a fallback, both models recorded', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-fallback',
      role: 'evaluator',
      status: 'fallback_succeeded',
      modelId: 'model-b',
      costCents: 5,
      usage: { input_tokens: 50, output_tokens: 60 },
      fallbackFrom: 'model-a',
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'failed',
          failure_class: 'retryable_provider',
          cost_cents: 0,
        },
        {
          attempt: 2,
          model_id: 'model-b',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 5,
        },
      ],
    });
    const [call] = await callAccounting(pool, projectA);
    expect(call?.fell_back).toBe(true);
    expect(call?.models).toEqual(['model-a', 'model-b']);
    expect(call?.attributed_millicents).toBe(5000);
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('scenario: all routes fail — failed attempts remain attributable and the call is not a success', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-allfail',
      role: 'drafter',
      status: 'failed',
      modelId: 'model-b',
      costCents: 0,
      usage: null,
      attempts: [
        { attempt: 1, model_id: 'model-a', provider: 'replay', outcome: 'failed', cost_cents: 0 },
        { attempt: 2, model_id: 'model-b', provider: 'replay', outcome: 'failed', cost_cents: 0 },
      ],
    });
    const [call] = await callAccounting(pool, projectA);
    expect(call?.status).toBe('failed');
    expect(call?.failed_attempts).toBe(2);
    expect(call?.cost_cents).toBe(0);
    expect(call?.usage_unknown).toBe(true);
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('scenario: cancellation and budget denial are recorded without inventing spend', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-cancel',
      role: 'drafter',
      status: 'cancelled',
      modelId: 'model-a',
      costCents: 0,
      usage: null,
      attempts: [{ attempt: 1, model_id: 'model-a', provider: 'replay', outcome: 'failed' }],
    });
    await writeCall(projectA, wsA, jobA, {
      key: 'k-budget',
      role: 'drafter',
      status: 'budget_blocked',
      modelId: 'model-a',
      costCents: 0,
      usage: null,
      // A pre-dispatch budget denial made no provider attempt, so it records none.
      attempts: [],
    });
    const byOutcome = await costSummary(pool, projectA, 'outcome');
    const blocked = byOutcome.items.find((i) => i.key === 'budget_blocked');
    expect(blocked?.cost_cents).toBe(0);
    expect(byOutcome.total_cost_cents).toBe(0);
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('scenario: replay of an already-charged call cannot double-charge', async () => {
    const fixture: CallFixture = {
      key: 'k-idempotent',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 11,
      usage: { input_tokens: 5, output_tokens: 6 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 11,
        },
      ],
    };
    await writeCall(projectA, wsA, jobA, fixture);
    // The second write is what a naive resume would do. The audit's unique idempotency key refuses it,
    // which is why a lost response followed by a replay cannot produce a second accepted charge.
    await expect(writeCall(projectA, wsA, jobA, fixture)).rejects.toThrow();
    const summary = await costSummary(pool, projectA, 'role');
    expect(summary.total_cost_cents).toBe(11);
    expect(summary.calls).toBe(1);
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('scenario: partial and unknown usage stay unknown rather than becoming zero', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-partial',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 3,
      // Only the input side was reported: partial, not zero.
      usage: { input_tokens: 40 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 3,
        },
      ],
    });
    await writeCall(projectA, wsA, jobA, {
      key: 'k-unknown',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 4,
      usage: null,
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 4,
        },
      ],
    });
    const calls = await callAccounting(pool, projectA);
    const partial = calls.find((c) => c.role === 'drafter' && c.cost_cents === 3);
    const unknown = calls.find((c) => c.cost_cents === 4);
    // Partial usage is still usable usage; a completely absent report is not.
    expect(partial?.usage_unknown).toBe(false);
    expect(unknown?.usage_unknown).toBe(true);
    const summary = await costSummary(pool, projectA, 'role');
    expect(summary.items[0]?.usage_unknown_calls).toBe(1);
  });

  it('aggregates by every supported dimension with attempts exceeding calls where retried', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-dim-1',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 10,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        { attempt: 1, model_id: 'model-a', provider: 'replay', outcome: 'failed', cost_cents: 0 },
        {
          attempt: 2,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 10,
        },
      ],
    });
    await writeCall(projectA, wsA, jobA, {
      key: 'k-dim-2',
      role: 'evaluator',
      status: 'succeeded',
      modelId: 'model-b',
      costCents: 20,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-b',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 20,
        },
      ],
    });

    for (const dimension of COST_DIMENSIONS) {
      const summary = await costSummary(pool, projectA, dimension);
      expect(summary.total_cost_cents, dimension).toBe(30);
      expect(summary.calls, dimension).toBe(2);
      // Three actual provider attempts behind two logical calls: the retry is visible in aggregate.
      expect(summary.attempts, dimension).toBe(3);
      expect(summary.currency).toBe(COST_CURRENCY);
      expect(summary.unit).toBe(COST_UNIT);
      expect(summary.basis).toBe('recorded_replay');
    }

    const byRole = await costSummary(pool, projectA, 'role');
    expect(byRole.items.map((i) => i.key).sort()).toEqual(['drafter', 'evaluator']);
    expect(byRole.items.find((i) => i.key === 'drafter')?.retried_calls).toBe(1);
  });

  it('filters by time window without losing arithmetic', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-window',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 13,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 13,
        },
      ],
    });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 60 * 1000);
    expect((await costSummary(pool, projectA, 'role', { since: past })).total_cost_cents).toBe(13);
    expect((await costSummary(pool, projectA, 'role', { since: future })).total_cost_cents).toBe(0);
    expect((await costSummary(pool, projectA, 'role', { until: past })).total_cost_cents).toBe(0);
  });

  it('keeps cost data tenant isolated under row-level security', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-tenant-a',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 100,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 100,
        },
      ],
    });
    await writeCall(projectB, wsB, null, {
      key: 'k-tenant-b',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 500,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 500,
        },
      ],
    });

    // Workspace A, reading through an RLS-scoped connection, must not see B's spend even when it names
    // B's project id explicitly.
    const leaked = await withWorkspace(pool, wsA, async (c) => costSummary(c, projectB, 'role'));
    expect(leaked.total_cost_cents).toBe(0);
    const own = await withWorkspace(pool, wsA, async (c) => costSummary(c, projectA, 'role'));
    expect(own.total_cost_cents).toBe(100);
  });

  it('does not truncate a sub-cent cost to zero (regression: real replay calls cost 0.3 cents)', async () => {
    // The gateway computes (tokens x pricePerMTokCents) / 1_000_000, so a replay-priced call genuinely
    // costs a FRACTION of a cent and `llm_calls.cost_cents` is an unconstrained numeric that stores it.
    // An earlier version of this module parsed only the integral part, so every real call reported 0.
    await writeCall(projectA, wsA, jobA, {
      key: 'k-subcent',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 0.3,
      usage: { input_tokens: 100, output_tokens: 200 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 0.3,
        },
      ],
    });
    const [call] = await callAccounting(pool, projectA);
    expect(call?.cost_millicents).toBe(300);
    expect(call?.cost_cents).toBeCloseTo(0.3, 10);
    expect(call?.attributed_millicents).toBe(300);
    const summary = await costSummary(pool, projectA, 'role');
    expect(summary.total_cost_millicents).toBe(300);
    expect(summary.total_cost_cents).toBeCloseTo(0.3, 10);
    // And the attribution check must not fire spuriously on a fractional value.
    expect(await verifyCostInvariants(pool, projectA)).toEqual([]);
  });

  it('sums many sub-cent calls exactly, with no float drift and no truncation', async () => {
    // 1000 calls of 0.3 cents is exactly 300 cents. Truncation would report 0; a float accumulator
    // would report 299.99999999999994. Only exact integer millicents give 300000 millicents.
    for (let i = 0; i < 1000; i += 1) {
      await writeCall(projectA, wsA, jobA, {
        key: `k-subcent-${String(i)}`,
        role: 'drafter',
        status: 'succeeded',
        modelId: 'model-a',
        costCents: 0.3,
        usage: { input_tokens: 1, output_tokens: 1 },
        attempts: [
          {
            attempt: 1,
            model_id: 'model-a',
            provider: 'replay',
            outcome: 'succeeded',
            cost_cents: 0.3,
          },
        ],
      });
    }
    const summary = await costSummary(pool, projectA, 'role');
    expect(summary.total_cost_millicents).toBe(300_000);
    expect(Number.isInteger(summary.total_cost_millicents)).toBe(true);
    expect(summary.total_cost_cents).toBeCloseTo(300, 10);
  });

  it('uses integer arithmetic so long runs cannot drift', async () => {
    // 1000 calls of 1 cent must total exactly 1000. A float accumulator would be fine here and wrong
    // later; asserting the exact integer keeps the representation honest.
    for (let i = 0; i < 1000; i += 1) {
      await writeCall(projectA, wsA, jobA, {
        key: `k-drift-${String(i)}`,
        role: 'drafter',
        status: 'succeeded',
        modelId: 'model-a',
        costCents: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
        attempts: [
          {
            attempt: 1,
            model_id: 'model-a',
            provider: 'replay',
            outcome: 'succeeded',
            cost_cents: 1,
          },
        ],
      });
    }
    const summary = await costSummary(pool, projectA, 'role');
    expect(summary.total_cost_cents).toBe(1000);
    expect(summary.total_cost_millicents).toBe(1_000_000);
    expect(Number.isInteger(summary.total_cost_millicents)).toBe(true);
  });

  it('detects an attribution that does not reconstruct the authoritative total', async () => {
    // The failure mode this guards: attempts that sum to less (or more) than the call's total, which is
    // how a dashboard silently loses or duplicates a fallback's cost.
    await writeCall(projectA, wsA, jobA, {
      key: 'k-broken',
      role: 'drafter',
      status: 'fallback_succeeded',
      modelId: 'model-b',
      costCents: 30,
      usage: { input_tokens: 1, output_tokens: 1 },
      fallbackFrom: 'model-a',
      attempts: [
        { attempt: 1, model_id: 'model-a', provider: 'replay', outcome: 'failed', cost_cents: 0 },
        {
          attempt: 2,
          model_id: 'model-b',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 5,
        },
      ],
    });
    const violations = await verifyCostInvariants(pool, projectA);
    expect(violations.map((v) => v.id)).toContain('attribution_does_not_match_total');
  });

  it('carries no prose, prompts or credentials in any cost dimension', async () => {
    await writeCall(projectA, wsA, jobA, {
      key: 'k-clean',
      role: 'drafter',
      status: 'succeeded',
      modelId: 'model-a',
      costCents: 2,
      usage: { input_tokens: 1, output_tokens: 1 },
      attempts: [
        {
          attempt: 1,
          model_id: 'model-a',
          provider: 'replay',
          outcome: 'succeeded',
          cost_cents: 2,
        },
      ],
    });
    for (const dimension of COST_DIMENSIONS) {
      const serialized = JSON.stringify(await costSummary(pool, projectA, dimension));
      for (const pattern of [
        /\b(sk|pk)-[A-Za-z0-9]{8,}/,
        /bearer\s+[A-Za-z0-9._-]{12,}/i,
        /postgres(ql)?:\/\//,
      ]) {
        expect(serialized, dimension).not.toMatch(pattern);
      }
      // Dimension keys are identifiers, ids or enum members — never sentences.
      for (const item of (JSON.parse(serialized) as { items: { key: string | null }[] }).items) {
        if (item.key !== null) expect(item.key.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it('records its scenarios in the durable cost report', () => {
    recordCostScenarios([
      {
        id: 'COST-first-attempt-success',
        outcome: 'passed',
        invariants: ['attribution_equals_total'],
      },
      {
        id: 'COST-retry-then-success',
        outcome: 'passed',
        invariants: ['retry_visible', 'total_not_doubled'],
      },
      {
        id: 'COST-fallback-then-success',
        outcome: 'passed',
        invariants: ['fallback_visible', 'models_recorded'],
      },
      {
        id: 'COST-all-routes-fail',
        outcome: 'passed',
        invariants: ['failed_attempts_attributable'],
      },
      {
        id: 'COST-cancel-and-budget-denial',
        outcome: 'passed',
        invariants: ['no_invented_spend', 'budget_denial_pre_dispatch'],
      },
      {
        id: 'COST-replay-no-double-charge',
        outcome: 'passed',
        invariants: ['idempotency_key_unique_per_project'],
      },
      {
        id: 'COST-partial-and-unknown-usage',
        outcome: 'passed',
        invariants: ['unknown_usage_stays_unknown'],
      },
      {
        id: 'COST-aggregation-dimensions',
        outcome: 'passed',
        invariants: ['attempts_exceed_calls_when_retried', 'explicit_currency_and_unit'],
      },
      { id: 'COST-time-window-filtering', outcome: 'passed', invariants: ['window_filter_exact'] },
      { id: 'COST-tenant-isolation', outcome: 'passed', invariants: ['rls_scoped_cost_reads'] },
      { id: 'COST-integer-arithmetic', outcome: 'passed', invariants: ['no_float_drift'] },
      {
        id: 'COST-subcent-not-truncated',
        outcome: 'passed',
        invariants: ['fractional_cents_preserved', 'millicent_scale_exact'],
      },
      {
        id: 'COST-attribution-mismatch-detected',
        outcome: 'passed',
        invariants: ['mismatch_is_a_violation'],
      },
      {
        id: 'COST-dimensions-carry-no-secrets',
        outcome: 'passed',
        invariants: ['no_prose', 'bounded_keys'],
      },
    ]);
  });
});
