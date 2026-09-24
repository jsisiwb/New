import { describe, expect, it } from 'vitest';
import { type Ledgers } from '@yeonjae/context';
import { toNfcText } from '@yeonjae/prose';
import { checkPlanConsistency, draftLedgerFindings } from './ledger-checks.js';
import { type ChapterContract } from './planning.js';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const clock = (chapter_no: number, day: number) => ({
  chapter_no,
  ordinal: 0,
  precision: 'exact' as const,
  calendar: 'relative_days',
  world_date: `D+${String(day)}`,
});

function ledgers(over: Partial<Ledgers> = {}): Ledgers {
  return {
    chapterNo: 5,
    clockStart: clock(5, 12),
    previousClock: clock(4, 11),
    cards: [
      { entityId: A, name: '강하준', fields: {}, alive: true, lastChapter: 4 },
      { entityId: B, name: '윤서연', fields: {}, alive: true, lastChapter: 3 },
    ],
    countdowns: [
      { label: '게이트', days: 7, paragraph_id: 'p2', quote: '게이트까지 이레 남', chapter_no: 4 },
    ],
    countdownElapsed: { 게이트: 1 },
    address: [
      {
        fromId: A,
        toId: B,
        fromName: '강하준',
        toName: '윤서연',
        terms: ['선배님'],
        level: 'polite',
      },
    ],
    statusWindow: { bracket: '【', labels: ['이름', '레벨', '힘'], chapter_no: 1 },
    ...over,
  };
}

function contract(start = clock(5, 12)): ChapterContract {
  return {
    chapter_number: 5,
    timeline_id: '00000000-0000-7000-8000-0000000000f1',
    participants: [
      { character_id: A, role_in_chapter: 'protagonist', on_page: true },
      { character_id: B, role_in_chapter: 'ally', on_page: true },
    ],
    story_time: { start, end: start },
    purpose: '첫 게이트를 대비한다.',
    must_happen: [],
  } as unknown as ChapterContract;
}

describe('pre-draft plan check (ADR-0063)', () => {
  it('passes a plan that agrees with the ledgers', () => {
    const scenes = [{ summary: '게이트까지 엿새 남았다는 공지가 뜬다.' }];
    expect(
      checkPlanConsistency({ contract: contract(), scenes, ledgers: ledgers(), meetings: [] }),
    ).toEqual([]);
  });

  it('blocks a dead on-page character and story time running backwards', () => {
    const dead = ledgers({
      cards: [{ entityId: B, name: '윤서연', fields: {}, alive: false, lastChapter: 3 }],
    });
    const f = checkPlanConsistency({
      contract: contract(clock(5, 9)),
      scenes: [],
      ledgers: dead,
      meetings: [],
    });
    expect(f.map((x) => [x.rule, x.blocking])).toEqual([
      ['PLAN-DEAD-01', true],
      ['PLAN-CLOCK-01', true],
    ]);
    expect(f[0]?.message).toContain('윤서연');
  });

  it('records a planned countdown that disagrees and a reunion of strangers, without blocking', () => {
    const scenes = [{ summary: '강하준과 윤서연이 재회한다. 게이트까지 사흘 남았다.' }];
    const f = checkPlanConsistency({
      contract: contract(),
      scenes,
      ledgers: ledgers(),
      meetings: [{ a: A, b: B, chapter_no: null, event_id: null, related: false }],
    });
    expect(f.map((x) => [x.rule, x.blocking])).toEqual([
      ['PLAN-COUNT-01', false],
      ['PLAN-MEET-01', false],
    ]);
  });
});

describe('draft against the ledgers (ADR-0063)', () => {
  it('reports countdown, status-window and address-term findings with their dimensions', () => {
    const text = toNfcText(
      '게이트까지 사흘 남았다.\n\n[이름: 강하준]\n[레벨: 2]\n[힘: 11]\n\n“선배님, 여기 있었어?”',
    );
    const f = draftLedgerFindings(text, ledgers());
    expect(f.map((x) => [x.rule, x.dimension, x.kind, x.severity])).toEqual([
      ['CLOCK-COUNT-01', 'continuity', 'timeline_error', 'major'],
      ['FMT-WINDOW-01', 'genre', 'format_drift', 'minor'],
      ['REG-ADDR-01', 'voice', 'register_error', 'minor'],
    ]);
  });

  it('finds nothing in a draft that keeps the ledgers', () => {
    const text = toNfcText(
      '게이트까지 엿새 남았다.\n\n【이름: 강하준】\n【레벨: 2】\n【힘: 11】\n\n“선배님, 여기 계셨어요?”',
    );
    expect(draftLedgerFindings(text, ledgers())).toEqual([]);
  });
});
