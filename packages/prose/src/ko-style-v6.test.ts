/**
 * lang/ko@6 rules (ADR-0073). Test strings are short synthetic studio sentences, not manuscript prose.
 */
import { describe, expect, it } from 'vitest';
import { lintKoreanWebnovel } from './ko-style.js';
import { thirdPersonDrift } from './ko-style-v6.js';

const V6 = {
  'KO-PUNCT-ELL': { warn: 6, fail: 12 },
  'KO-PUNCT-DASH': { warn: 1.5, fail: 4 },
  'KO-IDIOM-01': { warn: 1, fail: 3 },
  'KO-ORDER-01': { warn: 0.04, fail: 0.08 },
  'KO-NAME-03': { warn: 1, fail: 3 },
  'KO-NAME-04': { warn: 1, fail: 4 },
  'KO-POV-01': { warn: 2, fail: 5 },
};
const rules = (text: string, extra: Record<string, unknown> = {}) =>
  lintKoreanWebnovel(text, { thresholds: V6, ...extra }).findings.map((f) => f.rule_id);

describe('Korean lint v6 (ADR-0073)', () => {
  it('flags ellipsis and dash density per 1,000자', () => {
    const text =
      '그는 멈췄다… 그리고… 다시… 걸었다.\n\n문이 열렸다 — 아무도 없었다 — 바람만 불었다.';
    const found = rules(text);
    expect(found).toContain('KO-PUNCT-ELL');
    expect(found).toContain('KO-PUNCT-DASH');
  });

  it('flags Western idiom calques from the layer’s list', () => {
    const text = '강진은 어깨를 으쓱했다. 맙소사, 또 시작이군.';
    const report = lintKoreanWebnovel(text, {
      thresholds: V6,
      calquePhrases: ['어깨를 으쓱', '맙소사'],
    });
    const idioms = report.findings.filter((f) => f.rule_id === 'KO-IDIOM-01');
    expect(idioms.map((f) => f.quote)).toEqual(['어깨를 으쓱', '맙소사']);
    expect(idioms[0]?.severity).toBe('minor');
    expect(report.metrics.v6?.idioms).toBe(2);
  });

  it('flags narration that stacks three adnominal forms before a noun', () => {
    const text = '전략적인 판단을 내리는 냉정한 사령관이 이끄는 무자비한 군대가 다가왔다.';
    expect(rules(text)).toContain('KO-ORDER-01');
    expect(rules('군대가 다가왔다. 사령관은 냉정했다.')).not.toContain('KO-ORDER-01');
  });

  it('flags transposed, split and doubled names but never the registered name', () => {
    const names = { personNames: ['서진우'] };
    const text =
      '진서우가 웃었다. 서 진우는 대답하지 않았다. 서진진우라니. 서진우는 고개를 들었다.';
    const report = lintKoreanWebnovel(text, { thresholds: V6, ...names });
    const quotes = report.findings.filter((f) => f.rule_id === 'KO-NAME-03').map((f) => f.quote);
    expect(quotes).toEqual(expect.arrayContaining(['진서우', '서 진우', '서진진우']));
    expect(quotes).not.toContain('서진우');
  });

  it('runs none of the v6 rules for a layer without their thresholds', () => {
    const text = '강진은 어깨를 으쓱했다… 그리고… 또… 멈췄다 — 아무도 — 없었다.';
    const report = lintKoreanWebnovel(text, {
      thresholds: { 'KO-END-02': { warn: 5, fail: 9 } },
      calquePhrases: ['어깨를 으쓱'],
    });
    expect(
      report.findings.some((f) => f.rule_id.startsWith('KO-PUNCT') || f.rule_id === 'KO-IDIOM-01'),
    ).toBe(false);
    expect(report.metrics.v6).toBeUndefined();
  });

  it('does not flag the ordinary words live chapter 1 flagged under KO-NAME-02 (defect A-2)', () => {
    // The live cast: display names, and the aliases / short forms that matched ordinary words.
    const personNames = [
      '차강진',
      '강진',
      '독식자',
      '서지수',
      '지수',
      '마태동',
      '곰탱이',
      '백도현',
      '쓰레기',
      '정수아',
      '수아',
    ];
    const displayNames = ['차강진', '서지수', '마태동', '백도현', '정수아'];
    const text =
      '독식해 버린다. 차가운 바람. 수하들이 물러났다. 쓰기 전에. 지구가 흔들렸다. 곰탱 같은.';
    const report = lintKoreanWebnovel(text, { thresholds: V6, personNames, displayNames });
    expect(report.findings.filter((f) => f.rule_id.startsWith('KO-NAME'))).toEqual([]);
  });

  it('still flags a real misspelling of a full name: one jamo anywhere, two within one syllable', () => {
    const report = lintKoreanWebnovel('차강신이 웃었다. 서지누는 대답했다. 차강친? 백도헌이었다.', {
      thresholds: V6,
      personNames: ['차강진', '서진우', '백도현'],
      displayNames: ['차강진', '서진우', '백도현'],
    });
    const quotes = report.findings.filter((f) => f.rule_id === 'KO-NAME-04').map((f) => f.quote);
    expect(quotes).toEqual(expect.arrayContaining(['차강신', '서지누', '차강친', '백도헌']));
  });

  it('checks narration against the project point of view (KO-POV-01)', () => {
    const third = '강진은 문을 열었다. 복도는 비어 있었다. 그는 숨을 골랐다.'.repeat(30);
    const first = '나는 문을 열었다. 복도는 비어 있었다. 내가 숨을 골랐다.'.repeat(30);
    const rule = (text: string, pov: 'first' | 'third_limited') =>
      lintKoreanWebnovel(text, { thresholds: V6, pov }).findings.filter(
        (f) => f.rule_id === 'KO-POV-01',
      );
    expect(rule(third, 'first')[0]?.severity).toBe('major');
    expect(rule(first, 'first')).toEqual([]);
    expect(rule(first, 'third_limited')[0]?.severity).toBe('major');
    expect(rule(third, 'third_limited')).toEqual([]);
    // Dialogue and 속마음 are not narration.
    expect(rule('강진은 웃었다. “나는 간다.” ‘내가 옳다.’'.repeat(30), 'third_limited')).toEqual(
      [],
    );
  });
});

describe('third-person drift in a first-person scene (ADR-0090, G8-5)', () => {
  it('flags narration that names the narrator and hardly says 나', () => {
    const drifted = [
      '진혁은 소파에 털썩 주저앉았다.',
      '“왔어?”',
      '진혁이 고개를 들었다. 진혁의 눈이 가늘어졌다.',
      '내 몫은 아니었다.',
    ].join('\n');
    expect(thirdPersonDrift(drifted, ['강진혁', '진혁'])).toEqual({
      firstPerson: 1,
      named: 3,
      drifted: true,
    });
  });

  it('keeps a first-person scene, names inside dialogue and 속마음, and other characters', () => {
    const first = [
      '나는 소파에 주저앉았다.',
      '“진혁아, 진혁이 너 왔냐?”',
      '‘진혁은 무슨.’',
      '내가 먼저 일어섰다.',
    ].join('\n');
    expect(thirdPersonDrift(first, ['강진혁', '진혁']).drifted).toBe(false);
    expect(
      thirdPersonDrift('서유리는 웃었다. 서유리가 떠났다. 서유리의 잔.', ['강진혁', '진혁'])
        .drifted,
    ).toBe(false);
  });
});
