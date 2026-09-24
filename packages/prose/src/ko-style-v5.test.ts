import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { editDistance, jamo } from './ko-style-v5.js';
import { koStyleDigest, lintKoreanWebnovel } from './ko-style.js';

const layer = (v: number) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../../examples/narrative-profiles/lang-ko.v${String(v)}.json`, import.meta.url),
      ),
      'utf8',
    ),
  ) as { output_language: { lint_thresholds: Record<string, { warn: number; fail: number }> } };
const v5 = { thresholds: layer(5).output_language.lint_thresholds };
const v4 = { thresholds: layer(4).output_language.lint_thresholds };
const rules = (text: string, src: object) =>
  lintKoreanWebnovel(text, src).findings.map((f) => f.rule_id);

// ADR-0065 / audit §7.6: a synthetic passage written the way translated or AI prose reads. Every sentence is a
// studio test string, not taken from any work.
const TRANSLATED = [
  '그는, 천천히, 문을 열기 시작했다. 방 안은 어두웠고, 차가웠고, 조용했다.',
  '그것은 그가 오랫동안 기다려 온 순간이었던 것이다. 그는 심장이 빠르게 뛰는 것이 느껴졌다.',
  '그는 창밖을 볼 수 있었다. 그는 바람을 느낄 수 있었다. 그는 모든 것을 알 수 있었다.',
  '그리고 그는 다시 걷기 시작했다. 그러나 발걸음은, 무겁고, 느렸고, 망설임으로 가득 차 있었던 것이다.',
  '그렇게 그의 길고 길었던 하루가 저물어 갔다. 앞으로 어떤 운명이 그를 기다리고 있을지 아직 아무도 몰랐다.',
].join('\n\n');

describe('lang/ko@5 lint (ADR-0065)', () => {
  it('fails the synthetic translated-prose fixture on the new rules (audit §7.6)', () => {
    const r = lintKoreanWebnovel(TRANSLATED, v5);
    const ids = r.findings.map((f) => f.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'KO-OVR-01',
        'KO-OVR-02',
        'KO-OVR-03',
        'KO-OVR-04',
        'KO-COMMA-RATE',
        'KO-END-03',
      ]),
    );
    expect(r.findings.filter((f) => f.severity === 'major').length).toBeGreaterThanOrEqual(4);
    expect(r.metrics.v5?.comma_per_1k).toBeGreaterThan(20);
    expect(koStyleDigest(r)).toMatch(/\n문장·습관: 서술 문장 평균 [\d.]+자/);
  });

  it('runs none of them for lang/ko@4, whose digest keeps its bytes', () => {
    const r = lintKoreanWebnovel(TRANSLATED, v4);
    expect(
      r.findings.some((f) => /^KO-(OVR|COMMA|SENT|DLG-SHARE|END-03|NAME-02|WIN)/.test(f.rule_id)),
    ).toBe(false);
    expect(r.metrics.v5).toBeUndefined();
    expect(koStyleDigest(r)).not.toContain('문장·습관');
    expect(rules(TRANSLATED, v4)).toContain('KO-END-01');
  });

  it('counts 속마음 with dialogue and flags long narration sentences', () => {
    const talky = Array.from(
      { length: 12 },
      (_, i) => `‘이상하다.’ 그가 생각했다.\n\n“${String(i)}번째 문이야.” 그녀가 말했다.`,
    ).join('\n\n');
    expect(rules(talky, v5)).not.toContain('KO-DLG-SHARE');
    const flat = Array.from(
      { length: 12 },
      () =>
        '그는 한참 동안 아무 말도 하지 않은 채 창가에 서서 멀리 보이는 성벽 너머로 천천히 지는 붉은 해를 오래도록 바라보고 있었다.',
    ).join('\n\n');
    expect(rules(flat, v5)).toEqual(expect.arrayContaining(['KO-DLG-SHARE', 'KO-SENT-LONG']));
  });

  it('finds a misspelled multi-syllable name at the jamo level, never a registered short form', () => {
    expect(editDistance(jamo('서지누'), jamo('서진우'))).toBe(1);
    const src = { ...v5, personNames: ['서진우', '진우'] };
    const f = lintKoreanWebnovel(
      '서지누가 웃었다. 진우는 대답하지 않았다. 서진우의 손이 떨렸다.',
      src,
    ).findings;
    expect(f.filter((x) => x.rule_id === 'KO-NAME-02').map((x) => x.quote)).toEqual(['서지누']);
  });

  it('flags a paragraph that nearly copies an exemplar, and a crowded status window', () => {
    const exemplar =
      '성문 앞에 선 사내는 손끝으로 녹슨 쇠고리를 한 번 쓸어 보고는 대답 대신 짧게 웃었다.';
    const copy =
      '성문 앞에 선 사내는 손끝으로 녹슨 쇠고리를 한 번 쓸어 보고는 대답 대신 짧게 웃었지.';
    expect(rules(copy, { ...v5, exemplarTexts: [exemplar] })).toContain('EXEMPLAR-NEAR');
    expect(rules('[상태창]\n이름: 강하준\n힘: 10 / 민첩: 12', v5)).toContain('KO-WIN-LINE');
  });
});
