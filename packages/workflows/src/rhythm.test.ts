import { describe, expect, it } from 'vitest';
import { checkRhythm, renderRhythmDirectives, rhythmNeeds, type RhythmContract } from './rhythm.js';

const c = (n: number, saida: boolean, hook = 'cliffhanger'): RhythmContract => ({
  chapter_number: n,
  local_satisfaction: [{ type: saida ? 'satisfaction' : 'emotional_step' }],
  hook: { type: hook },
});

describe('serial rhythm directives (ADR-0073)', () => {
  it('owes a 사이다 after two chapters without one, and inside the funnel after one', () => {
    expect(rhythmNeeds(40, [c(38, false), c(39, false)])).toMatchObject({
      needsSaida: true,
      reason: 'two_without',
    });
    expect(rhythmNeeds(40, [c(38, true), c(39, false)]).needsSaida).toBe(false);
    expect(rhythmNeeds(10, [c(9, false)])).toMatchObject({ needsSaida: true, reason: 'funnel' });
    expect(rhythmNeeds(1, []).needsSaida).toBe(false);
  });

  it('renders Korean directives with the 절단 rule and no Latin prose', () => {
    const text = renderRhythmDirectives(40, [c(38, false), c(39, false)], 'ko');
    expect(text).toContain('고구마 두 화 연속');
    expect(text).toContain('절단(hook)');
    const latin = [...text.matchAll(/[A-Za-z_]{3,}/g)].map((m) => m[0]);
    expect(
      latin.every((w) =>
        [
          'local_satisfaction',
          'satisfaction',
          'hook',
          'summary_reflection',
          'mid_scene_fade',
        ].includes(w),
      ),
    ).toBe(true);
  });

  it('checks the returned contract: a third payoff-less chapter and a flat 절단 are recorded', () => {
    expect(
      checkRhythm(c(40, false, 'summary_reflection'), [c(38, false), c(39, false)]).map(
        (f) => f.rule_id,
      ),
    ).toEqual(['PLAN-RHYTHM-01', 'PLAN-RHYTHM-03']);
    expect(checkRhythm(c(40, true), [c(38, false), c(39, false)])).toEqual([]);
  });
});
