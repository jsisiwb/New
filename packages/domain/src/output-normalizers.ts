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
