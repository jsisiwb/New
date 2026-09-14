/**
 * Unicode code-point addressing (ADR-0030). JavaScript strings index UTF-16 units; canon evidence uses
 * code-point offsets into NFC text so that TypeScript, Python, PostgreSQL and the browser agree. These
 * helpers are the only sanctioned way to slice or measure manuscript text.
 */
import { type NfcText } from './nfc.js';

export interface CodePointSpan {
  /** inclusive code-point offset */
  readonly start: number;
  /** exclusive code-point offset */
  readonly end: number;
}

export function codePointLength(text: string): number {
  let n = 0;
  for (const _cp of text) n++;
  return n;
}

export function sliceCodePoints(source: NfcText | string, start: number, end: number): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new RangeError(`invalid code-point span [${start}, ${end})`);
  }
  const cps = typeof source === 'string' ? Array.from(source) : source.codePoints;
  if (end > cps.length) {
    throw new RangeError(`span end ${end} exceeds text length ${cps.length} code points`);
  }
  return cps.slice(start, end).join('');
}

/** Map a code-point offset to the UTF-16 index the browser/JS APIs need (Range mapping). */
export function codePointToUtf16Index(source: NfcText | string, codePointOffset: number): number {
  const cps = typeof source === 'string' ? Array.from(source) : source.codePoints;
  if (codePointOffset < 0 || codePointOffset > cps.length) {
    throw new RangeError(`code-point offset ${codePointOffset} out of range 0..${cps.length}`);
  }
  let units = 0;
  for (let i = 0; i < codePointOffset; i++) {
    const cp = cps[i];
    if (cp === undefined) break;
    units += cp.length;
  }
  return units;
}

/** Inverse of codePointToUtf16Index; throws if the UTF-16 index splits a surrogate pair. */
export function utf16IndexToCodePoint(text: string, utf16Index: number): number {
  if (utf16Index < 0 || utf16Index > text.length) {
    throw new RangeError(`utf16 index ${utf16Index} out of range 0..${text.length}`);
  }
  let cpIndex = 0;
  let i = 0;
  while (i < utf16Index) {
    const code = text.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const step = isHigh ? 2 : 1;
    if (i + step > utf16Index) {
      throw new RangeError(`utf16 index ${utf16Index} splits a surrogate pair`);
    }
    i += step;
    cpIndex++;
  }
  return cpIndex;
}

/** Find every code-point offset at which `needle` occurs in `haystack` (both NFC). */
export function findAllCodePointOffsets(haystack: NfcText, needle: string): number[] {
  const needleNfc = needle.normalize('NFC');
  const out: number[] = [];
  let fromUtf16 = 0;
  for (;;) {
    const idx = haystack.text.indexOf(needleNfc, fromUtf16);
    if (idx < 0) break;
    out.push(utf16IndexToCodePoint(haystack.text, idx));
    fromUtf16 = idx + Math.max(1, needleNfc.length);
  }
  return out;
}
