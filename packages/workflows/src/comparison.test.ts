/**
 * B-6-4 unit proofs for the deterministic half of candidate comparison and patch regression: the pinned
 * policy supplies every number (ADR-0041), the tie ladder of ADR-0015 is total and order-independent, and
 * the regression rule of ADR-0014 is per gated dimension with the targeted dimension exempt.
 */
import { describe, expect, it } from 'vitest';
import { requirePolicy } from '@yeonjae/domain';
import { validatorFor } from '@yeonjae/domain';
import {
  breakTie,
  earlyStop,
  earlyStopDecision,
  patchRegression,
  smokeCheckDue,
  type Candidate,
  type ProductionPolicy,
} from './index.js';
import { type Scorecard } from './evaluation.js';

const POLICY = requirePolicy('policy/standard@1');

function scorecard(input: {
  prose: number;
  structure: number;
  autoApprovable?: boolean;
  blocking?: number;
  major?: number;
}): Scorecard {
  const dims: [string, number][] = [
    ['prose', input.prose],
    ['structure', input.structure],
  ];
  const card: Scorecard = {
    id: '0191b2a0-0000-7000-8000-00000000a001',
    manuscript_version_id: '0191b2a0-0000-7000-8000-00000000b001',
    canon_version: 3,
    overall: {
      score: (input.prose + input.structure) / 2,
      blocking_count: input.blocking ?? 0,
      major_count: input.major ?? 0,
      minor_count: 0,
    },
    sections: {
      prose: { score: input.prose, passed: input.prose >= 78 },
      structure: { score: input.structure, passed: input.structure >= 78 },
      // Required by the schema and never gated by the policy: it must stay out of the ladder and the
      // regression list, which is exactly what the "ignores ungated dimensions" case below proves.
      output_language: { score: 100, passed: true },
    },
    issues: [],
    acceptance: {
      criteria_results: [],
      dimension_results: dims.map(([dimension, score]) => ({
        dimension: dimension as 'prose',
        score,
        threshold: 78,
        passed: score >= 78,
      })),
      auto_approvable: input.autoApprovable ?? true,
      production_policy_version: 'policy/standard@1',
      gate_outcome: 'approved',
    },
  };
  // The fixtures below are asserted against the real schema so a drifting scorecard shape fails here too.
  const v = validatorFor<Scorecard>('scorecard.schema.json')(card);
  if (!v.ok) throw new Error(`test scorecard invalid: ${JSON.stringify(v.errors)}`);
  return v.value;
}

function candidate(
  slot: number,
  input: { prose: number; structure: number; patchCount?: number; autoApprovable?: boolean },
): Candidate {
  return {
    slot,
    id: `0191b2a0-0000-7000-8000-0000000c100${slot}`,
    text: `candidate ${slot}`,
    scorecard: scorecard(input),
    patchCount: input.patchCount ?? 0,
  };
}

describe('candidate comparison determinism (ADR-0015)', () => {
  it('early stop needs every gated dimension of the pinned policy, and standard.v1 gates two the evaluator does not produce', () => {
    const margin = POLICY.candidates.early_stop_margin_points;
    const proseGate = POLICY.gates.dimensions.prose.min_score;
    const structureGate = POLICY.gates.dimensions.structure.min_score;
    expect(margin).toBeGreaterThan(0);

    // Real policy/runtime mismatch, asserted rather than hidden: standard.v1 gates genre and voice, which
    // the Checkpoint 5 evaluator never scores. A missing judge must never read as a silent pass, so early
    // stop refuses and names the gap instead of stopping generation on partial evidence.
    const high = candidate(1, { prose: proseGate + margin, structure: structureGate + margin });
    const decision = earlyStopDecision(POLICY, high);
    expect(decision.stop).toBe(false);
    expect(decision.reason).toBe('dimensions_short');
    expect(decision.missingDimensions).toEqual(['genre', 'voice']);
    expect(decision.shortDimensions).toEqual([]);
    expect(earlyStop(POLICY, high)).toBe(false);

    // With a policy that gates only the dimensions the evaluator produces, the same candidate clears.
    const wiredOnly = {
      ...POLICY,
      gates: {
        ...POLICY.gates,
        dimensions: {
          prose: POLICY.gates.dimensions.prose,
          structure: POLICY.gates.dimensions.structure,
        },
      },
    } as ProductionPolicy;
    expect(earlyStopDecision(wiredOnly, high)).toMatchObject({ stop: true, reason: 'cleared' });

    // Exactly one point short on one dimension is not an early stop: gates are per dimension, never averaged.
    const oneShort = candidate(1, {
      prose: proseGate + margin - 1,
      structure: 100,
    });
    expect(earlyStopDecision(wiredOnly, oneShort)).toMatchObject({
      stop: false,
      reason: 'dimensions_short',
      shortDimensions: ['prose'],
    });

    // A major issue defeats early stop even with high scores.
    expect(
      earlyStopDecision(wiredOnly, {
        ...high,
        scorecard: scorecard({
          prose: proseGate + margin,
          structure: structureGate + margin,
          major: 1,
          autoApprovable: false,
        }),
      }),
    ).toMatchObject({ stop: false, reason: 'not_auto_approvable' });
  });

  it('a gated dimension absent from the scorecard is reported, never treated as cleared', () => {
    const partial = candidate(1, { prose: 100, structure: 100 });
    const stripped: Candidate = {
      ...partial,
      scorecard: {
        ...partial.scorecard,
        sections: {
          prose: { score: 100, passed: true },
          output_language: { score: 100, passed: true },
        },
      } as Scorecard,
    };
    expect(earlyStop(POLICY, stripped)).toBe(false);
  });

  it('the tie ladder is scorecard sum, then fewer patches, then the lower slot — and is symmetric', () => {
    const strong = candidate(1, { prose: 90, structure: 90 });
    const weak = candidate(2, { prose: 80, structure: 80 });
    expect(breakTie(POLICY, strong, weak)).toEqual({
      winnerId: strong.id,
      reason: 'tiebreak_scorecard',
    });
    // Swapping the arguments must not change the winner: the ladder cannot depend on call order.
    expect(breakTie(POLICY, weak, strong).winnerId).toBe(strong.id);

    const sameScoreFewPatches = candidate(1, { prose: 85, structure: 85, patchCount: 1 });
    const sameScoreManyPatches = candidate(2, { prose: 85, structure: 85, patchCount: 3 });
    expect(breakTie(POLICY, sameScoreManyPatches, sameScoreFewPatches)).toEqual({
      winnerId: sameScoreFewPatches.id,
      reason: 'tiebreak_patch_count',
    });

    const identicalA = candidate(1, { prose: 85, structure: 85, patchCount: 2 });
    const identicalB = candidate(2, { prose: 85, structure: 85, patchCount: 2 });
    expect(breakTie(POLICY, identicalB, identicalA)).toEqual({
      winnerId: identicalA.id,
      reason: 'tiebreak_candidate_slot',
    });
  });

  it('the scorecard tie-break sums gated dimensions and ignores overall.score', () => {
    // Same gated dimensions, deliberately contradictory informational aggregate: overall.score is never
    // a gate input (ADR-0041), so the pair must fall through to the next rung.
    const a = candidate(1, { prose: 85, structure: 85, patchCount: 1 });
    const b: Candidate = {
      ...candidate(2, { prose: 85, structure: 85, patchCount: 2 }),
      scorecard: {
        ...scorecard({ prose: 85, structure: 85 }),
        overall: { score: 100, blocking_count: 0, major_count: 0, minor_count: 0 },
      },
    };
    expect(breakTie(POLICY, a, b)).toEqual({ winnerId: a.id, reason: 'tiebreak_patch_count' });
  });
});

describe('patch regression (ADR-0014)', () => {
  const tolerance = POLICY.revision.regression_tolerance_points ?? 0;

  it('passes when the targeted dimension improves and the other holds within tolerance', () => {
    const report = patchRegression(POLICY, {
      before: scorecard({ prose: 70, structure: 88 }),
      after: scorecard({ prose: 84, structure: 88 - tolerance }),
      dimension: 'prose',
    });
    expect(report.passed).toBe(true);
    expect(report.targetedImproved).toBe(true);
    expect(report.regressions).toEqual([]);
    expect(report.tolerancePoints).toBe(tolerance);
  });

  it('fails when repairing prose costs structure more than the pinned tolerance', () => {
    const report = patchRegression(POLICY, {
      before: scorecard({ prose: 70, structure: 88 }),
      after: scorecard({ prose: 90, structure: 88 - tolerance - 1 }),
      dimension: 'prose',
    });
    expect(report.passed).toBe(false);
    expect(report.regressions.map((r) => r.dimension)).toEqual(['structure']);
    expect(report.regressions[0]?.delta).toBe(-(tolerance + 1));
  });

  it('never reports the targeted dimension as a regression, but shows a patch that repaired nothing', () => {
    const report = patchRegression(POLICY, {
      before: scorecard({ prose: 90, structure: 85 }),
      after: scorecard({ prose: 60, structure: 85 }),
      dimension: 'prose',
    });
    expect(report.regressions).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.targetedImproved).toBe(false);
    expect(report.deltas.find((d) => d.dimension === 'prose')?.delta).toBe(-30);
  });

  it('a policy without a tolerance treats any drop as a regression rather than unlimited', () => {
    const noTolerance = {
      ...POLICY,
      revision: { ...POLICY.revision, regression_tolerance_points: undefined },
    } as ProductionPolicy;
    const report = patchRegression(noTolerance, {
      before: scorecard({ prose: 70, structure: 88 }),
      after: scorecard({ prose: 84, structure: 87 }),
      dimension: 'prose',
    });
    expect(report.tolerancePoints).toBe(0);
    expect(report.passed).toBe(false);
    expect(report.regressions.map((r) => r.dimension)).toEqual(['structure']);
  });

  it('ignores dimensions the policy does not gate', () => {
    const report = patchRegression(POLICY, {
      before: scorecard({ prose: 80, structure: 80 }),
      after: scorecard({ prose: 80, structure: 80 }),
      dimension: 'prose',
    });
    // standard.v1 gates prose, structure, genre and voice; only the two the scorecard carries appear.
    expect(report.deltas.map((d) => d.dimension)).toEqual(['prose', 'structure']);
  });

  it('smoke checks fall due on every Nth patch from the pinned policy', () => {
    const every = POLICY.revision.smoke_after_patches;
    expect(every).toBeGreaterThan(0);
    expect(smokeCheckDue(POLICY, 0)).toBe(false);
    expect(smokeCheckDue(POLICY, every)).toBe(true);
    expect(smokeCheckDue(POLICY, every * 2)).toBe(true);
    expect(smokeCheckDue(POLICY, every + 1)).toBe(false);
  });
});
