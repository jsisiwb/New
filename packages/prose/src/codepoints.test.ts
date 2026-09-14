import { describe, expect, it } from 'vitest';
import { toNfcText, isNfc } from './nfc.js';
import {
  codePointLength,
  sliceCodePoints,
  codePointToUtf16Index,
  utf16IndexToCodePoint,
  findAllCodePointOffsets,
} from './codepoints.js';

// Conformance vector (ADR-0030): identical expectations are asserted by the Python validator and will be
// asserted in SQL in Checkpoint 2. Non-BMP characters (emoji, 𝔘), combining marks and Hangul included.
const VECTOR = [
  { text: 'plain ascii', cps: 11 },
  { text: 'curly “quotes” — em dash … ellipsis', cps: 35 },
  { text: 'emoji 🔥 here', cps: 12 }, // 🔥 is 1 code point, 2 UTF-16 units
  { text: '𝔘𝔫𝔦𝔠𝔬𝔡𝔢', cps: 7 }, // mathematical fraktur: all non-BMP
  { text: 'café', cps: 4 }, // NFC composes e + ◌́ into é
  { text: 'Kang Do-yoon (강도윤)', cps: 18 },
  { text: '👩‍🚀', cps: 3 }, // ZWJ sequence: 3 code points, 1 grapheme
];

describe('code-point addressing (ADR-0030)', () => {
  it.each(VECTOR)('counts code points for $text', ({ text, cps }) => {
    const nfc = toNfcText(text);
    expect(nfc.codePoints.length).toBe(cps);
    expect(codePointLength(nfc.text)).toBe(cps);
  });

  it('normalizes decomposed input to NFC before addressing', () => {
    const decomposed = 'cafe\u0301';
    expect(isNfc(decomposed)).toBe(false);
    const nfc = toNfcText(decomposed);
    expect(nfc.text).toBe('café');
    expect(nfc.codePoints.length).toBe(4);
  });

  it('slices by code points, not UTF-16 units', () => {
    const nfc = toNfcText('a🔥b𝔘c');
    expect(sliceCodePoints(nfc, 1, 2)).toBe('🔥');
    expect(sliceCodePoints(nfc, 3, 4)).toBe('𝔘');
    expect(sliceCodePoints(nfc, 0, 5)).toBe('a🔥b𝔘c');
    expect(nfc.text.length).toBe(7); // UTF-16 view differs
  });

  it('rejects invalid spans', () => {
    const nfc = toNfcText('abc');
    expect(() => sliceCodePoints(nfc, 2, 1)).toThrow(RangeError);
    expect(() => sliceCodePoints(nfc, 0, 4)).toThrow(RangeError);
    expect(() => sliceCodePoints(nfc, -1, 1)).toThrow(RangeError);
  });

  it('maps code-point offsets to UTF-16 indices and back', () => {
    const text = 'a🔥b𝔘c';
    const nfc = toNfcText(text);
    for (let cp = 0; cp <= nfc.codePoints.length; cp++) {
      const u = codePointToUtf16Index(nfc, cp);
      expect(utf16IndexToCodePoint(text, u)).toBe(cp);
    }
    expect(codePointToUtf16Index(nfc, 2)).toBe(3);
    expect(() => utf16IndexToCodePoint(text, 2)).toThrow(/splits a surrogate pair/);
  });

  it('finds all occurrences as code-point offsets', () => {
    const nfc = toNfcText('🔥 fog 🔥 fog');
    expect(findAllCodePointOffsets(nfc, 'fog')).toEqual([2, 8]);
    expect(findAllCodePointOffsets(nfc, 'missing')).toEqual([]);
  });
});
