/**
 * `lang/ko@7` lint rules (ADR-0083), calibrated on the operator's own chapters (C4). Each rule runs only when
 * the layer carries its threshold, so every earlier layer lints exactly as before.
 *
 *   - KO-TALK-SHARE: dialogue plus 속마음 as a share of characters, low fails. Replaces KO-DLG-SHARE, which
 *     counted curly quotes only (defect C-1): the operator's second book writes dialogue in straight quotes.
 *     A first-person chapter is measured against KO-TALK-SHARE-1P when the layer carries it.
 *   - KO-PRN-RATE-1P: the 그/그녀 rate band of first-person chapters (read by the core rate rule).
 */
import { codePointLength } from './codepoints.js';

interface Threshold {
  readonly warn: number;
  readonly fail: number;
}

export interface V7Finding {
  readonly rule_id: string;
  readonly kind: 'weak_pacing';
  readonly severity: 'minor' | 'major';
  readonly message: string;
  readonly paragraph_ids: readonly string[];
  readonly value: number;
  readonly threshold: number;
}

export interface V7Metrics {
  /** Dialogue (curly or straight quotes) plus 속마음 (‘…’), as a share of characters. */
  readonly talk_share: number;
}

/** Quoted speech in curly or straight double quotes, and 속마음 in curly single quotes. */
const TALK = /“[^”\n]*”|"[^"\n]*"|‘[^’\n]*’/gu;

export function talkShareOf(text: string, chars: number): number {
  if (chars === 0) return 0;
  let n = 0;
  for (const m of text.matchAll(TALK)) n += codePointLength(m[0]);
  return Math.round((n / chars) * 1000) / 1000;
}

export function lintV7(input: {
  readonly text: string;
  readonly chars: number;
  readonly thresholds?: Readonly<Record<string, Threshold | undefined>> | undefined;
  readonly pov?: 'first' | 'third_limited' | 'third_omniscient' | undefined;
}): { findings: V7Finding[]; metrics?: V7Metrics } {
  const t = input.thresholds ?? {};
  const general = t['KO-TALK-SHARE'];
  if (!general) return { findings: [] };
  const firstPerson = input.pov === 'first' ? t['KO-TALK-SHARE-1P'] : undefined;
  const th = firstPerson ?? general;
  const id = firstPerson ? 'KO-TALK-SHARE-1P' : 'KO-TALK-SHARE';
  const share = talkShareOf(input.text, input.chars);
  const findings: V7Finding[] = [];
  if (share < th.warn) {
    const fail = share < th.fail;
    findings.push({
      rule_id: id,
      kind: 'weak_pacing',
      severity: fail ? 'major' : 'minor',
      message: `대사와 속마음 비중 ${String(Math.round(share * 100))}% (운영자 원고의 ${fail ? '최저선' : '보통'} 범위 ${String(Math.round((fail ? th.fail : th.warn) * 100))}% 이상). 요약 서술을 대사와 반응 비트로 바꾼다.`,
      paragraph_ids: [],
      value: share,
      threshold: fail ? th.fail : th.warn,
    });
  }
  return { findings, metrics: { talk_share: share } };
}
