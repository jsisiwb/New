/**
 * Evidence-span verification (ADR-0030, ADR-0006). A span is valid only if the code-point slice of the
 * referenced NFC text equals the quote exactly and the quote is itself NFC. No fuzzy matching here — the
 * reconciler owns re-anchoring; this is the deterministic last check before a canon write.
 */
import { createHash } from 'node:crypto';
import { sliceCodePoints, codePointLength, type CodePointSpan } from './codepoints.js';
import { type NfcText, isNfc } from './nfc.js';

export interface EvidenceQuote extends CodePointSpan {
  readonly quote: string;
  readonly quoteHash?: string | undefined;
}

export type EvidenceVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        'quote_not_nfc' | 'length_mismatch' | 'slice_mismatch' | 'hash_mismatch' | 'out_of_range';
      detail: string;
    };

export function quoteHash(quote: string): string {
  return `sha256:${createHash('sha256').update(quote, 'utf8').digest('hex')}`;
}

export function verifyEvidence(text: NfcText, ev: EvidenceQuote): EvidenceVerdict {
  if (!isNfc(ev.quote)) {
    return { ok: false, reason: 'quote_not_nfc', detail: 'quote is not NFC-normalized' };
  }
  const expectedLen = ev.end - ev.start;
  const quoteLen = codePointLength(ev.quote);
  if (expectedLen !== quoteLen) {
    return {
      ok: false,
      reason: 'length_mismatch',
      detail: `end-start=${expectedLen} but quote has ${quoteLen} code points`,
    };
  }
  let slice: string;
  try {
    slice = sliceCodePoints(text, ev.start, ev.end);
  } catch (err) {
    return {
      ok: false,
      reason: 'out_of_range',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (slice !== ev.quote) {
    return {
      ok: false,
      reason: 'slice_mismatch',
      detail: `text[${ev.start}:${ev.end}] is ${JSON.stringify(slice.slice(0, 60))}`,
    };
  }
  if (ev.quoteHash !== undefined && ev.quoteHash !== quoteHash(ev.quote)) {
    return {
      ok: false,
      reason: 'hash_mismatch',
      detail: 'quote_hash does not match sha256(quote)',
    };
  }
  return { ok: true };
}
