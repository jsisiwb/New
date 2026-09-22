/**
 * Language-neutral length model (ADR-0034). Words are the author-facing unit for English and characters
 * (code points excluding line breaks) are the author-facing unit for Korean (ADR-0054); code points are
 * kept for evidence addressing and technical metrics; tokens are an estimate unless a tokenizer is supplied.
 */
import { type NfcText } from './nfc.js';
import { segmentParagraphs } from './paragraphs.js';

export interface LengthModel {
  readonly words: number;
  /** Author-facing Korean character count: code points excluding line breaks, spaces included. */
  readonly characters: number;
  readonly code_points: number;
  readonly paragraphs: number;
  readonly sentences: number;
  readonly est_tokens: number;
  readonly est_tokens_model: string;
  readonly est_reading_seconds: number;
}

export interface LengthOptions {
  /** English tokens per word for the estimator; calibrated per model (starting value 1.3). */
  readonly tokensPerWord?: number;
  readonly tokenizerLabel?: string;
  /** Reading speed for est_reading_seconds (words per minute; default 240). */
  readonly wordsPerMinute?: number;
}

// A word is a run of letters/digits/apostrophes/hyphens; em dashes and ellipses split words.
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
// Sentence terminators followed by whitespace/end, allowing closing quotes/brackets after the terminator.
// An ellipsis ends a sentence only when the next word starts a new one (capital/opening quote) or text ends.
const SENTENCE_END = /(?:[.!?]+["”’)\]]*(?=\s|$)|…["”’)\]]*(?=\s+[“"A-Z]|$))/gu;

export function countWords(text: string): number {
  let n = 0;
  for (const _m of text.matchAll(WORD)) n++;
  return n;
}

export function countSentences(text: string): number {
  const terminators = [...text.matchAll(SENTENCE_END)].length;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  // Text that does not end with a terminator still ends a sentence.
  const endsWithTerminator = /[.!?…]["”’)\]]*$/u.test(trimmed);
  return terminators + (endsWithTerminator ? 0 : 1);
}

export function measure(source: NfcText, opts: LengthOptions = {}): LengthModel {
  const tokensPerWord = opts.tokensPerWord ?? 1.3;
  const wpm = opts.wordsPerMinute ?? 240;
  const words = countWords(source.text);
  const paragraphs = segmentParagraphs(source);
  const sentences = paragraphs.reduce((acc, p) => acc + countSentences(p.text), 0);
  return {
    words,
    characters: source.codePoints.filter((cp) => cp !== '\n' && cp !== '\r').length,
    code_points: source.codePoints.length,
    paragraphs: paragraphs.length,
    sentences,
    est_tokens: Math.round(words * tokensPerWord),
    est_tokens_model: opts.tokenizerLabel ?? `estimator:english-words×${tokensPerWord}`,
    est_reading_seconds: Math.round((words / wpm) * 60),
  };
}

export interface LengthTarget {
  readonly unit: 'words' | 'characters';
  readonly value: number;
  readonly tolerance_ratio?: number | undefined;
}

/** The measured count a target judges against, per its unit. */
export function targetCount(m: LengthModel, unit: LengthTarget['unit']): number {
  return unit === 'characters' ? m.characters : m.words;
}

export type LengthVerdict = 'within' | 'under' | 'over';

export function judgeLength(
  words: number,
  target: LengthTarget,
  failToleranceRatio?: number,
): {
  verdict: LengthVerdict;
  ratio: number;
  warn: boolean;
  fail: boolean;
} {
  const warnTol = target.tolerance_ratio ?? 0.12;
  const failTol = failToleranceRatio ?? Math.max(warnTol, 0.2);
  const ratio = words / target.value - 1;
  const verdict: LengthVerdict = ratio < -warnTol ? 'under' : ratio > warnTol ? 'over' : 'within';
  return { verdict, ratio, warn: Math.abs(ratio) > warnTol, fail: Math.abs(ratio) > failTol };
}
