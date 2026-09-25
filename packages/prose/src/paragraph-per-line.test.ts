/** One paragraph per line (ADR-0081): only line breaks change, never words or their order. */
import { describe, expect, it } from 'vitest';
import { paragraphPerLine } from './paragraphs.js';

describe('paragraphPerLine (ADR-0081)', () => {
  it('turns every line break into a paragraph break and collapses blank runs', () => {
    expect(paragraphPerLine('첫 줄.\n“대사.”\n\n\n\n셋째 줄.\r\n넷째 줄.  ')).toBe(
      '첫 줄.\n\n“대사.”\n\n셋째 줄.\n\n넷째 줄.',
    );
  });

  it('leaves text that already has one paragraph per line unchanged, apart from outer whitespace', () => {
    const t = '첫 줄.\n\n둘째 줄.';
    expect(paragraphPerLine(`\n${t}\n`)).toBe(t);
  });

  it('keeps every character of the words', () => {
    const t = '살점이 뜯겨 나가는 감각.\n목줄기를 파고드는 이빨.\n‘젠장.’';
    expect(paragraphPerLine(t).replace(/\s+/g, '')).toBe(t.replace(/\s+/g, ''));
  });
});
