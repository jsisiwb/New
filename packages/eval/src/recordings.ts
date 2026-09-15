/**
 * Deterministic judge recordings for the contrast corpus (B-6-3).
 *
 * These are FIXTURES, not model output. They are derived from each set's own authored expectations — its
 * rank order and its `min_gap_*` values — so every recording encodes the distinction that set was written to
 * demonstrate, and a set whose gaps change produces different recordings. They are generated rather than
 * stored as 200 hand-written blobs because a generated table cannot drift out of step with the corpus it
 * describes, and because the derivation itself is the reviewable artifact.
 *
 * What these recordings DO prove: the evaluator boundary, the prompt/identity pinning, the replay integrity
 * and the separation rule are wired correctly and behave deterministically.
 * What they DO NOT prove: that a live model would score this way. Thresholds stay `uncalibrated`
 * (ADR-0029); live calibration is B-4-5 and has not happened.
 */
import { createHash } from 'node:crypto';
import { type Recording } from '@yeonjae/gateway';
import { type ContrastSet, type VariantClass } from './corpus.js';
import { type DimensionName } from './expectations.js';

/** A stable small integer in [0, span) derived from a key — jitter that is reproducible, never random. */
function spread(key: string, span: number): number {
  const hex = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
  return parseInt(hex, 16) % span;
}

export interface ScoreInputs {
  readonly set: ContrastSet;
  readonly variant: VariantClass;
  readonly dimension: DimensionName;
  /** The pinned gate for this dimension, from the Production Policy (ADR-0041). */
  readonly threshold: number;
}

/**
 * The score a variant receives on a dimension.
 *
 * Passing scores sit above the pinned threshold; failing scores sit below it by at least the set's own
 * authored gap where the corpus states one, so `min_gap_prose_vs_translation_like` and
 * `min_gap_structure_vs_western_english` are honoured by construction rather than asserted by coincidence.
 */
export function scoreFor(input: ScoreInputs): number {
  const { set, variant, dimension, threshold } = input;
  const key = `${set.id}|${variant}|${dimension}`;
  const jitter = spread(key, 5);

  if (dimension === 'prose') {
    // The positive target's score is the anchor: failing classes are derived FROM it so each set's own
    // authored gap holds by construction rather than by coincidence of two independent jitters.
    const anchor = Math.min(97, threshold + 10 + spread(`${set.id}|kwn_english|prose`, 5));
    switch (variant) {
      // The positive target and fluent Western prose are both good ENGLISH: both clear the prose gate.
      case 'kwn_english':
        return anchor;
      case 'western_english':
        return Math.min(95, threshold + 6 + jitter);
      // Calqued English fails prose by at least the set's authored gap below the positive target.
      case 'translation_like':
        return Math.max(1, anchor - set.expected.min_gap_prose_vs_translation_like);
      // Over-written literary prose is grammatical but heavy: low-mid, per the corpus header.
      case 'literary':
        return Math.max(1, threshold - 6 - jitter);
      // Serially inert prose stays grammatically fluent: it is not a prose failure, and no prose
      // expectation is asserted for it.
      case 'weak_serial':
        return Math.min(93, threshold + 2 + jitter);
    }
  }

  if (dimension === 'structure') {
    const anchor = Math.min(96, threshold + 9 + spread(`${set.id}|kwn_english|structure`, 5));
    switch (variant) {
      // Only the positive target clears the structure gate.
      case 'kwn_english':
        return anchor;
      // Western pacing fails structure by at least the set's authored structure gap.
      case 'western_english':
        return Math.max(1, anchor - set.expected.min_gap_structure_vs_western_english);
      // The calque keeps the webnovel beats: structure stays ABOVE the gate. This is the separation rule —
      // bad English must not drag down an unrelated dimension.
      case 'translation_like':
        return Math.min(94, threshold + 5 + jitter);
      case 'literary':
        return Math.max(1, threshold - 14 - jitter);
      case 'weak_serial':
        return Math.max(1, threshold - 20 - jitter);
    }
  }

  if (dimension === 'genre') {
    switch (variant) {
      case 'kwn_english':
        return Math.min(95, threshold + 12 + jitter);
      // Western-epic framing loses the genre's reader fantasy and devices.
      case 'western_english':
        return Math.max(1, threshold - 16 - jitter);
      // The calque still delivers the genre's devices and vocabulary — bad English, right genre.
      case 'translation_like':
        return Math.min(93, threshold + 7 + jitter);
      // Literary interiority displaces the genre devices.
      case 'literary':
        return Math.max(1, threshold - 12 - jitter);
      // Serially inert prose still uses the genre furniture; genre fit is not what it fails.
      case 'weak_serial':
        return Math.min(90, threshold + 3 + jitter);
    }
  }

  // voice: dialogue register and character distinguishability — independent of pacing and of grammar.
  switch (variant) {
    case 'kwn_english':
      return Math.min(95, threshold + 11 + jitter);
    // Fluent Western prose flattens the register hierarchy into neutral literary dialogue.
    case 'western_english':
      return Math.max(1, threshold - 13 - jitter);
    // The calque's register CHOICES are right even where its grammar is wrong.
    case 'translation_like':
      return Math.min(92, threshold + 6 + jitter);
    // Essayistic narration absorbs the characters' distinct voices.
    case 'literary':
      return Math.max(1, threshold - 15 - jitter);
    // Inert beats, but the voices stay distinguishable.
    case 'weak_serial':
      return Math.min(89, threshold + 2 + jitter);
  }
}

/** Concrete, class-specific issues — the "for reasons" half of the expectation. */
function issuesFor(
  set: ContrastSet,
  variant: VariantClass,
  dimension: DimensionName,
): Record<string, unknown>[] {
  if (dimension === 'prose') {
    if (variant === 'translation_like')
      return [
        {
          kind: 'translation_like_english',
          severity: 'major',
          confidence: 0.93,
          claim: `set ${set.id}: calqued English — omitted articles, transferred prepositions and transliterated idiom (TRN-01, TRN-02, TRN-14).`,
        },
      ];
    if (variant === 'literary')
      return [
        {
          kind: 'literary_drift',
          severity: 'major',
          confidence: 0.86,
          claim: `set ${set.id}: essayistic register and over-long paragraphs displace the scene (EP-LEN-01, EP-LEN-03).`,
        },
      ];
    return [];
  }
  if (dimension === 'genre') {
    if (variant === 'western_english')
      return [
        {
          kind: 'western_novel_drift',
          severity: 'major',
          confidence: 0.87,
          claim: `set ${set.id}: the ${set.genre} reader fantasy and its devices are replaced by Western-epic framing.`,
        },
      ];
    if (variant === 'literary')
      return [
        {
          kind: 'literary_drift',
          severity: 'major',
          confidence: 0.82,
          claim: `set ${set.id}: interiority displaces the ${set.genre} devices the ${set.function} beat needs.`,
        },
      ];
    return [];
  }
  if (dimension === 'voice') {
    if (variant === 'western_english')
      return [
        {
          kind: 'voice_drift',
          severity: 'major',
          confidence: 0.85,
          claim: `set ${set.id}: the register hierarchy flattens into neutral literary dialogue; speakers stop being distinguishable.`,
        },
      ];
    if (variant === 'literary')
      return [
        {
          kind: 'register_error',
          severity: 'major',
          confidence: 0.8,
          claim: `set ${set.id}: essayistic narration absorbs the characters' distinct voices.`,
        },
      ];
    return [];
  }
  if (variant === 'western_english')
    return [
      {
        kind: 'western_novel_drift',
        severity: 'major',
        confidence: 0.9,
        claim: `set ${set.id}: Western-novel pacing — the hook arrives after the scene-setting and the ${set.function} beat is deferred (ST-HOOK-01, ST-OPEN-01).`,
      },
    ];
  if (variant === 'weak_serial')
    return [
      {
        kind: 'weak_ending',
        severity: 'major',
        confidence: 0.88,
        claim: `set ${set.id}: the ${set.function} beat has no local payoff and the ending does not pull forward (ST-PAY-01, ST-END-01).`,
      },
    ];
  if (variant === 'literary')
    return [
      {
        kind: 'serial_drift',
        severity: 'major',
        confidence: 0.84,
        claim: `set ${set.id}: interiority replaces escalation; the serialized cadence stalls (ST-HOOK-01).`,
      },
    ];
  return [];
}

function driftFlags(variant: VariantClass, dimension: DimensionName): string[] {
  if (dimension !== 'prose') return [];
  if (variant === 'translation_like') return ['translation_like'];
  if (variant === 'literary') return ['literary'];
  return [];
}

/** The activity id a contrast evaluation uses. Deterministic and unique per (set, variant, dimension). */
export function activityIdFor(
  setId: string,
  variant: VariantClass,
  dimension: DimensionName,
): string {
  return `contrast:${setId}:${variant}:${dimension}`;
}

export interface RecordingInputs {
  readonly set: ContrastSet;
  readonly variant: VariantClass;
  readonly dimension: DimensionName;
  readonly threshold: number;
}

export function recordingFor(input: RecordingInputs): Recording {
  const score = scoreFor(input);
  const { set, variant, dimension } = input;
  const json: Record<string, unknown> = {
    judge_score: score,
    drift_flags: driftFlags(variant, dimension),
    issues: issuesFor(set, variant, dimension),
  };
  if (dimension === 'structure') {
    // Structure evidence is concrete: where the hook lands and whether the beat pays off locally.
    const strong = variant === 'kwn_english' || variant === 'translation_like';
    json.hook_sentence_index = strong ? 1 : spread(`${set.id}|${variant}|hook`, 6) + 6;
    json.local_payoff_present = strong;
    json.ending_type_detected = strong ? 'forward_pull' : 'flat_close';
  }
  return {
    json,
    modelId: 'replay-model',
    usage: { input: 1000, output: 400, cached: 0 },
  };
}

/**
 * The full recording table for a corpus: one entry per (set, variant, dimension). Keyed by activity id, the
 * same key space the workflow replay fixtures use, so ReplayProvider resolves them with no special case.
 */
export function recordingsFor(
  sets: readonly ContrastSet[],
  thresholds: Readonly<Record<DimensionName, number>>,
  dimensions: readonly DimensionName[],
  variants: readonly VariantClass[],
): Map<string, Recording> {
  const table = new Map<string, Recording>();
  for (const set of sets) {
    for (const variant of variants) {
      for (const dimension of dimensions) {
        const threshold = thresholds[dimension];
        table.set(
          `activity:${activityIdFor(set.id, variant, dimension)}`,
          recordingFor({ set, variant, dimension, threshold }),
        );
      }
    }
  }
  return table;
}
