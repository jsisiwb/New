import { describe, expect, it } from 'vitest';
import { angleSeeds, worldRulesTerm } from './story-plan.js';

describe('concept angle seeds and the world-rules term follow the manuscript language (audit §6.1)', () => {
  it('keeps the English seeds and term byte-identical, so English concept calls replay', () => {
    expect(angleSeeds('en')).toEqual([
      'the most faithful reading of the premise, maximizing the genre core fantasy',
      'a sharper hook: raise the stakes of chapter one and tighten the central mystery',
      'a character-forward angle: foreground relationships and register conflict without softening progression',
      'a subversive angle: keep every hard requirement but invert one reader expectation of the genre',
    ]);
    expect(worldRulesTerm('en')).toEqual({
      name: 'World rules',
      description: 'Locked world and progression rules of the setting.',
    });
  });

  it('gives a Korean project as many seeds as an English one, with no Latin script', () => {
    expect(angleSeeds('ko')).toHaveLength(angleSeeds('en').length);
    expect(new Set(angleSeeds('ko')).size).toBe(angleSeeds('ko').length);
    for (const seed of angleSeeds('ko')) expect(seed).not.toMatch(/[A-Za-z]/);
    const term = worldRulesTerm('ko');
    expect(term.name).toBe('세계 규칙');
    expect(`${term.name} ${term.description}`).not.toMatch(/[A-Za-z]/);
  });
});
