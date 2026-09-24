import { describe, expect, it } from 'vitest';
import { toNfcText } from './nfc.js';
import { checkCountdowns, extractCountdowns, latestCountdowns } from './story-clock.js';

const mentions = (s: string) => extractCountdowns(toNfcText(s));

describe('countdown mentions (ADR-0063)', () => {
  it('reads D-N, digits and native day words, with the label before 까지', () => {
    const m = mentions(
      '게이트까지 열흘 남았다. 달력에는 D-10이라고 적혀 있었다.\n\n시험까지 3일밖에 안 남았다.',
    );
    expect(m.map((x) => [x.label, x.days])).toEqual([
      ['게이트', 10],
      ['D', 10],
      ['시험', 3],
    ]);
    expect(mentions('이틀이 남았다.')[0]).toMatchObject({ label: '', days: 2 });
  });

  it('does not read a time skip (N일 뒤) as a countdown', () => {
    expect(mentions('사흘 뒤, 그는 다시 길드를 찾았다. 열흘 후에 보자.')).toEqual([]);
  });

  it('keeps the latest accepted mention per label', () => {
    const ledger = latestCountdowns([
      { chapter_no: 2, mentions: mentions('게이트까지 열흘 남았다.') },
      { chapter_no: 3, mentions: mentions('게이트까지 이레 남았다.') },
    ]);
    expect(ledger).toEqual([expect.objectContaining({ label: '게이트', days: 7, chapter_no: 3 })]);
  });

  it('flags a first mention that disagrees with the ledger once elapsed days are known', () => {
    const ledger = latestCountdowns([
      { chapter_no: 3, mentions: mentions('게이트까지 이레 남았다.') },
    ]);
    const ok = checkCountdowns(mentions('게이트까지 닷새 남았다.'), ledger, { 게이트: 2 });
    expect(ok).toEqual([]);
    const bad = checkCountdowns(mentions('게이트까지 사흘 남았다.'), ledger, { 게이트: 2 });
    expect(bad).toEqual([
      expect.objectContaining({ rule: 'CLOCK-COUNT-01', severity: 'major', expected: 5, found: 3 }),
    ]);
  });

  it('without elapsed days, flags only a countdown that grows', () => {
    const ledger = latestCountdowns([{ chapter_no: 3, mentions: mentions('D-7') }]);
    expect(checkCountdowns(mentions('D-6. 하루가 지났다. D-5'), ledger, {})).toEqual([]);
    expect(checkCountdowns(mentions('D-9'), ledger, {})).toEqual([
      expect.objectContaining({ rule: 'CLOCK-COUNT-02', expected: 7, found: 9 }),
    ]);
    expect(checkCountdowns(mentions('D-5 그리고 D-6'), [], {})).toEqual([
      expect.objectContaining({ rule: 'CLOCK-COUNT-02', expected: 5, found: 6 }),
    ]);
  });
});
