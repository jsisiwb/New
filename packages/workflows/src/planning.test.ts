import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { specCategoryOf, validateContract } from './planning.js';

const CONTRACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../examples/fixture/chapter-contract.ch12.json', import.meta.url)),
    'utf8',
  ),
) as Parameters<typeof validateContract>[0];

describe('story-spec requirement categories (ADR-0099, G15-1)', () => {
  it('keeps schema categories and reads an interpreter word as its nearest one', () => {
    expect(specCategoryOf('forbidden_development')).toBe('forbidden_development');
    expect(specCategoryOf(' Romance ')).toBe('romance');
    // G15a's story spec: items/2/category was `relationship`.
    expect(specCategoryOf('relationship')).toBe('character');
    expect(specCategoryOf('world-building')).toBe('world');
    expect(specCategoryOf('taboo')).toBe('forbidden_development');
  });

  it('falls back to the schema’s catch-all, and never promotes a sub-genre to the genre', () => {
    expect(specCategoryOf('subgenre')).toBe('other');
    expect(specCategoryOf('관계')).toBe('other');
    expect(specCategoryOf(undefined)).toBe('other');
  });
});

describe('contract length-unit consistency (ADR-0054)', () => {
  const knownEntities = new Set<string>([
    ...CONTRACT.participants.map((p) => p.character_id),
    ...CONTRACT.locations,
  ]);
  const knownProps = new Set<string>([
    ...CONTRACT.knowledge_guards.flatMap((g) => g.must_not_know_proposition_ids),
    ...CONTRACT.knowledge_deltas.map((d) => d.proposition_id).filter((x) => !!x),
  ]);
  const input = (unit: 'words' | 'characters') => ({
    chapterNo: CONTRACT.chapter_number,
    mainTimelineId: CONTRACT.timeline_id,
    spec: { version: CONTRACT.pinned.spec_version, items: [] },
    lengthTarget: { unit, value: CONTRACT.length_target.value, tolerance_ratio: 0.12 },
  });

  it('accepts a contract whose length unit matches the project target unit', () => {
    expect(validateContract(CONTRACT, input('words'), knownProps, knownEntities)).toEqual([]);
  });

  it('rejects a words contract when the project target unit is characters (ko)', () => {
    const issues = validateContract(CONTRACT, input('characters'), knownProps, knownEntities);
    expect(issues.join(' ')).toMatch(
      /length_target unit words does not match the project target unit characters/,
    );
  });
});
