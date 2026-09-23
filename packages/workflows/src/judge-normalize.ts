/**
 * Live judge output → scorecard shape (ADR-0056 §12).
 *
 * The evaluate step used to copy a judge's `drift_flags`, `dimension_scores` and each issue's `repair`
 * straight into the scorecard, and to keep an issue's location only when the model reported code-point
 * offsets. Recorded fixtures always matched the schema, so nothing failed until a live Korean run: its
 * judges answered with 0–100 section scores, issue kinds as drift flags, a string `repair` and a `quote`
 * instead of offsets. The scorecard failed validation and the chapter stopped at `evaluate`.
 *
 * These functions keep what the schema can hold and drop what it cannot, without inventing a value: a
 * flag maps to the schema's enum only through an alias the judge prompts themselves teach, an
 * out-of-range score is dropped (the gate reads `judge_score`, never these), and a quote becomes a
 * `chapter_span` only where it occurs in the manuscript. Output that already matches the schema passes
 * through unchanged, so recorded replays stay byte-identical.
 */
import { type NfcText, type Paragraph } from '@yeonjae/prose';
import { locateQuote } from './anchoring.js';

export type JudgeSection = 'prose' | 'structure' | 'genre' | 'voice';

/**
 * Alias → scorecard enum, for the two sections whose `drift_flags` the schema constrains. The aliases
 * are the issue kinds the Korean judge prompts name, mapped by the glossary's drift definitions
 * (serial drift = no hook, payoff or pull).
 */
export const DRIFT_FLAG_ALIASES: Readonly<
  Record<'prose' | 'structure', Readonly<Record<string, string>>>
> = {
  prose: {
    translation_like: 'translation_like',
    translation_like_english: 'translation_like',
    literary: 'literary',
    literary_drift: 'literary',
    light_novel: 'light_novel',
    light_novel_drift: 'light_novel',
    format: 'format',
    format_drift: 'format',
  },
  structure: {
    western_novel: 'western_novel',
    western_novel_drift: 'western_novel',
    serial: 'serial',
    serial_drift: 'serial',
    late_hook: 'serial',
    weak_ending: 'serial',
    exposition: 'exposition',
    excessive_exposition: 'exposition',
    cadence: 'cadence',
    weak_pacing: 'cadence',
  },
};

/** Drift flags the section's schema accepts, first occurrence order, no duplicates. */
export function normalizeDriftFlags(section: JudgeSection, flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  const out: string[] = [];
  for (const f of flags) {
    if (typeof f !== 'string' || f.trim() === '') continue;
    const mapped =
      section === 'prose' || section === 'structure'
        ? DRIFT_FLAG_ALIASES[section][f.trim().toLowerCase()]
        : f.trim();
    if (mapped !== undefined && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/** Sub-dimension scores on the schema's 1–5 scale; anything else is dropped, not rescaled. */
export function normalizeDimensionScores(scores: unknown): Record<string, number> {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores as Record<string, unknown>))
    if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5) out[k] = v;
  return out;
}

export interface IssueRepair {
  scope?: 'sentence' | 'paragraph' | 'dialogue' | 'scene' | 'chapter' | 'plan' | 'canon';
  suggestion?: string;
  must_preserve_fact_ids?: string[];
}

const REPAIR_SCOPES: ReadonlySet<string> = new Set([
  'sentence',
  'paragraph',
  'dialogue',
  'scene',
  'chapter',
  'plan',
  'canon',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A judge's `repair`: a string is the suggestion itself; an object keeps only the schema's fields. */
export function normalizeRepair(raw: unknown): IssueRepair | undefined {
  if (typeof raw === 'string') return raw.trim() ? { suggestion: raw.trim() } : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const ids = r.must_preserve_fact_ids;
  const valid =
    Object.keys(r).every((k) => ['scope', 'suggestion', 'must_preserve_fact_ids'].includes(k)) &&
    (r.scope === undefined || (typeof r.scope === 'string' && REPAIR_SCOPES.has(r.scope))) &&
    (r.suggestion === undefined || typeof r.suggestion === 'string') &&
    (ids === undefined ||
      (Array.isArray(ids) && ids.every((x) => typeof x === 'string' && UUID.test(x))));
  if (valid) return Object.keys(r).length > 0 ? r : undefined;
  const out: IssueRepair = {};
  if (typeof r.scope === 'string' && REPAIR_SCOPES.has(r.scope))
    out.scope = r.scope as NonNullable<IssueRepair['scope']>;
  if (typeof r.suggestion === 'string' && r.suggestion.trim()) out.suggestion = r.suggestion.trim();
  if (Array.isArray(ids)) {
    const kept = ids.filter((x): x is string => typeof x === 'string' && UUID.test(x));
    if (kept.length) out.must_preserve_fact_ids = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Where a judge's quote sits in the chapter. Judges read `[pN] ` paragraph markers and may copy them;
 * `locateQuote` tolerates retyped quotation marks and returns the manuscript's own text, so the span is
 * exact.
 */
export function anchorIssueQuote(
  text: NfcText,
  paragraphs: readonly Paragraph[],
  quote: unknown,
): { start: number; end: number; quote: string; paragraph_ids: string[] } | undefined {
  if (typeof quote !== 'string') return undefined;
  const cleaned = quote.replace(/\[p\d+\]\s*/g, '').trim();
  if (!cleaned) return undefined;
  const found = locateQuote(text, cleaned);
  if (!found) return undefined;
  const paragraph_ids = paragraphs
    .filter((p) => p.start < found.end && p.end > found.start)
    .map((p) => p.id);
  return { start: found.start, end: found.end, quote: found.quote, paragraph_ids };
}
