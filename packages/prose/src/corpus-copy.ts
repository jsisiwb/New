/**
 * Verbatim-copy detection against the operator corpus (ADR-0082, C0.4). A draft span is a copy when it
 * shares at least `minChars` consecutive characters with the corpus, counting Hangul syllables, Latin
 * letters and digits only — spaces and punctuation are ignored, as the Korean 공백·문장부호 제외 count does.
 *
 * Why not raw characters: measured on the corpus, a 5,000자 pipeline draft that never saw it shares four
 * generic 14-character strings with spaces ("눈길 한 번 주지 않았다.") and none of 14 syllables; the
 * operator's own two books share only two 14-syllable phrases. Genre vocabulary and status-window formats
 * are short; a reused sentence is not.
 *
 * The index keeps one 53-bit rolling hash per window in a sorted Float64Array (about 24 MB for three million
 * windows) and verifies every hash hit against the corpus text, so a collision never raises a finding.
 */

const KEEP = /[\uac00-\ud7a3A-Za-z0-9]/u;
// Two 31-bit polynomial hashes combined into one exact 53-bit key: every intermediate product stays below
// 2^53, so the arithmetic is exact in doubles.
const M1 = 2_147_483_647;
const M2 = 2_147_483_629;
const B1 = 257;
const B2 = 263;

export interface SkeletonText {
  /** The kept characters, in order. */
  readonly chars: readonly string[];
  /** Code-point offset in the source text of each kept character. */
  readonly offsets: readonly number[];
}

export function skeletonOf(text: string): SkeletonText {
  const chars: string[] = [];
  const offsets: number[] = [];
  let cp = 0;
  for (const ch of text.normalize('NFC')) {
    if (KEEP.test(ch)) {
      chars.push(ch);
      offsets.push(cp);
    }
    cp += 1;
  }
  return { chars, offsets };
}

function powMod(base: number, exp: number, mod: number): number {
  let r = 1;
  for (let i = 0; i < exp; i++) r = (r * base) % mod;
  return r;
}

function windowHashes(chars: readonly string[], w: number): number[] {
  if (chars.length < w) return [];
  const p1 = powMod(B1, w - 1, M1);
  const p2 = powMod(B2, w - 1, M2);
  const codes = chars.map((c) => c.codePointAt(0) ?? 0);
  const out: number[] = [];
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < codes.length; i++) {
    if (i >= w) {
      const old = codes[i - w] ?? 0;
      h1 = (h1 - ((old * p1) % M1) + M1) % M1;
      h2 = (h2 - ((old * p2) % M2) + M2) % M2;
    }
    const c = codes[i] ?? 0;
    h1 = (h1 * B1 + c) % M1;
    h2 = (h2 * B2 + c) % M2;
    if (i >= w - 1) out.push(h1 * 4_194_304 + (h2 % 4_194_304));
  }
  return out;
}

export interface CorpusCopySpan {
  /** Code-point offsets into the NFC draft. */
  readonly start: number;
  readonly end: number;
  /** The draft's text over the span. */
  readonly quote: string;
  /** Kept characters shared with the corpus (the match length). */
  readonly chars: number;
  /** Id of the corpus source the span was verified against. */
  readonly source_id: string;
}

export class CorpusCopyIndex {
  private constructor(
    readonly minChars: number,
    private readonly hashes: Float64Array,
    private readonly skeleton: string,
    private readonly starts: readonly number[],
    private readonly ids: readonly string[],
  ) {}

  /** Windows indexed (for reporting); 0 for an empty corpus. */
  get size(): number {
    return this.hashes.length;
  }

  static build(sources: readonly { id: string; text: string }[], minChars = 14): CorpusCopyIndex {
    const all: number[] = [];
    const parts: string[] = [];
    const starts: number[] = [];
    const ids: string[] = [];
    let at = 0;
    for (const s of sources) {
      const sk = skeletonOf(s.text).chars;
      for (const h of windowHashes(sk, minChars)) all.push(h);
      starts.push(at);
      ids.push(s.id);
      const joined = sk.join('');
      parts.push(joined, '\u0000');
      at += joined.length + 1;
    }
    const hashes = Float64Array.from(all).sort();
    return new CorpusCopyIndex(minChars, hashes, parts.join(''), starts, ids);
  }

  private has(h: number): boolean {
    let lo = 0;
    let hi = this.hashes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = this.hashes[mid] ?? 0;
      if (v === h) return true;
      if (v < h) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }

  private sourceAt(offset: number): string {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return this.ids[lo] ?? '';
  }

  /** Maximal draft spans that share at least `minChars` kept characters with the corpus. */
  findCopies(draft: string): CorpusCopySpan[] {
    if (this.hashes.length === 0) return [];
    const nfc = draft.normalize('NFC');
    const cps = Array.from(nfc);
    const sk = skeletonOf(nfc);
    const w = this.minChars;
    // A hash hit counts only once its window is found in the corpus text itself.
    const verified = windowHashes(sk.chars, w).map((h, i) =>
      this.has(h) ? this.skeleton.indexOf(sk.chars.slice(i, i + w).join('')) : -1,
    );
    const out: CorpusCopySpan[] = [];
    let i = 0;
    while (i < verified.length) {
      if ((verified[i] ?? -1) < 0) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < verified.length && (verified[j + 1] ?? -1) >= 0) j++;
      const kept = j + w - i;
      const first = sk.offsets[i] ?? 0;
      const last = sk.offsets[j + w - 1] ?? first;
      out.push({
        start: first,
        end: last + 1,
        quote: cps.slice(first, last + 1).join(''),
        chars: kept,
        source_id: this.sourceAt(verified[i] ?? 0),
      });
      i = j + 1;
    }
    return out;
  }
}
