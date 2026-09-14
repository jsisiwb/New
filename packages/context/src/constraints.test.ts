import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileActiveConstraintSet, inScope } from './constraints.js';
import { ContextError } from './errors.js';
import { type StorySpec } from './types.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const spec = JSON.parse(
  readFileSync(`${ROOT}examples/fixture/story-spec.v3.json`, 'utf8'),
) as StorySpec;
const IDS = {
  yuri: '0191b2a0-0000-7000-8000-0000000c0005',
  doyoon: '0191b2a0-0000-7000-8000-0000000c0001',
  arc2: '0191b2a0-0000-7000-8000-0000000e0002',
  s1: '0191b2a0-0000-7000-8000-0000000f0001',
};

const ch12 = {
  chapterNo: 12,
  arcId: IDS.arc2,
  seasonId: IDS.s1,
  participantIds: [IDS.doyoon, IDS.yuri],
  specVersion: 3,
};

describe('Active Constraint Set compiler (ADR-0033)', () => {
  it('selects by scope, keeps stable ids, dedupes deterministically and classifies hard/soft/assumption', () => {
    const acs = compileActiveConstraintSet(spec, ch12, { capTokens: 1200 });
    const hardIds = acs.hard.map((c) => c.id);
    expect(hardIds).toContain('REQ-00021'); // chapter range 1–57
    expect(hardIds).toContain('REQ-00022'); // season 1
    expect(hardIds).toContain('REQ-00031'); // Yu-ri participates
    expect(hardIds).not.toContain('REQ-00061'); // season 2
    expect(hardIds).not.toContain('REQ-00027'); // duplicate of REQ-00021, merged
    const merged = acs.hard.find((c) => c.id === 'REQ-00021');
    expect(merged?.mergedIds).toEqual(['REQ-00027']);
    expect(acs.soft.map((c) => c.id)).toEqual(['REQ-00043', 'REQ-00042', 'REQ-00041', 'REQ-00044']);
    expect(acs.assumptions.map((c) => c.id)).toEqual(['REQ-00051', 'REQ-00052']);
    expect(acs.excluded.map((e) => e.id)).toEqual(['REQ-00032', 'REQ-00061', 'REQ-00062']);
    expect(acs.excluded.find((e) => e.id === 'REQ-00062')?.reason).toMatch(/retired/);
    expect(acs.conflicts).toHaveLength(1);
    expect(acs.renderedText).toContain('[REQ-00021]');
    expect(acs.renderedText).toContain('(also REQ-00027)');
    expect(acs.renderedText).toContain('[unconfirmed]');
    expect(acs.hardText.startsWith('### Hard requirements')).toBe(true);
    expect(acs.renderedText).toContain(acs.hardText);
  });

  it('is deterministic: item order in the spec does not change bytes, hash or id', () => {
    const a = compileActiveConstraintSet(spec, ch12, { capTokens: 1200 });
    const shuffled: StorySpec = { ...spec, items: [...spec.items].reverse() };
    const b = compileActiveConstraintSet(shuffled, ch12, { capTokens: 1200 });
    expect(b.renderedText).toBe(a.renderedText);
    expect(b.contentHash).toBe(a.contentHash);
    expect(b.id).toBe(a.id);
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('changes hash when scope changes the in-scope set (chapter 60 drops the ch.58 secrecy rule)', () => {
    const a = compileActiveConstraintSet(spec, ch12, { capTokens: 1200 });
    const b = compileActiveConstraintSet(spec, { ...ch12, chapterNo: 60 }, { capTokens: 1200 });
    expect(b.hard.map((c) => c.id)).not.toContain('REQ-00021');
    expect(b.contentHash).not.toBe(a.contentHash);
  });

  it('fails with CONSTRAINTS_OVERFLOW instead of trimming hard requirements', () => {
    let err: unknown;
    try {
      compileActiveConstraintSet(spec, ch12, { capTokens: 100 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ContextError);
    expect((err as ContextError).code).toBe('CONSTRAINTS_OVERFLOW');
    expect((err as ContextError).message).toMatch(/consolidate/);
  });

  it('renders locked facts inside the hard block and refuses non-English text without a paraphrase', () => {
    const acs = compileActiveConstraintSet(spec, ch12, {
      capTokens: 1200,
      lockedFacts: [{ id: 'fact-1', text: 'Mu-jin took venom in the LEFT calf (ch.9).' }],
    });
    expect(acs.hardText).toContain('Locked facts:');
    expect(acs.hardText).toContain('[fact-1]');
    const ko: StorySpec = {
      ...spec,
      items: [
        {
          id: 'REQ-00099',
          kind: 'hard',
          category: 'other',
          text: '주인공은 죽지 않는다.',
          language: 'ko',
          provenance: 'user',
          scope: { level: 'series' },
        },
      ],
    };
    expect(() => compileActiveConstraintSet(ko, ch12, { capTokens: 1200 })).toThrow(/text_en/);
    const withParaphrase: StorySpec = {
      ...ko,
      items: ko.items.map((i) => ({ ...i, text_en: 'The protagonist does not die.' })),
    };
    expect(
      compileActiveConstraintSet(withParaphrase, ch12, { capTokens: 1200 }).hardText,
    ).toContain('The protagonist does not die.');
  });

  it('scope predicate covers every level', () => {
    const base = spec.items[0];
    if (!base) throw new Error('fixture spec has no items');
    const sc = { chapterNo: 5, participantIds: ['x'], specVersion: 1 };
    expect(inScope({ ...base, scope: { level: 'series' } }, sc).ok).toBe(true);
    expect(inScope({ ...base, scope: { level: 'chapter_range', chapter_from: 6 } }, sc).ok).toBe(
      false,
    );
    expect(inScope({ ...base, scope: { level: 'character', entity_ids: ['x'] } }, sc).ok).toBe(
      true,
    );
    expect(
      inScope({ ...base, scope: { level: 'arc', arc_ids: ['a'] } }, { ...sc, arcId: 'a' }).ok,
    ).toBe(true);
    expect(
      inScope({ ...base, scope: { level: 'arc', arc_ids: ['a'] } }, { ...sc, minorArcId: 'a' }).ok,
    ).toBe(true);
    expect(inScope({ ...base, scope: { level: 'season', season_ids: ['s'] } }, sc).ok).toBe(false);
    expect(
      inScope({ ...base, effective_from_spec_version: 2, scope: { level: 'series' } }, sc).ok,
    ).toBe(false);
  });
});
