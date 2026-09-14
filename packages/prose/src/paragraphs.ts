/**
 * Paragraph segmentation with stable ids (p1, p2, …) and code-point boundaries. Paragraphs are separated by
 * one or more blank lines; leading/trailing whitespace inside a paragraph is preserved so offsets stay exact.
 */
import { type NfcText } from './nfc.js';
import { utf16IndexToCodePoint } from './codepoints.js';

export interface Paragraph {
  readonly id: string;
  /** inclusive code-point offset */
  readonly start: number;
  /** exclusive code-point offset */
  readonly end: number;
  readonly text: string;
}

const BLANK_LINE = /\n[ \t]*\n+/g;

export function segmentParagraphs(source: NfcText): Paragraph[] {
  const { text } = source;
  const out: Paragraph[] = [];
  let startUtf16 = 0;
  const push = (a: number, b: number) => {
    // Trim trailing newlines of the final paragraph only (they are not part of any paragraph).
    let endUtf16 = b;
    while (endUtf16 > a && text[endUtf16 - 1] === '\n') endUtf16--;
    if (endUtf16 <= a) return;
    out.push({
      id: `p${out.length + 1}`,
      start: utf16IndexToCodePoint(text, a),
      end: utf16IndexToCodePoint(text, endUtf16),
      text: text.slice(a, endUtf16),
    });
  };
  for (const m of text.matchAll(BLANK_LINE)) {
    push(startUtf16, m.index);
    startUtf16 = m.index + m[0].length;
  }
  push(startUtf16, text.length);
  return out;
}

export function paragraphAt(
  paragraphs: readonly Paragraph[],
  codePointOffset: number,
): Paragraph | undefined {
  return paragraphs.find((p) => p.start <= codePointOffset && codePointOffset < p.end);
}
