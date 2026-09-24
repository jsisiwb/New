import { describe, expect, it } from 'vitest';
import {
  castBatchBrief,
  mergeCastBatches,
  missingSuppliedNames,
  newCharacters,
  type CastCharacter,
} from './cast-batches.js';
import { type StoryIntake } from './planning.js';

const intake = {
  title_working: '재의 장부',
  premise: '파면당한 회계사가 조작된 장부를 증명한다.',
  premise_language: 'ko',
  manuscript_language: 'ko',
  genre: { primary: 'hunter-gate' },
  main_character: { name: '서지안', role: 'protagonist', description: '29세.' },
  supporting_characters: [
    { name: '백태호', role: 'mentor', description: '48세.' },
    { name: '문해린', role: 'antagonist', description: '35세.' },
  ],
  target_chapters: 2,
  operating_mode: 'autopilot',
} as unknown as StoryIntake;

const hero: CastCharacter = { display_name: '서지안', role: 'protagonist', registers: [] };
const mentor: CastCharacter = {
  display_name: '백태호',
  role: 'mentor',
  registers: [{ toward: '서지안', type: 'mentor' }],
};

/** Latin words in a Korean brief other than the answer schema's own keys. */
const latin = (text: string): string[] =>
  [...text.matchAll(/[A-Za-z_]{2,}/g)]
    .map((m) => m[0])
    .filter((w) => !['characters', 'registers', 'display_name'].includes(w));

describe('cast batches (ADR-0072)', () => {
  it('asks the first batch for the protagonist only, in Korean', () => {
    const brief = castBatchBrief('protagonist', 'ko', { intake, designed: [] });
    expect(brief).toContain('주인공: 서지안');
    expect(brief).toContain('주인공 한 명만 설계한다');
    expect(latin(brief)).toEqual([]);
  });

  it('names what exists with Korean role labels and asks for the protagonist’s registers toward the new cast', () => {
    const brief = castBatchBrief('core', 'ko', { intake, designed: [hero] });
    expect(brief).toContain('이미 설계된 인물: 서지안(주인공)');
    expect(brief).toContain('핵심 인물 3~5명');
    expect(brief).toContain('조연: 백태호');
    expect(brief).toMatch(/display_name이 서지안이고 registers만 있는 항목/);
    expect(latin(brief)).toEqual([]);
  });

  it('insists on supplied characters still missing in the last batch', () => {
    expect(missingSuppliedNames(intake, [hero, mentor])).toEqual(['문해린']);
    const brief = castBatchBrief('supporting', 'ko', { intake, designed: [hero, mentor] });
    expect(brief).toContain('반드시 그 이름 그대로 포함한다: 문해린');
    expect(brief).toContain('서지안(주인공), 백태호(스승)');
  });

  it('merges batches: the first design wins, a register-only entry adds only new registers', () => {
    const merged = mergeCastBatches([
      { characters: [hero], propositions: [{ statement: '서지안은 장부 사본을 숨겼다.' }] },
      {
        characters: [
          mentor,
          {
            display_name: '서지안',
            role: 'ally',
            registers: [{ toward: '백태호', type: 'subordinate' }],
          },
        ],
        propositions: [
          { statement: '서지안은 장부 사본을 숨겼다.' },
          { statement: '백태호는 은퇴했다.' },
        ],
      },
      {
        characters: [
          {
            display_name: ' 서지안 ',
            registers: [
              { toward: '백태호', type: 'equal' },
              { toward: '문해린', type: 'rival' },
            ],
          },
        ],
      },
    ]);
    expect(merged.characters?.map((c) => c.display_name)).toEqual(['서지안', '백태호']);
    const protagonist = merged.characters?.[0];
    expect(protagonist?.role).toBe('protagonist');
    expect(protagonist?.registers).toEqual([
      { toward: '백태호', type: 'subordinate' },
      { toward: '문해린', type: 'rival' },
    ]);
    expect(merged.propositions).toHaveLength(2);
  });

  it('counts only characters not designed yet as a batch’s new cast', () => {
    expect(
      newCharacters({ characters: [{ display_name: '서지안', registers: [] }, mentor] }, [hero]),
    ).toEqual([mentor]);
  });
});
