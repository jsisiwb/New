import { describe, expect, it } from 'vitest';
import {
  hiddenFromReader,
  knowledgeLayerOf,
  readerGuardsFor,
  readerStatus,
  renderRevealSchedule,
  revealSchedule,
} from './reveal-schedule.js';

// Synthetic one-line statements (test strings, not manuscript).
const bible = {
  propositions: [
    {
      local_id: 'P1',
      statement: '미래에서 돌아온 회귀자다.',
      kind: 'secret',
      entity_ids: ['hero'],
      truth: 'true' as const,
      secret: { owner_ids: ['hero'], allowed_knower_ids: ['hero'], reveal_not_before_chapter: 150 },
    },
    {
      local_id: 'P2',
      statement: '지난 생에서 방어선을 버리고 달아났다.',
      kind: 'secret',
      entity_ids: ['rival'],
      truth: 'true' as const,
      secret: {
        owner_ids: ['rival'],
        allowed_knower_ids: ['rival', 'hero'],
        reveal_not_before_chapter: 15,
      },
    },
    {
      local_id: 'P3',
      statement: '원작에서 이 교수는 3권에 죽는다.',
      kind: 'secret',
      entity_ids: ['prof'],
      truth: 'true' as const,
      secret: {
        owner_ids: ['prof'],
        allowed_knower_ids: ['hero'],
        reveal_not_before_chapter: 1,
        reader_reveal_chapter: 4,
      },
    },
    {
      local_id: 'P4',
      statement: '평범한 사실.',
      kind: 'fact',
      entity_ids: [],
      truth: 'true' as const,
    },
  ],
};

describe('reveal schedule (U1, G5-1)', () => {
  it('reads the layer from the statement unless the bible names it', () => {
    expect(knowledgeLayerOf('지난 생에서 배신했다.')).toBe('prior_life');
    expect(knowledgeLayerOf('회귀 전 기억으로 안다.')).toBe('prior_life');
    expect(knowledgeLayerOf('원작 소설 속 악역이다.')).toBe('source_work');
    expect(knowledgeLayerOf('그냥 비밀이다.')).toBe('current');
    expect(knowledgeLayerOf('원작 설정이다.', 'current')).toBe('current');
  });

  it('gives the narrator her own secrets from chapter 1 and keeps everyone else on the bible date', () => {
    const s = revealSchedule(bible, { narratorId: 'hero' });
    expect(s.map((x) => x.localId)).toEqual(['P1', 'P2', 'P3']);
    const [own, rival, p3] = s;
    expect(own).toMatchObject({ narratorOwn: true, readerFrom: 1, othersFrom: 150 });
    expect(rival).toMatchObject({ narratorOwn: false, readerFrom: 15, layer: 'prior_life' });
    // An explicit reader date wins over the character date.
    expect(p3).toMatchObject({ readerFrom: 4, othersFrom: 1, layer: 'source_work' });
    expect(readerStatus(own!, 1)).toBe('known');
    expect(readerStatus(rival!, 1)).toBe('hidden');
    expect(readerStatus(rival!, 15)).toBe('revealable');
    expect(readerStatus(rival!, 16)).toBe('known');
  });

  it('without a first-person narrator, the bible date binds the reader too', () => {
    const s = revealSchedule(bible);
    expect(s[0]).toMatchObject({ narratorOwn: false, readerFrom: 150 });
    expect(hiddenFromReader(s, 1).map((x) => x.localId)).toEqual(['P1', 'P2', 'P3']);
  });

  it('tells the checker what is not a leak and the planner what it may only hint at', () => {
    const s = revealSchedule(bible, { narratorId: 'hero' });
    const checker = renderRevealSchedule(s, 1, 'checker') ?? '';
    expect(checker).toContain('독자가 이미 아는 것');
    expect(checker).toContain('미래에서 돌아온 회귀자다.');
    expect(checker).toContain('독자에게 아직 밝히면 안 되는 것');
    expect(checker.indexOf('미래에서 돌아온')).toBeLessThan(checker.indexOf('아직 밝히면'));
    const names: Record<string, string> = { hero: '주인공', rival: '경쟁자', prof: '교수' };
    const planner =
      renderRevealSchedule(s, 1, 'planner', { hintBudget: 1, nameOf: (id) => names[id] ?? id }) ??
      '';
    expect(planner).toContain('암시는 한 화에 1번까지');
    expect(planner).toContain('회귀 전 기억과 원작·게임 지식은 주인공만 가진다');
    expect(/[A-Za-z]/.test(planner)).toBe(false);
    expect(renderRevealSchedule([], 1, 'writer')).toBeUndefined();
  });

  it('lists the chapter-hidden secrets as reader guards by canon id', () => {
    const s = revealSchedule(bible, { narratorId: 'hero' });
    const canon: Record<string, string> = { P1: 'c1', P2: 'c2', P3: 'c3' };
    expect(readerGuardsFor(s, 1, (l) => canon[l])).toEqual([
      { proposition_id: 'c2', reader_from_chapter: 15 },
      { proposition_id: 'c3', reader_from_chapter: 4 },
    ]);
    expect(readerGuardsFor(s, 4, (l) => canon[l])).toEqual([
      { proposition_id: 'c2', reader_from_chapter: 15 },
    ]);
  });
});
