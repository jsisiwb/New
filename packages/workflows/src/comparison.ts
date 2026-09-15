/**
 * Candidate comparison and patch-regression checks (Checkpoint 6, B-6-4; ADR-0015, ADR-0014).
 *
 * Comparison (ADR-0015): two candidates for the same locked contract are judged pairwise in BOTH
 * presentation orders by `chapter_comparator`. A consistent winner wins. An inconsistent pair (the judge
 * preferred whichever text sat in position A, or flipped) is position bias and is never silently resolved:
 * a third run with a shuffled rubric order decides it. Remaining ties fall to the deterministic ladder —
 * higher scorecard first, then fewer patches, then the lower candidate slot — so the outcome never depends
 * on call order. `earlyStop` skips further candidates when the first is auto-approvable and clears every
 * gated dimension by the pinned margin (never an aggregate score; ADR-0041).
 *
 * Patch regression (ADR-0014): a dimension-targeted patch may not pay for its own dimension with another
 * one. `patchRegression` compares the gated dimension scores before and after a patch and reports any
 * non-targeted dimension that fell by more than `policy.revision.regression_tolerance_points`.
 *
 * The predicates take the pinned Production Policy rather than the whole workflow context: they are pure
 * functions of policy + scorecards, and the numbers always come from the policy (ADR-0041).
 */
import { type Generated } from '@yeonjae/domain';
import { type Issue, type Scorecard } from './evaluation.js';
import { WorkflowError } from './errors.js';
import { modelCall, saveArtifact, type ProductionPolicy, type WorkflowContext } from './runtime.js';

export type ComparisonVerdict = Generated.ComparisonVerdictSchema.ComparisonVerdict;

/**
 * One chapter candidate. `slot` is the candidate's generation slot (1-based) and is what activity ids and
 * tie-breaks use, so a replayed comparison is keyed deterministically and never by a runtime UUID.
 */
export interface Candidate {
  readonly slot: number;
  readonly id: string;
  readonly text: string;
  readonly scorecard: Scorecard;
  readonly patchCount: number;
}

export type ComparisonReason =
  | 'consistent'
  | 'tiebreak_shuffled_rubric'
  | 'tiebreak_scorecard'
  | 'tiebreak_patch_count'
  | 'tiebreak_candidate_slot';

export interface ComparisonOutcome {
  readonly winnerId: string;
  readonly loserId: string;
  readonly reason: ComparisonReason;
  /** True when the two presentation orders disagreed — the position-bias signal of ADR-0015. */
  readonly positionBiasDetected: boolean;
  readonly verdicts: readonly ComparisonVerdict[];
  readonly verdictArtifactIds: readonly string[];
}

/** The dimensions a chapter comparison judges, in the canonical order (subset of the schema enum). */
export const CHAPTER_COMPARISON_DIMENSIONS = [
  'contract_fit',
  'hook',
  'pacing',
  'emotional_impact',
  'english_prose_quality',
  'serialized_structure',
  'continuity_risk',
] as const;

/** Gated dimensions come from the pinned policy, never from a hardcoded list (ADR-0041). */
function gatedDimensions(policy: ProductionPolicy): readonly string[] {
  return Object.keys(policy.gates.dimensions).sort();
}

function sectionScore(scorecard: Scorecard, dimension: string): number | undefined {
  const sections = scorecard.sections as Record<string, { score?: number } | undefined>;
  return sections[dimension]?.score;
}

export interface EarlyStopDecision {
  readonly stop: boolean;
  /** Gated dimensions the scorecard does not carry — these can never count as cleared. */
  readonly missingDimensions: readonly string[];
  /** Gated dimensions present but short of threshold + margin. */
  readonly shortDimensions: readonly string[];
  readonly marginPoints: number;
  readonly reason: 'cleared' | 'not_auto_approvable' | 'open_issues' | 'dimensions_short';
}

/**
 * ADR-0015 early stop: a candidate ends generation only when it is auto-approvable with no
 * blocking/major issues AND every gated dimension clears its threshold by the pinned margin. A gated
 * dimension the scorecard does not carry is never treated as cleared — that would turn a missing judge
 * into a silent pass — so the decision reports it instead.
 *
 * Note (real mismatch, not a defect of this function): `standard.v1` gates `genre` and `voice`, which the
 * Checkpoint 5 evaluator does not yet produce. Under that policy `earlyStop` therefore reports
 * `missingDimensions` and refuses to stop until those judges are wired. See the progress document.
 */
export function earlyStopDecision(
  policy: ProductionPolicy,
  candidate: Candidate,
): EarlyStopDecision {
  const margin = policy.candidates.early_stop_margin_points;
  const dims = Object.entries(policy.gates.dimensions);
  const missing: string[] = [];
  const short: string[] = [];
  for (const [name, gate] of dims) {
    const score = sectionScore(candidate.scorecard, name);
    if (score === undefined) missing.push(name);
    else if (score < gate.min_score + margin) short.push(name);
  }
  const base = { missingDimensions: missing, shortDimensions: short, marginPoints: margin };
  if (!candidate.scorecard.acceptance.auto_approvable)
    return { stop: false, ...base, reason: 'not_auto_approvable' };
  if (candidate.scorecard.overall.blocking_count > 0 || candidate.scorecard.overall.major_count > 0)
    return { stop: false, ...base, reason: 'open_issues' };
  if (dims.length === 0 || missing.length > 0 || short.length > 0)
    return { stop: false, ...base, reason: 'dimensions_short' };
  return { stop: true, ...base, reason: 'cleared' };
}

export function earlyStop(policy: ProductionPolicy, candidate: Candidate): boolean {
  return earlyStopDecision(policy, candidate).stop;
}

/** Deterministic ladder for a pair the judge could not separate (ADR-0015): scorecard → patches → slot. */
export function breakTie(
  policy: ProductionPolicy,
  a: Candidate,
  b: Candidate,
): { winnerId: string; reason: ComparisonReason } {
  // "Higher scorecard" is the sum over gated dimensions — never `overall.score`, which is not a gate input.
  const total = (c: Candidate) =>
    gatedDimensions(policy).reduce((sum, d) => sum + (sectionScore(c.scorecard, d) ?? 0), 0);
  const ta = total(a);
  const tb = total(b);
  if (ta !== tb) return { winnerId: ta > tb ? a.id : b.id, reason: 'tiebreak_scorecard' };
  if (a.patchCount !== b.patchCount)
    return { winnerId: a.patchCount < b.patchCount ? a.id : b.id, reason: 'tiebreak_patch_count' };
  return { winnerId: a.slot < b.slot ? a.id : b.id, reason: 'tiebreak_candidate_slot' };
}

function preferredId(verdict: ComparisonVerdict): string | undefined {
  if (verdict.overall_preference === 'tie') return undefined;
  return verdict.overall_preference === 'a' ? verdict.candidate_a_id : verdict.candidate_b_id;
}

function validateVerdict(
  verdict: ComparisonVerdict,
  expected: { aId: string; bId: string; order: 'ab' | 'ba' },
): void {
  if (verdict.candidate_a_id !== expected.aId || verdict.candidate_b_id !== expected.bId)
    throw new WorkflowError(
      'EVALUATION_FAILED',
      `comparison verdict names candidates ${verdict.candidate_a_id}/${verdict.candidate_b_id}, expected ${expected.aId}/${expected.bId}`,
      { step: 'compare', recommendedActions: ['regenerate'] },
    );
  if (verdict.presentation_order !== expected.order)
    throw new WorkflowError(
      'EVALUATION_FAILED',
      `comparison verdict reports order ${verdict.presentation_order}, expected ${expected.order}`,
      { step: 'compare', recommendedActions: ['regenerate'] },
    );
}

/** Scorecards reach the judge as evidence, not as prose: gate-relevant numbers and counts only. */
function scorecardDigest(scorecard: Scorecard): Record<string, unknown> {
  const sections = scorecard.sections as Record<string, { score?: number } | undefined>;
  return {
    dimension_scores: Object.fromEntries(
      Object.entries(sections)
        .filter(([, s]) => s?.score !== undefined)
        .map(([name, s]) => [name, s?.score]),
    ),
    blocking_count: scorecard.overall.blocking_count,
    major_count: scorecard.overall.major_count,
    minor_count: scorecard.overall.minor_count,
    auto_approvable: scorecard.acceptance.auto_approvable,
  };
}

async function judgePair(
  ctx: WorkflowContext,
  input: {
    chapterNo: number;
    first: Candidate;
    second: Candidate;
    order: 'ab' | 'ba';
    contractShape: string;
    rubricOrder: readonly string[];
    activitySuffix: string;
  },
): Promise<{ verdict: ComparisonVerdict; artifactId: string }> {
  const call = await modelCall<ComparisonVerdict>(ctx, {
    step: 'compare',
    family: 'chapter_comparator',
    activityId: `compare:${input.chapterNo}:${input.activitySuffix}`,
    variables: {
      contract_shape: input.contractShape,
      presentation_order: input.order,
      rubric_order: input.rubricOrder.join(', '),
      candidate_a: input.first.text,
      candidate_b: input.second.text,
      scorecard_a: JSON.stringify(scorecardDigest(input.first.scorecard)),
      scorecard_b: JSON.stringify(scorecardDigest(input.second.scorecard)),
    },
  });
  const verdict: ComparisonVerdict = { ...call.output, judge_call_id: call.llmCallId };
  validateVerdict(verdict, { aId: input.first.id, bId: input.second.id, order: input.order });
  const ref = await saveArtifact(ctx, {
    step: 'compare',
    kind: 'comparison_verdict',
    key: `${input.chapterNo}:${input.activitySuffix}`,
    schema: 'comparison-verdict.schema.json',
    payload: verdict,
  });
  return { verdict, artifactId: ref.artifact_id };
}

/**
 * Compare two candidates in both presentation orders (ADR-0015). Disagreement between the orders is
 * position bias: it is recorded and resolved by a third run with a shuffled rubric order, never by
 * trusting whichever verdict came first.
 */
export async function compareCandidates(
  ctx: WorkflowContext,
  input: { chapterNo: number; contractShape: string; a: Candidate; b: Candidate },
): Promise<ComparisonOutcome> {
  const { a, b } = input;
  if (a.id === b.id || a.slot === b.slot)
    throw new WorkflowError(
      'INTERNAL',
      `compareCandidates needs two distinct candidates (slots ${a.slot}/${b.slot})`,
      { step: 'compare' },
    );
  const pair = `s${a.slot}s${b.slot}`;
  const rubric = [...CHAPTER_COMPARISON_DIMENSIONS];
  const ab = await judgePair(ctx, {
    chapterNo: input.chapterNo,
    first: a,
    second: b,
    order: 'ab',
    contractShape: input.contractShape,
    rubricOrder: rubric,
    activitySuffix: `${pair}:ab`,
  });
  const ba = await judgePair(ctx, {
    chapterNo: input.chapterNo,
    first: b,
    second: a,
    order: 'ba',
    contractShape: input.contractShape,
    rubricOrder: rubric,
    activitySuffix: `${pair}:ba`,
  });
  const firstPick = preferredId(ab.verdict);
  const secondPick = preferredId(ba.verdict);
  const verdicts = [ab.verdict, ba.verdict];
  const artifacts = [ab.artifactId, ba.artifactId];

  if (firstPick !== undefined && firstPick === secondPick)
    return {
      winnerId: firstPick,
      loserId: firstPick === a.id ? b.id : a.id,
      reason: 'consistent',
      positionBiasDetected: false,
      verdicts,
      verdictArtifactIds: artifacts,
    };

  // Both orders tied: nothing to resolve, straight to the deterministic ladder.
  if (firstPick === undefined && secondPick === undefined) {
    const tie = breakTie(ctx.policy, a, b);
    return {
      winnerId: tie.winnerId,
      loserId: tie.winnerId === a.id ? b.id : a.id,
      reason: tie.reason,
      positionBiasDetected: false,
      verdicts,
      verdictArtifactIds: artifacts,
    };
  }

  // Inconsistent: the orders disagree (or exactly one tied). Third run, shuffled rubric order.
  const third = await judgePair(ctx, {
    chapterNo: input.chapterNo,
    first: a,
    second: b,
    order: 'ab',
    contractShape: input.contractShape,
    rubricOrder: [...rubric].reverse(),
    activitySuffix: `${pair}:shuffled`,
  });
  verdicts.push(third.verdict);
  artifacts.push(third.artifactId);
  const decider = preferredId(third.verdict);
  if (decider !== undefined)
    return {
      winnerId: decider,
      loserId: decider === a.id ? b.id : a.id,
      reason: 'tiebreak_shuffled_rubric',
      positionBiasDetected: true,
      verdicts,
      verdictArtifactIds: artifacts,
    };
  const tie = breakTie(ctx.policy, a, b);
  return {
    winnerId: tie.winnerId,
    loserId: tie.winnerId === a.id ? b.id : a.id,
    reason: tie.reason,
    positionBiasDetected: true,
    verdicts,
    verdictArtifactIds: artifacts,
  };
}

export interface DimensionDelta {
  readonly dimension: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface RegressionReport {
  readonly targetedDimension: Issue['dimension'];
  readonly tolerancePoints: number;
  readonly deltas: readonly DimensionDelta[];
  /** Non-targeted gated dimensions that fell by more than the tolerance. */
  readonly regressions: readonly DimensionDelta[];
  readonly targetedImproved: boolean;
  readonly passed: boolean;
}

/**
 * ADR-0014 regression check: a patch targeting one dimension must not degrade another beyond the pinned
 * tolerance. The targeted dimension is exempt from the regression list (it is the one being repaired) but
 * its own movement is reported, so a patch that repairs nothing is visible rather than silently accepted.
 */
export function patchRegression(
  policy: ProductionPolicy,
  input: { before: Scorecard; after: Scorecard; dimension: Issue['dimension'] },
): RegressionReport {
  // An absent tolerance means zero tolerance (any drop regresses), never "unlimited": a missing number
  // must not silently widen a gate (ADR-0041).
  const tolerance = policy.revision.regression_tolerance_points ?? 0;
  const deltas: DimensionDelta[] = [];
  for (const dimension of gatedDimensions(policy)) {
    const before = sectionScore(input.before, dimension);
    const after = sectionScore(input.after, dimension);
    if (before === undefined || after === undefined) continue;
    deltas.push({ dimension, before, after, delta: after - before });
  }
  const regressions = deltas.filter((d) => d.dimension !== input.dimension && d.delta < -tolerance);
  const targeted = deltas.find((d) => d.dimension === input.dimension);
  return {
    targetedDimension: input.dimension,
    tolerancePoints: tolerance,
    deltas,
    regressions,
    targetedImproved: (targeted?.delta ?? 0) > 0,
    passed: regressions.length === 0,
  };
}

/** ADR-0014: run a smoke re-check once this many patches have been applied in a round. */
export function smokeCheckDue(policy: ProductionPolicy, patchesApplied: number): boolean {
  const every = policy.revision.smoke_after_patches;
  return every > 0 && patchesApplied > 0 && patchesApplied % every === 0;
}
