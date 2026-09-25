/**
 * The operator corpus as a voice reference (ADR-0083): exemplar passages by scene function (C5), the
 * "reads like the operator" likeness score (C8) and stock-phrase mining (C7). Pure functions over chapter
 * text; nothing here writes or changes a sentence of the corpus. Passages are copied verbatim with their
 * code-point offsets so every exemplar a project pins can be traced to its chapter.
 */
import { createHash } from 'node:crypto';
import { codePointLength } from './codepoints.js';
import type { ChapterMetrics, Distribution, MetricKey } from './corpus-stats.js';

export const PASSAGE_TAGGER = 'passages@1';

export type PassageFunction = 'hook' | 'banter' | 'status_window' | 'cliffhanger';

export interface PassageCandidate {
  readonly scene_type: PassageFunction;
  /** Code-point offsets into the chapter text: the first line's start and the last line's end. */
  readonly start_cp: number;
  readonly end_cp: number;
  readonly text: string;
  readonly features: {
    readonly chars: number;
    readonly lines: number;
    readonly talk_share: number;
  };
}

interface Line {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let offset = 0;
  for (const raw of text.split('\n')) {
    const len = codePointLength(raw);
    if (raw.trim() !== '') out.push({ text: raw.trim(), start: offset, end: offset + len });
    offset += len + 1;
  }
  return out;
}

const DIALOGUE_LINE = /^[“"].*[”"]$/u;
const TALK = /“[^”\n]*”|"[^"\n]*"|‘[^’\n]*’/gu;
/** A system line: a bracketed key–value (`[특성 : …]`, `[메인 퀘스트 : …]`). Spirit voices in brackets are not. */
const STATUS_LINE = /^\[[^\]]*[:：][^\]]*\]$/u;
/** Lines that belong to the author, not the story: notes, thanks, schedule, requests. */
const AUTHOR_NOTE =
  /작가의\s*말|후원|추천\s*부탁|선작|댓글|감사합니다|감사드립니다|연참|휴재|공지|다음\s*화에서|^※|^[*＊\s]+$/u;

function passage(scene_type: PassageFunction, lines: readonly Line[]): PassageCandidate {
  const text = lines.map((l) => l.text).join('\n');
  const chars = lines.reduce((a, l) => a + codePointLength(l.text), 0);
  let talk = 0;
  for (const m of text.matchAll(TALK)) talk += codePointLength(m[0]);
  return {
    scene_type,
    start_cp: lines[0]?.start ?? 0,
    end_cp: lines[lines.length - 1]?.end ?? 0,
    text,
    features: {
      chars,
      lines: lines.length,
      talk_share: chars === 0 ? 0 : Math.round((talk / chars) * 1000) / 1000,
    },
  };
}

const charsOf = (ls: readonly Line[]) => ls.reduce((a, l) => a + codePointLength(l.text), 0);

/** Lines from `from` in `step` direction until at least `min` characters, never past `max`. */
function run(lines: readonly Line[], from: number, step: 1 | -1, min: number, max: number): Line[] {
  const out: Line[] = [];
  let chars = 0;
  for (let i = from; i >= 0 && i < lines.length; i += step) {
    const l = lines[i];
    if (!l) break;
    const len = codePointLength(l.text);
    if (chars + len > max) break;
    if (step === 1) out.push(l);
    else out.unshift(l);
    chars += len;
    if (chars >= min) break;
  }
  return chars >= min ? out : [];
}

/**
 * Tag a chapter's candidate passages (tagger `passages@1`): the opening of 화 1–3 (hook), the last lines
 * before any author's note (cliffhanger), up to two dialogue-led windows of eight to fourteen lines with
 * narration beats between the lines (banter), and one cluster of bracketed system lines with two lines of
 * context on each side (status_window).
 */
export function tagPassages(
  text: string,
  meta: { readonly position: number | null },
): PassageCandidate[] {
  const lines = linesOf(text);
  const out: PassageCandidate[] = [];
  if (lines.length < 12) return out;

  if (meta.position !== null && meta.position <= 3) {
    const hook = run(lines, 0, 1, 220, 480);
    if (hook.length >= 4) out.push(passage('hook', hook));
  }

  let last = lines.length - 1;
  while (last > 0 && AUTHOR_NOTE.test(lines[last]?.text ?? '')) last -= 1;
  const tail = run(lines, last, -1, 160, 420);
  if (tail.length >= 3 && !tail.some((l) => AUTHOR_NOTE.test(l.text)))
    out.push(passage('cliffhanger', tail));

  const isTalk = lines.map((l) => DIALOGUE_LINE.test(l.text));
  const banter: PassageCandidate[] = [];
  for (let i = 0; i + 8 <= lines.length && banter.length < 2;) {
    let taken = false;
    for (let size = 14; size >= 8; size -= 1) {
      const win = lines.slice(i, i + size);
      if (win.length < size) continue;
      const flags = isTalk.slice(i, i + size);
      const talkLines = flags.filter(Boolean).length;
      const switches = flags.slice(1).filter((f, k) => f !== flags[k]).length;
      const chars = charsOf(win);
      if (
        flags[0] === true &&
        talkLines * 2 >= size &&
        size - talkLines >= 2 &&
        switches >= 4 &&
        chars >= 200 &&
        chars <= 520
      ) {
        // End on the last line of talk and its beat when the rest still makes a passage.
        const lastTalk = flags.lastIndexOf(true);
        const trimmed = win.slice(0, Math.min(size, lastTalk + 2));
        banter.push(passage('banter', charsOf(trimmed) >= 200 ? trimmed : win));
        i += size;
        taken = true;
        break;
      }
    }
    if (!taken) i += 1;
  }
  out.push(...banter);

  const statusIdx = lines.flatMap((l, i) => (STATUS_LINE.test(l.text) ? [i] : []));
  if (statusIdx.length >= 2) {
    const first = statusIdx[0] ?? 0;
    let lastStatus = first;
    for (const i of statusIdx.slice(1)) if (i - lastStatus <= 4) lastStatus = i;
    const win = lines.slice(Math.max(0, first - 2), Math.min(lines.length, lastStatus + 3));
    const chars = charsOf(win);
    if (lastStatus > first && chars >= 80 && chars <= 500) out.push(passage('status_window', win));
  }
  return out;
}

export interface StoredPassage {
  readonly id: string;
  readonly scene_type: string;
  readonly text: string;
  readonly pov: 'first' | 'third' | 'mixed' | null;
  readonly source: string;
}

export interface SelectedExemplar {
  readonly id: string;
  readonly functions: [PassageFunction];
  readonly pov?: 'first' | 'third_limited';
  readonly source: string;
  readonly text: string;
}

/**
 * Pick `perFunction` passages per function for a project: chapters in the project's point of view first,
 * then a stable per-project order (sha256 of seed and passage id), so two projects see different passages
 * and a replay of the same project sees the same ones.
 */
export function selectOperatorExemplars(
  passages: readonly StoredPassage[],
  opts: {
    readonly functions: readonly string[];
    readonly perFunction: number;
    readonly pov?: 'first' | 'third_limited' | 'third_omniscient' | undefined;
    readonly seed: string;
  },
): SelectedExemplar[] {
  const want = opts.pov === 'first' ? 'first' : opts.pov ? 'third' : undefined;
  const rank = (id: string) =>
    createHash('sha256').update(`${opts.seed}:${id}`, 'utf8').digest('hex');
  const out: SelectedExemplar[] = [];
  for (const fn of opts.functions) {
    const pool = passages.filter((p) => p.scene_type === fn);
    const matching = want ? pool.filter((p) => p.pov === want) : pool;
    const ordered = [...(matching.length > 0 ? matching : pool)].sort((a, b) =>
      rank(a.id).localeCompare(rank(b.id)),
    );
    for (const p of ordered.slice(0, opts.perFunction))
      out.push({
        id: p.id,
        functions: [fn as PassageFunction],
        ...(p.pov === 'first'
          ? { pov: 'first' as const }
          : p.pov === 'third'
            ? { pov: 'third_limited' as const }
            : {}),
        source: p.source,
        text: p.text,
      });
  }
  return out;
}

/**
 * Style metrics the likeness score compares (C8): rhythm, dialogue, punctuation, figures and endings.
 * Length, paragraph count and status-window lines depend on the chapter's content, not the voice.
 */
export const LIKENESS_KEYS = [
  'paragraph_mean_chars',
  'paragraph_p90_chars',
  'max_paragraph_chars',
  'long_paragraph_ratio',
  'talk_share',
  'monologue_ratio',
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
  'ending_past',
  'ending_present',
  'ending_fragment',
  'ending_connective',
] as const satisfies readonly MetricKey[];

export interface LikenessReport {
  /** Share of the likeness metrics inside the operator's p10–p90 band, 0–100. */
  readonly score: number;
  readonly within: number;
  readonly total: number;
  readonly outside: readonly {
    readonly key: MetricKey;
    readonly value: number;
    readonly p10: number;
    readonly p90: number;
  }[];
}

/** How many of a chapter's style metrics fall inside the operator's own p10–p90 band (C8, deterministic). */
export function operatorLikeness(
  m: ChapterMetrics,
  bands: Readonly<Record<MetricKey, Distribution>>,
): LikenessReport {
  const outside: { key: MetricKey; value: number; p10: number; p90: number }[] = [];
  for (const key of LIKENESS_KEYS) {
    const b = bands[key];
    const value = m[key];
    if (value < b.p10 || value > b.p90) outside.push({ key, value, p10: b.p10, p90: b.p90 });
  }
  const total = LIKENESS_KEYS.length;
  const within = total - outside.length;
  return { score: Math.round((within / total) * 1000) / 10, within, total, outside };
}

/** Words of a text with surrounding quotes and punctuation removed; Hangul, letters and digits only. */
function wordsOf(text: string): string[] {
  return text
    .split(/\s+/u)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => /\p{Script=Hangul}/u.test(w));
}

function ngramsOf(words: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i += 1) out.push(words.slice(i, i + n).join(' '));
  return out;
}

export interface StockPhrase {
  readonly phrase: string;
  /** Pipeline chapters that use the phrase. */
  readonly drafts: number;
  readonly draft_uses: number;
  /** Uses in the operator corpus. */
  readonly corpus_uses: number;
}

/**
 * Stock-phrase mining (C7): word n-grams that recur across the pipeline's chapters (at least `minDrafts`
 * of them) but that the operator's chapters use at most `maxCorpusUses` times. The result is a candidate
 * list for review, not a rule: a phrase becomes a lint pattern only through a new language layer.
 */
export function stockPhraseCandidates(
  drafts: readonly string[],
  corpus: readonly string[],
  opts: { readonly n: number; readonly minDrafts: number; readonly maxCorpusUses: number },
): StockPhrase[] {
  const inDrafts = new Map<string, { drafts: number; uses: number }>();
  for (const d of drafts) {
    const grams = ngramsOf(wordsOf(d), opts.n);
    const seen = new Set<string>();
    for (const g of grams) {
      const e = inDrafts.get(g) ?? { drafts: 0, uses: 0 };
      e.uses += 1;
      if (!seen.has(g)) {
        e.drafts += 1;
        seen.add(g);
      }
      inDrafts.set(g, e);
    }
  }
  const candidates = new Map<string, number>();
  for (const [g, e] of inDrafts) if (e.drafts >= opts.minDrafts) candidates.set(g, 0);
  for (const c of corpus)
    for (const g of ngramsOf(wordsOf(c), opts.n)) {
      const n = candidates.get(g);
      if (n !== undefined) candidates.set(g, n + 1);
    }
  return [...candidates]
    .filter(([, uses]) => uses <= opts.maxCorpusUses)
    .map(([phrase, corpus_uses]) => {
      const e = inDrafts.get(phrase) ?? { drafts: 0, uses: 0 };
      return { phrase, drafts: e.drafts, draft_uses: e.uses, corpus_uses };
    })
    .sort(
      (a, b) =>
        b.drafts - a.drafts || b.draft_uses - a.draft_uses || a.phrase.localeCompare(b.phrase),
    );
}
