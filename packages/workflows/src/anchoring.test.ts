import { codePointLength, toNfcText } from '@yeonjae/prose';
import { describe, expect, it } from 'vitest';
import { foldQuoteMarks, locateQuote } from './anchoring.js';

const TEXT = toNfcText('“이게 무슨……”\n\n문이 벌컥 열렸다.\n\n"이안! 너 왜 그렇게 창백해?"');

describe('locateQuote', () => {
  it('matches exactly, then across whitespace', () => {
    expect(locateQuote(TEXT, '문이 벌컥 열렸다.')).toEqual({
      start: 11,
      end: 21,
      quote: '문이 벌컥 열렸다.',
    });
    expect(locateQuote(TEXT, '벌컥 열렸다. "이안! 너 왜')?.quote).toBe(
      '벌컥 열렸다.\n\n"이안! 너 왜',
    );
  });

  it('matches a quote whose quotation marks were retyped, returning the text’s own slice', () => {
    expect(locateQuote(TEXT, '"이게 무슨……"')).toEqual({
      start: 0,
      end: 9,
      quote: '“이게 무슨……”',
    });
    expect(locateQuote(TEXT, '“이안! 너 왜 그렇게 창백해?”')?.quote).toBe(
      '"이안! 너 왜 그렇게 창백해?"',
    );
  });

  it('finds nothing that is not in the text', () => {
    expect(locateQuote(TEXT, '"방이 우리 넷이라니"')).toBeUndefined();
  });

  it('folds one code point for one', () => {
    const s = '“가” ‘나’ ＂다＂';
    expect(foldQuoteMarks(s)).toBe('"가" \'나\' "다"');
    expect(codePointLength(foldQuoteMarks(s))).toBe(codePointLength(s));
  });
});
