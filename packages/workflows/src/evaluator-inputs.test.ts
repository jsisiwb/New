import { describe, expect, it } from 'vitest';
import { addressMatrix, readerSecrets } from './evaluator-inputs.js';
import { type ChapterContract, type StoryBible } from './planning.js';

const bible = {
  version: 1,
  entities: [
    { id: 'hero', type: 'character', display_name: '차강진' },
    { id: 'boss', type: 'character', display_name: '박창석' },
  ],
  propositions: [
    {
      local_id: 'P1',
      statement: '차강진은 회귀자다.',
      kind: 'secret',
      entity_ids: ['hero'],
      secret: { owner_ids: ['hero'], allowed_knower_ids: ['hero'], reveal_not_before_chapter: 150 },
      truth: 'true',
    },
    {
      local_id: 'P2',
      statement: '박창석은 장부를 빼돌린다.',
      kind: 'secret',
      entity_ids: ['boss'],
      secret: { owner_ids: ['boss'], allowed_knower_ids: ['boss'], reveal_not_before_chapter: 15 },
      truth: 'true',
    },
  ],
  promises: [],
} as unknown as StoryBible;

describe('reader secrets and the POV character (ADR-0074, defect A-3)', () => {
  it('lists every unrevealed secret by default', () => {
    const text = readerSecrets(1, bible, 'ko') ?? '';
    expect(text).toContain('차강진은 회귀자다.');
    expect(text).toContain('박창석은 장부를 빼돌린다.');
  });

  it('leaves out the POV character’s own secrets when asked', () => {
    const text = readerSecrets(1, bible, 'ko', { povEntityId: 'hero' }) ?? '';
    expect(text).not.toContain('차강진은 회귀자다.');
    expect(text).toContain('박창석은 장부를 빼돌린다.');
  });
});

describe('the 호칭 matrix and the 화 a relationship begins (ADR-0089, G7-3)', () => {
  const cast = {
    version: 1,
    entities: [
      {
        id: 'lucia',
        type: 'character',
        display_name: '루시아',
        design: {
          registers: [
            { toward: '카일', type: 'disciple', address_terms: ['사부님'], since_chapter: 1 },
            { toward: '빅토르', type: 'subordinate', address_terms: ['교수님'], since_chapter: 0 },
            { toward: '엘레나', type: 'rival', address_terms: ['엘레나'], since_chapter: 3 },
          ],
        },
      },
    ],
    propositions: [],
    promises: [],
  } as unknown as StoryBible;
  const contract = (n: number) =>
    ({
      chapter_number: n,
      participants: [{ character_id: 'lucia' }],
    }) as unknown as ChapterContract;

  it('lists every designed register when the policy dates none', () => {
    const text = addressMatrix(contract(1), cast, 'ko') ?? '';
    expect(text).toContain('루시아 → 카일: disciple; 호칭 ‘사부님’');
    expect(text).toContain('루시아 → 엘레나');
    expect(text).not.toContain('이 화에서 시작되는 관계');
  });

  it('marks a relationship that begins in this 화 and leaves out one that begins later', () => {
    const one = addressMatrix(contract(1), cast, 'ko', { timeFramed: true }) ?? '';
    expect(one).toContain(
      '루시아 → 카일: disciple; 호칭 ‘사부님’ (이 화에서 시작되는 관계다. 관계가 생긴 뒤에만 이 말높이와 호칭을 쓴다)',
    );
    expect(one).toMatch(/루시아 → 빅토르: subordinate; 호칭 ‘교수님’$/m);
    expect(one).not.toContain('엘레나');
    const two = addressMatrix(contract(2), cast, 'ko', { timeFramed: true }) ?? '';
    expect(two).toMatch(/루시아 → 카일: disciple; 호칭 ‘사부님’$/m);
    expect(two).not.toContain('이 화에서 시작되는 관계');
  });
});
