/**
 * Output-normalizer counters (ADR-0057), kept apart from the metric registry so the emitting call path is
 * an ordinary production module.
 */
import { METRIC, METRIC_HELP, Metrics } from './metrics.js';

/**
 * The ADR-0056 §11–12 output normalizers, as a closed label set (ADR-0057). Each one repairs a shape a live
 * model returned; counting when one changes an answer shows which are still needed once prompt shapes are
 * generated from schemas and providers enforce them natively.
 */
export const OUTPUT_NORMALIZERS = [
  'contract_output',
  'contract_location_fallback',
  'scene_plans',
  'scene_draft',
  'evidence_anchor',
  'quote_marks_folded',
  'patch_fields',
  'patch_quote_anchor',
  'judge_drift_flags',
  'judge_dimension_scores',
  'judge_repair',
  'judge_quote_anchor',
  // Gateway-level JSON recovery (ADR-0080): a fenced answer, or JSON inside chatty text.
  'json_fence_stripped',
  'json_object_extracted',
  // One paragraph per line in a text-mode scene draft (ADR-0081).
  'paragraph_per_line',
  // A scene plan below the policy's dialogue floor, or without anyone beside the POV character (ADR-0084).
  'dialogue_floor',
  'dialogue_partner',
  // A scene with someone to talk to that came back below the talk band, re-drafted once (ADR-0084).
  'dialogue_redraft',
  // Plan-level prevention (ADR-0086): a contract re-asked for a talk partner, an early reveal removed from the
  // contract, talk bans stripped and the cut appended to the scene plan, a scene plan re-asked after the critic.
  'contract_repair',
  'reveal_repair',
  'plan_talk_ban',
  'plan_cut_beat',
  'plan_repair',
  // ADR-0087: a revision round that drafted more than one patch per cluster and kept the best.
  'patch_candidates',
  // ADR-0087: the scene-rewrite rung of the escalation ladder.
  'scene_rewrite',
  // ADR-0088: a line repeated word for word right after itself, dropped at assembly.
  'repeated_line',
] as const;
export type OutputNormalizer = (typeof OUTPUT_NORMALIZERS)[number];

/**
 * Process-wide metrics for code that has no request-scoped registry (workflow steps run inside the API, the
 * worker and the CLI alike). The API's `/metrics` renders it after its own series.
 */
export const processMetrics = new Metrics();

export function recordNormalization(normalizer: OutputNormalizer): void {
  processMetrics.increment(
    METRIC.outputNormalizations,
    METRIC_HELP[METRIC.outputNormalizations] ?? '',
    { kind: normalizer },
  );
}

export function normalizationCounts(): Readonly<Record<OutputNormalizer, number>> {
  return Object.fromEntries(
    OUTPUT_NORMALIZERS.map((n) => [
      n,
      processMetrics.total(METRIC.outputNormalizations, { kind: n }),
    ]),
  ) as Record<OutputNormalizer, number>;
}
