/**
 * NFC normalization at the boundary (ADR-0030). Every text that enters the domain passes through here
 * exactly once; all offsets are computed on the returned value.
 */
export interface NfcText {
  readonly text: string;
  /** Unicode code points (not UTF-16 units), materialized once so offsets are O(1). */
  readonly codePoints: readonly string[];
}

export function normalizeNfc(input: string): string {
  return input.normalize('NFC');
}

export function isNfc(input: string): boolean {
  return input === input.normalize('NFC');
}

export function toNfcText(input: string): NfcText {
  const text = normalizeNfc(input);
  return { text, codePoints: Array.from(text) };
}
