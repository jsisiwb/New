import { describe, expect, it } from 'vitest';
import { readerSecrets } from './evaluator-inputs.js';
import { type StoryBible } from './planning.js';

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
