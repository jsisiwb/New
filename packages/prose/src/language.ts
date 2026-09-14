/**
 * Deterministic output-language check (OUTPUT-EN-001, FR-4.10). This is a script-and-lexicon classifier, not
 * a statistical language identifier: it must be reproducible, dependency-free and fail closed. Segments are
 * classified per paragraph; any paragraph containing non-Latin letters outside the allowlist, or whose
 * Latin words do not look like English, lowers the confidence. Registry romanizations and preserved-script
 * contexts are excluded through `allowlist`.
 */
import { type NfcText } from './nfc.js';
import { segmentParagraphs } from './paragraphs.js';

export interface LanguageCheckOptions {
  /** Tokens allowed although they are non-English/non-Latin (registry romanizations, preserved terms). */
  readonly allowlist?: readonly string[];
  /** Minimum share of paragraphs that must be English for the whole text to pass. */
  readonly minConfidence?: number;
}

export interface LanguageCheckResult {
  readonly performed: true;
  readonly passed: boolean;
  readonly english_confidence: number;
  readonly offending_segments: readonly {
    paragraph_id: string;
    reason: 'non_latin_script' | 'no_english_signal';
    sample: string;
  }[];
}

const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
const CJK_OR_KANA = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;
const CYRILLIC_GREEK_ARABIC = /[\u0370-\u03ff\u0400-\u04ff\u0600-\u06ff]/u;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

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
  const paragraphs = segmentParagraphs(source);
  const offending: LanguageCheckResult['offending_segments'][number][] = [];
  let englishParagraphs = 0;
  let considered = 0;

  for (const p of paragraphs) {
    const cleaned = stripAllowlisted(p.text, allowlist);
    if (HANGUL.test(cleaned) || CJK_OR_KANA.test(cleaned) || CYRILLIC_GREEK_ARABIC.test(cleaned)) {
      considered++;
      offending.push({
        paragraph_id: p.id,
        reason: 'non_latin_script',
        sample: p.text.slice(0, 80),
      });
      continue;
    }
    const words = cleaned.match(LATIN_WORD) ?? [];
    if (words.length === 0) continue; // punctuation-only / status-window separators do not count
    considered++;
    if (words.length < 4) {
      // Very short lines ("[F]", "Two.", "Kid—") cannot be judged; treat Latin-only short lines as English.
      englishParagraphs++;
      continue;
    }
    const signal = words.filter((w) => ENGLISH_SIGNAL.has(w.toLowerCase())).length;
    if (signal >= 1 || words.length < 8) {
      englishParagraphs++;
    } else {
      offending.push({
        paragraph_id: p.id,
        reason: 'no_english_signal',
        sample: p.text.slice(0, 80),
      });
    }
  }
  const confidence = considered === 0 ? 1 : englishParagraphs / considered;
  return {
    performed: true,
    passed: confidence >= minConfidence && offending.every((o) => o.reason !== 'non_latin_script'),
    english_confidence: Number(confidence.toFixed(4)),
    offending_segments: offending,
  };
}
