/**
 * Corpus statistics (ADR-0082, C1): the operator's chapters measured with the SAME metric code the Korean
 * lint applies to drafts, so a threshold calibrated on the operator (C4) means the same thing on a draft.
 * Text is read one paragraph per line (ADR-0081), as the operator's books render.
 */
import { lintKoreanWebnovel, type KoStyleSource } from './ko-style.js';
import { paragraphPerLine } from './paragraphs.js';

export interface ChapterMetrics {
  readonly chars_with_spaces: number;
  readonly chars_without_spaces: number;
  readonly paragraphs: number;
  readonly paragraph_mean_chars: number;
  readonly paragraph_p90_chars: number;
  readonly max_paragraph_chars: number;
  readonly long_paragraph_ratio: number;
  readonly dialogue_ratio: number;
  readonly monologue_ratio: number;
  readonly talk_share: number;
  readonly sentence_mean_chars: number;
  readonly sentence_p90_chars: number;
  readonly long_sentence_ratio: number;
  readonly comma_per_1k: number;
  readonly ellipsis_per_1k: number;
  readonly dash_per_1k: number;
  readonly translation_weighted_per_1k: number;
  readonly pronoun_per_1k: number;
  readonly simile_per_1k: number;
  readonly conjunction_per_1k: number;
  readonly status_window_lines: number;
  /** Narration sentence endings, as shares of narration sentences. */
  readonly ending_past: number;
  readonly ending_present: number;
  readonly ending_other_da: number;
  readonly ending_fragment: number;
  readonly ending_connective: number;
  /** Lint rule id → finding count, under the source the metrics were taken with. */
  readonly rules: Readonly<Record<string, number>>;
}

const HANGUL_BASE = 0xac00;

/** The final consonant index of a Hangul syllable (0 = none, 4 = ㄴ), or -1 for a non-syllable. */
function jongseong(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < HANGUL_BASE || code > 0xd7a3) return -1;
  return (code - HANGUL_BASE) % 28;
}

const PAST =
  /(었|았|였|했|웠|렸|켰|쳤|졌|왔|갔|났|섰|봤|줬|됐|셨|꼈|뒀|랐|댔|냈|샀|찼|탔|팠|쌌|컸|썼|떴|볐)다$/u;
const CONNECTIVE = /(으나|지만|는데|은데|니까|아서|어서|해서|면서|도록|듯이|거나|든지|며|고)$/u;

export type EndingClass = 'past' | 'present' | 'other_da' | 'fragment' | 'connective' | 'other';

/** Classify a narration sentence by its final word (punctuation stripped). */
export function endingClass(sentence: string): EndingClass {
  const s = sentence.replace(/[.!?…~,'"“”‘’)\]\s]+$/u, '');
  if (s === '') return 'other';
  if (s.endsWith('다')) {
    if (PAST.test(s)) return 'past';
    const prev = s.slice(-2, -1);
    if (s.endsWith('는다') || jongseong(prev) === 4) return 'present';
    return 'other_da';
  }
  if (CONNECTIVE.test(s)) return 'connective';
  if (/(요|까|지|군|네|나|라|자|죠|걸|데)$/u.test(s)) return 'other';
  return 'fragment';
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function chapterMetrics(rawText: string, source: KoStyleSource = {}): ChapterMetrics {
  const text = paragraphPerLine(rawText);
  const report = lintKoreanWebnovel(text, source);
  const m = report.metrics;
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const lens = lines.map((l) => l.length).sort((a, b) => a - b);
  const narration = lines.filter((l) => !/^[“"‘'「『[<(]/.test(l.trim()));
  const sentences = narration.flatMap((l) =>
    l
      .split(/(?<=[.!?…])\s+/u)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const counts: Record<EndingClass, number> = {
    past: 0,
    present: 0,
    other_da: 0,
    fragment: 0,
    connective: 0,
    other: 0,
  };
  for (const s of sentences) counts[endingClass(s)] += 1;
  const share = (k: EndingClass) =>
    sentences.length === 0 ? 0 : round(counts[k] / sentences.length);
  const rules: Record<string, number> = {};
  for (const f of report.findings) rules[f.rule_id] = (rules[f.rule_id] ?? 0) + 1;
  return {
    chars_with_spaces: text.replace(/\n/g, '').length,
    chars_without_spaces: text.replace(/\s/g, '').length,
    paragraphs: lines.length,
    paragraph_mean_chars:
      lines.length === 0 ? 0 : round(lens.reduce((a, b) => a + b, 0) / lens.length, 1),
    paragraph_p90_chars: percentile(lens, 90),
    max_paragraph_chars: m.max_paragraph_chars,
    long_paragraph_ratio: m.long_paragraph_ratio,
    dialogue_ratio: m.dialogue_ratio,
    monologue_ratio: m.monologue_ratio ?? 0,
    // Dialogue (curly or straight quotes) plus 속마음: the v5 KO-DLG-SHARE count sees only curly quotes, and
    // the operator's second book writes dialogue in straight quotes (defect C-1, fixed in lang/ko@7).
    talk_share: round(m.dialogue_ratio + (m.monologue_ratio ?? 0)),
    sentence_mean_chars: m.v5?.sentence_mean_chars ?? 0,
    sentence_p90_chars: m.v5?.sentence_p90_chars ?? 0,
    long_sentence_ratio: m.v5?.long_sentence_ratio ?? 0,
    comma_per_1k: m.v5?.comma_per_1k ?? 0,
    ellipsis_per_1k: m.v6?.ellipsis_per_1k ?? 0,
    dash_per_1k: m.v6?.dash_per_1k ?? 0,
    translation_weighted_per_1k: m.translation_weighted_per_1k,
    pronoun_per_1k: m.pronoun_per_1k,
    simile_per_1k: m.simile_per_1k,
    conjunction_per_1k: m.conjunction_per_1k,
    status_window_lines: lines.filter((l) => /^\s*[[【<].{1,60}[\]】>]\s*$/.test(l)).length,
    ending_past: share('past'),
    ending_present: share('present'),
    ending_other_da: share('other_da'),
    ending_fragment: share('fragment'),
    ending_connective: share('connective'),
    rules,
  };
}

export const METRIC_KEYS = [
  'chars_with_spaces',
  'chars_without_spaces',
  'paragraphs',
  'paragraph_mean_chars',
  'paragraph_p90_chars',
  'max_paragraph_chars',
  'long_paragraph_ratio',
  'dialogue_ratio',
  'monologue_ratio',
  'talk_share',
  'sentence_mean_chars',
  'sentence_p90_chars',
  'long_sentence_ratio',
  'comma_per_1k',
  'ellipsis_per_1k',
  'dash_per_1k',
  'translation_weighted_per_1k',
  'pronoun_per_1k',
  'simile_per_1k',
  'conjunction_per_1k',
  'status_window_lines',
  'ending_past',
  'ending_present',
  'ending_other_da',
  'ending_fragment',
  'ending_connective',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface Distribution {
  readonly n: number;
  readonly p2: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  readonly p98: number;
}

export function distributionOf(values: readonly number[]): Distribution {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p2: percentile(s, 2),
    p10: percentile(s, 10),
    p50: percentile(s, 50),
    p90: percentile(s, 90),
    p98: percentile(s, 98),
  };
}

export function distributions(
  rows: readonly ChapterMetrics[],
): Readonly<Record<MetricKey, Distribution>> {
  return Object.fromEntries(
    METRIC_KEYS.map((k) => [k, distributionOf(rows.map((r) => r[k]))]),
  ) as Record<MetricKey, Distribution>;
}
