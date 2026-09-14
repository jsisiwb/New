import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toNfcText } from './nfc.js';
import { quoteHash, verifyEvidence } from './evidence.js';
import { segmentParagraphs, paragraphAt } from './paragraphs.js';

const FIXTURE = fileURLToPath(
  new URL('../../../examples/fixture/manuscripts/ch09.accepted.txt', import.meta.url),
);
const DELTA = fileURLToPath(
  new URL('../../../examples/fixture/canon-delta.ch09.json', import.meta.url),
);

interface DeltaEvidence {
  manuscript_version_id: string;
  paragraph_id?: string;
  start: number;
  end: number;
  quote: string;
  quote_hash?: string;
}
interface Delta {
  items: { local_id: string; evidence: DeltaEvidence[] }[];
}

describe('evidence verification against the fixture manuscript', () => {
  const text = toNfcText(readFileSync(FIXTURE, 'utf8'));
  const delta = JSON.parse(readFileSync(DELTA, 'utf8')) as Delta;
  const paragraphs = segmentParagraphs(text);

  it('every fixture evidence span verifies exactly (code points, hash, paragraph id)', () => {
    for (const item of delta.items) {
      for (const ev of item.evidence) {
        const verdict = verifyEvidence(text, {
          start: ev.start,
          end: ev.end,
          quote: ev.quote,
          quoteHash: ev.quote_hash,
        });
        expect(verdict, `${item.local_id}: ${JSON.stringify(verdict)}`).toEqual({ ok: true });
        if (ev.paragraph_id !== undefined) {
          expect(paragraphAt(paragraphs, ev.start)?.id).toBe(ev.paragraph_id);
        }
      }
    }
  });

  it('detects an off-by-one offset, a paraphrase and a bad hash', () => {
    const ev = delta.items[0]?.evidence[0];
    if (!ev) throw new Error('fixture has no evidence');
    expect(verifyEvidence(text, { start: ev.start + 1, end: ev.end + 1, quote: ev.quote }).ok).toBe(
      false,
    );
    expect(
      verifyEvidence(text, {
        start: ev.start,
        end: ev.end,
        quote: ev.quote.replace('Black', 'Dark '),
      }).ok,
    ).toBe(false);
    expect(
      verifyEvidence(text, {
        start: ev.start,
        end: ev.end,
        quote: ev.quote,
        quoteHash: 'sha256:00',
      }),
    ).toMatchObject({ ok: false, reason: 'hash_mismatch' });
  });

  it('non-BMP text: quote length is measured in code points', () => {
    const t = toNfcText('The 🔥 sign glowed. 𝔘 was next.');
    const quote = '🔥 sign';
    expect(verifyEvidence(t, { start: 4, end: 4 + 6, quote, quoteHash: quoteHash(quote) })).toEqual(
      {
        ok: true,
      },
    );
    // UTF-16 length of the quote is 7; using it as the span length must fail.
    expect(verifyEvidence(t, { start: 4, end: 4 + quote.length, quote }).ok).toBe(false);
  });

  it('rejects a quote that is not NFC', () => {
    const t = toNfcText('café au lait');
    expect(verifyEvidence(t, { start: 0, end: 4, quote: 'cafe\u0301' })).toMatchObject({
      ok: false,
      reason: 'quote_not_nfc',
    });
  });
});
