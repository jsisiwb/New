/**
 * `lang/ko@7` (ADR-0083): thresholds calibrated on the operator's chapters, dialogue share that counts
 * straight quotes (defect C-1), first-person bands, and the operator's own conventions no longer flagged.
 * Test strings are short synthetic lines.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintKoreanWebnovel, type KoStyleSource } from './ko-style.js';
import { talkShareOf } from './ko-style-v7.js';

const layer = (v: number) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../examples/narrative-profiles/lang-ko.v${String(v)}.json`, import.meta.url),
      'utf8',
    ),
  ) as {
    output_language: {
      translation_markers: KoStyleSource['translationMarkers'];
      forbidden_patterns: KoStyleSource['forbiddenPatterns'];
      lint_thresholds: KoStyleSource['thresholds'];
      calque_phrases: string[];
    };
  };
const sourceOf = (v: number, pov?: KoStyleSource['pov']): KoStyleSource => {
  const ol = layer(v).output_language;
  return {
    translationMarkers: ol.translation_markers,
    forbiddenPatterns: ol.forbidden_patterns,
    thresholds: ol.lint_thresholds,
    calquePhrases: ol.calque_phrases,
    ...(pov ? { pov } : {}),
  };
};
const rules = (text: string, src: KoStyleSource) =>
  lintKoreanWebnovel(text, src).findings.map((f) => `${f.rule_id}:${f.severity}`);

/** Twelve short lines: four straight-quoted dialogue lines, eight narration lines. */
const straightQuoted = [
  '"오늘은 늦었네."',
  '"조금 막혔어."',
  ...Array.from({ length: 4 }, (_, i) => `나는 복도 끝 창문을 ${String(i + 1)}번 두드렸다.`),
  '"그래도 왔잖아."',
  '"응, 왔어."',
  ...Array.from({ length: 4 }, (_, i) => `바람이 ${String(i + 1)}층 계단을 타고 올라왔다.`),
].join('\n\n');

describe('lang/ko@7 (ADR-0083)', () => {
  it('counts straight-quoted dialogue in the talk share, which lang/ko@6 missed (C-1)', () => {
    const share = talkShareOf(straightQuoted, straightQuoted.replace(/\n/g, '').length);
    expect(share).toBeGreaterThan(0.15);
    expect(rules(straightQuoted, sourceOf(6))).toContain('KO-DLG-SHARE:major');
    expect(rules(straightQuoted, sourceOf(7)).some((r) => r.startsWith('KO-TALK-SHARE'))).toBe(
      false,
    );
  });

  it('measures a first-person chapter against the first-person band', () => {
    const quiet = Array.from(
      { length: 14 },
      (_, i) => `나는 ${String(i + 1)}번째 문을 지나쳤다.`,
    ).join('\n\n');
    expect(rules(quiet, sourceOf(7, 'first'))).toContain('KO-TALK-SHARE-1P:major');
    expect(rules(quiet, sourceOf(7))).toContain('KO-TALK-SHARE:major');
    // The legacy dialogue floor never runs beside the new rule.
    expect(rules(quiet, sourceOf(7)).some((r) => r.startsWith('KO-DLG-LOW'))).toBe(false);
  });

  it('no longer flags the operator’s conventions: scene breaks, hyphen lines, naturalised interjections', () => {
    const text = ['* * *', '-챙!', '- 목표: 시험 통과', '“맙소사.”', '나는 어깨를 으쓱했다.'].join(
      '\n\n',
    );
    const v7 = rules(text, sourceOf(7, 'first'));
    expect(v7.some((r) => r.startsWith('SP-02'))).toBe(false);
    expect(v7.some((r) => r.startsWith('KO-IDIOM-01'))).toBe(false);
    // A markdown bullet or heading is still outline drift.
    expect(rules('# 제목\n\n* 첫째 항목', sourceOf(7))).toContain('SP-02:major');
  });

  it('carries corpus-calibrated thresholds with the calibration recorded', () => {
    const v7 = layer(7) as unknown as {
      output_language: { lint_thresholds: Record<string, { warn: number; fail: number }> };
      calibration: { status: string };
    };
    const th = v7.output_language.lint_thresholds;
    expect(v7.calibration.status).toBe('corpus_calibrated');
    expect(th['KO-DLG-SHARE']).toBeUndefined();
    expect(th['KO-TALK-SHARE']).toEqual({ warn: 0.113, fail: 0.023 });
    expect(th['KO-TALK-SHARE-1P']).toEqual({ warn: 0.126, fail: 0.059 });
    expect(th['KO-TRN-RATE']).toEqual({ warn: 0.94, fail: 1.36 });
  });
});
