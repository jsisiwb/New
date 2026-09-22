/**
 * Deterministic output-language check (OUTPUT-LANG, FR-4.10, ADR-0054). This is a script-and-lexicon
 * classifier, not a statistical language identifier: it must be reproducible, dependency-free and fail
 * closed. Segments are classified per paragraph. For English, any paragraph containing non-Latin letters
 * outside the allowlist, or whose Latin words do not look like English, lowers the confidence. For Korean,
 * paragraphs are judged by Hangul presence and the absence of non-Korean prose; Latin-only paragraphs
 * outside the allowlist fail. Registry romanizations and preserved-script contexts are excluded through
 * `allowlist`.
 */
import { type NfcText } from './nfc.js';
import { segmentParagraphs } from './paragraphs.js';

export interface LanguageCheckOptions {
  /** Tokens allowed although they are not in the target language (registry romanizations, preserved terms). */
  readonly allowlist?: readonly string[];
  /** Minimum share of paragraphs that must be in the target language for the whole text to pass. */
  readonly minConfidence?: number;
  /** Target manuscript language ('en' or 'ko', ADR-0054). Default 'en'. */
  readonly language?: 'en' | 'ko';
}

export interface LanguageCheckResult {
  readonly performed: true;
  readonly passed: boolean;
  /** Name kept for wire compatibility: it is the confidence that the text is in the target language. */
  readonly english_confidence: number;
  readonly offending_segments: readonly {
    paragraph_id: string;
    // Stable reason codes (kept for wire/audit compatibility): 'non_latin_script' means prose in the
    // wrong script for the target language, 'no_english_signal' means no signal of the target language.
    reason: 'non_latin_script' | 'no_english_signal';
    sample: string;
  }[];
}

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
const CJK_OR_KANA = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;
const CYRILLIC_GREEK_ARABIC = /[\u0370-\u03ff\u0400-\u04ff\u0600-\u06ff]/u;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;
const NON_LATIN = new RegExp(
  `${HANGUL.source}|${CJK_OR_KANA.source}|${CYRILLIC_GREEK_ARABIC.source}`,
  'u',
);

// Very common English function words; a natural English paragraph of any length contains several.
const ENGLISH_SIGNAL = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'is',
  'was',
  'were',
  'are',
  'be',
  'been',
  'had',
  'has',
  'have',
  'he',
  'she',
  'it',
  'they',
  'his',
  'her',
  'their',
  'that',
  'this',
  'not',
  "n't",
  'you',
  'i',
  'we',
  'as',
  'if',
  'then',
  'than',
  'so',
  'said',
  'no',
  'yes',
  'what',
  'who',
  'when',
  'where',
  'there',
  'here',
  'into',
  'out',
  'up',
  'down',
]);

function stripAllowlisted(text: string, allowlist: readonly string[]): string {
  let out = text;
  for (const term of allowlist) {
    if (term.length === 0) continue;
    out = out.split(term).join(' ');
  }
  return out;
}

export function checkOutputLanguage(
  source: NfcText,
  opts: LanguageCheckOptions = {},
): LanguageCheckResult {
  const minConfidence = opts.minConfidence ?? 0.99;
  const allowlist = opts.allowlist ?? [];
  const language = opts.language ?? 'en';
  const paragraphs = segmentParagraphs(source);
  const offending: LanguageCheckResult['offending_segments'][number][] = [];
  let targetParagraphs = 0;
  let considered = 0;

  for (const p of paragraphs) {
    const cleaned = stripAllowlisted(p.text, allowlist);
    const words = cleaned.match(LATIN_WORD) ?? [];
    if (words.length === 0 && !NON_LATIN.test(cleaned)) continue; // punctuation / separators

    if (language === 'ko') {
      // Korean: Hangul is the signal. A paragraph containing Hangul counts as Korean even when it also
      // carries short Latin tokens (status windows, ranks — allowlist covers terms that must survive).
      // A Latin-only paragraph is a fault unless it is a very short line that cannot be judged.
      considered++;
      if (HANGUL.test(cleaned)) {
        targetParagraphs++;
        continue;
      }
      if (NON_LATIN.test(cleaned) && !HANGUL.test(cleaned)) {
        offending.push({
          paragraph_id: p.id,
          reason: 'non_latin_script',
          sample: p.text.slice(0, 80),
        });
        continue;
      }
      if (words.length < 4) {
        targetParagraphs++;
      } else {
        // Latin-only prose in a Korean manuscript is not Korean prose.
        offending.push({
          paragraph_id: p.id,
          reason: 'no_english_signal',
          sample: p.text.slice(0, 80),
        });
      }
      continue;
    }

    // English (default) path — behavior unchanged.
    if (NON_LATIN.test(cleaned)) {
      considered++;
      offending.push({
        paragraph_id: p.id,
        reason: 'non_latin_script',
        sample: p.text.slice(0, 80),
      });
      continue;
    }
    considered++;
    if (words.length < 4) {
      // Very short lines ("[F]", "Two.", "Kid—") cannot be judged; treat Latin-only short lines as English.
      targetParagraphs++;
      continue;
    }
    const signal = words.filter((w) => ENGLISH_SIGNAL.has(w.toLowerCase())).length;
    if (signal >= 1 || words.length < 8) {
      targetParagraphs++;
    } else {
      offending.push({
        paragraph_id: p.id,
        reason: 'no_english_signal',
        sample: p.text.slice(0, 80),
      });
    }
  }
  const confidence = considered === 0 ? 1 : targetParagraphs / considered;
  return {
    performed: true,
    passed: confidence >= minConfidence && offending.every((o) => o.reason !== 'non_latin_script'),
    english_confidence: Number(confidence.toFixed(4)),
    offending_segments: offending,
  };
}

/** Korean manuscript output-language check (ADR-0054): same classifier, target language `ko`. */
export function checkOutputLanguageKo(
  source: NfcText,
  opts: Omit<LanguageCheckOptions, 'language'> = {},
): LanguageCheckResult {
  return checkOutputLanguage(source, { ...opts, language: 'ko' });
}
