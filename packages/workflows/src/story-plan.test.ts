import { describe, expect, it } from 'vitest';
import {
  angleSeeds,
  arcBeatTypeOf,
  normalizeArcKnowledge,
  secretMeetingFloors,
  worldRulesTerm,
} from './story-plan.js';

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

describe('meeting time frames (ADR-0093, G10-1)', () => {
  it('dates a secret that names someone its owner first meets in 화 N from 화 N + 1', () => {
    const ids: Record<string, string> = { 아델: 'hero', 로이드: 'rival', 세라: 'friend' };
    const floor = secretMeetingFloors(
      [
        { display_name: '아델', registers: [{ toward: '로이드', since_chapter: 1 }] },
        { display_name: '로이드', short_forms: ['로이'] },
        { display_name: '세라', registers: [{ toward: '아델' }] },
      ],
      (name) => (name ? ids[name] : undefined),
    );
    expect(floor('rival', '실기 평가에서 아델에게 진 뒤 몰래 훈련한다.')).toBe(2);
    expect(floor('hero', '로이의 약점을 안다.')).toBe(2);
    expect(floor('friend', '아델을 오래전부터 알았다.')).toBeUndefined();
    expect(floor('rival', '밤마다 몰래 훈련한다.')).toBeUndefined();
  });
});

describe('arc plan knowledge changes (ADR-0094, G11-1)', () => {
  it('keeps schema stances, maps a planner alias and drops what cannot be read', () => {
    const knower = { kind: 'character', entity_id: 'hero' };
    expect(
      normalizeArcKnowledge([
        { knower, proposition_ref: 'new:비밀', to_stance: 'knows', channel: '대화' },
        { knower, proposition_ref: 'new:소문', to_stance: 'believes', from_stance: 'unaware' },
        { knower, proposition_ref: 'new:거짓', to_stance: 'imagines' },
        { proposition_ref: 'new:누구', to_stance: 'knows' },
        '문장',
      ]),
    ).toEqual([
      { knower, proposition_ref: 'new:비밀', to_stance: 'knows', channel: '대화' },
      { knower, proposition_ref: 'new:소문', to_stance: 'suspects' },
    ]);
  });
});

describe('arc plan beat types (ADR-0096, G13-1)', () => {
  it('keeps schema types and reads a planner word as its nearest type', () => {
    expect(arcBeatTypeOf('cider')).toBe('cider');
    expect(arcBeatTypeOf(' Revelation ')).toBe('revelation');
    // G13r's arc plan: beats/9/type was `cliffhanger`.
    expect(arcBeatTypeOf('cliffhanger')).toBe('escalation');
    expect(arcBeatTypeOf('turning point')).toBe('reversal');
    expect(arcBeatTypeOf('power-up')).toBe('progression');
  });

  it('leaves an unreadable word undefined for the caller to label', () => {
    expect(arcBeatTypeOf('착각')).toBeUndefined();
    expect(arcBeatTypeOf(3)).toBeUndefined();
    expect(arcBeatTypeOf(undefined)).toBeUndefined();
  });
});
