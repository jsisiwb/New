/**
 * Address terms against the 호칭/말높이 ledger (ADR-0063). A quoted utterance that uses a registered address term
 * of a directed pair names its addressee; its closing 말높이 should match the pair's expected one. The
 * check reads only utterances that carry a registered term, so an unattributed line is never guessed at.
 */
import { sentenceLevel, type SpeechLevel } from './dialogue-register.js';
import { type NfcText } from './nfc.js';
import { segmentParagraphs } from './paragraphs.js';

export interface AddressExpectation {
  readonly from: string;
  readonly to: string;
  readonly terms: readonly string[];
  readonly level: 'polite' | 'plain';
}

export interface AddressFinding {
  readonly rule: 'REG-ADDR-01';
  readonly severity: 'minor';
  readonly paragraph_id: string;
  readonly quote: string;
  readonly message: string;
}

const QUOTED = /“([^”]+)”/gu;
const SENTENCES = /[^.!?…~]+[.!?…~]*/gu;

function closingLevel(utterance: string): SpeechLevel | undefined {
  const sentences = [...utterance.matchAll(SENTENCES)].map((m) => m[0].trim()).filter(Boolean);
  for (let i = sentences.length - 1; i >= 0; i--) {
    const level = sentenceLevel(sentences[i] ?? '');
    if (level) return level;
  }
  return undefined;
}

function usesTerm(utterance: string, term: string): boolean {
  if (!term.trim()) return false;
  const at = utterance.indexOf(term);
  if (at < 0) return false;
  const before = utterance[at - 1] ?? ' ';
  return !/[가-힣]/u.test(before);
}

export function checkAddressRegister(
  text: NfcText,
  expectations: readonly AddressExpectation[],
): AddressFinding[] {
  const out: AddressFinding[] = [];
  const unique = expectations.filter((e) => e.terms.length > 0);
  for (const p of segmentParagraphs(text))
    for (const m of p.text.matchAll(QUOTED)) {
      const utterance = m[1] ?? '';
      const hits = unique.filter((e) => e.terms.some((t) => usesTerm(utterance, t)));
      // A term registered for pairs that expect different levels says nothing about this line.
      if (hits.length === 0 || new Set(hits.map((h) => h.level)).size > 1) continue;
      const expected = hits[0];
      if (!expected) continue;
      const level = closingLevel(utterance);
      if (!level) continue;
      const polite = level !== 'banmal';
      if (polite === (expected.level === 'polite')) continue;
      const term = expected.terms.find((t) => usesTerm(utterance, t)) ?? '';
      out.push({
        rule: 'REG-ADDR-01',
        severity: 'minor',
        paragraph_id: p.id,
        quote: m[0],
        message: `‘${term}’(${expected.from} → ${expected.to})로 부른 대사가 ${polite ? '존댓말' : '반말'}이다. 장부의 말높이는 ${expected.level === 'polite' ? '존댓말' : '반말'}이다. 바뀐 이유가 장면에 없으면 맞춘다.`,
      });
    }
  return out;
}
