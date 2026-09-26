/**
 * The scene plan's dialogue floor (ADR-0084, U6; live defect G3-2).
 */
import { describe, expect, it } from 'vitest';
import { applyDialogueFloor } from './dialogue-floor.js';
import { pickRevisionDimension } from './revision.js';
import { deviceLexiconFindings, type Issue } from './evaluation.js';
import { sceneTalkShare, talkRedraftNote, type ScenePlan } from './drafting.js';

const HERO = '00000000-0000-7000-8000-000000000001';
const SISTER = '00000000-0000-7000-8000-000000000002';
const scene = (n: number, length: number, dialogue: number, participants = [HERO]) =>
  ({
    scene_no: n,
    objective: '목표',
    pov: { character_id: HERO, person: 'first' },
    participants,
    location_id: '00000000-0000-7000-8000-000000000009',
    beats: [],
    speaker_pairs: [],
    dialogue_density_target: dialogue,
    length_target: { unit: 'characters', value: length },
  }) as unknown as ScenePlan;
const contract = (onPage: boolean) => ({
  participants: [
    { character_id: HERO, role_in_chapter: 'protagonist' as const, on_page: true },
    { character_id: SISTER, role_in_chapter: 'ally' as const, on_page: onPage },
  ],
});

describe('applyDialogueFloor', () => {
  it('raises scenes below the floor and puts the contract’s on-page partner in the longest scene', () => {
    const { scenes, findings } = applyDialogueFloor(
      [scene(1, 1800, 0.1), scene(2, 3500, 0.3)],
      contract(true),
      { chapter_min: 0.2, partner_required: true },
    );
    expect(scenes.map((s) => s.dialogue_density_target)).toEqual([0.2, 0.3]);
    expect(scenes[1]?.participants).toEqual([HERO, SISTER]);
    expect(scenes[0]?.participants).toEqual([HERO]);
    expect(findings.map((f) => [f.rule, f.repaired])).toEqual([
      ['PLAN-DLG-01', true],
      ['PLAN-PARTNER-01', true],
    ]);
  });

  it('leaves a plan that meets the floor untouched and reports a partner it cannot add', () => {
    const ok = [scene(1, 2000, 0.25, [HERO, SISTER])];
    expect(
      applyDialogueFloor(ok, contract(true), { chapter_min: 0.2, partner_required: true }),
    ).toEqual({
      scenes: ok,
      findings: [],
    });
    const alone = applyDialogueFloor([scene(1, 2000, 0.3)], contract(false), {
      chapter_min: 0.2,
      partner_required: true,
    });
    expect(alone.findings).toEqual([
      expect.objectContaining({ rule: 'PLAN-PARTNER-01', repaired: false }),
    ]);
    expect(alone.scenes[0]?.participants).toEqual([HERO]);
  });
});

describe('pickRevisionDimension with failing gates (ADR-0084, G3-1)', () => {
  const issue = (dimension: Issue['dimension'], severity: Issue['severity'], span: boolean) =>
    ({ dimension, severity, ...(span ? { chapter_span: { start: 0, end: 5 } } : {}) }) as Issue;
  const issues = [
    issue('prose', 'major', true),
    issue('prose', 'major', true),
    issue('structure', 'blocking', false),
    issue('structure', 'major', false),
  ];

  it('targets a failing dimension before a passing one with more spans', () => {
    expect(pickRevisionDimension(issues)).toBe('prose');
    expect(pickRevisionDimension(issues, new Set(['structure']))).toBe('structure');
    // No open issue on the failing dimension: the old choice.
    expect(pickRevisionDimension(issues, new Set(['voice']))).toBe('prose');
  });
});

describe('deviceLexiconFindings (ADR-0084, U2; live defect G-1)', () => {
  it('flags another device’s words with code-point spans, at most three', () => {
    const text = '지난 생에서 나는 죽었다. 원작 주인공도 몰랐다. 원작에서는 달랐다. 원작, 원작.';
    const found = deviceLexiconFindings(text, 'regression');
    expect(found.map((f) => f.quote)).toEqual(['원작 주인공', '원작', '원작']);
    expect(Array.from(text).slice(found[0]?.start, found[0]?.end).join('')).toBe('원작 주인공');
    // Game possession keeps game words and may name an original game, not an original novel's hero.
    expect(
      deviceLexiconFindings('게임 공략대로라면 원작 게임에서는 죽는다.', 'game_possession'),
    ).toEqual([]);
    expect(deviceLexiconFindings('원작 주인공이 왔다.', 'game_possession')).toHaveLength(1);
    expect(deviceLexiconFindings('원작 주인공이 왔다.', 'possession')).toEqual([]);
  });
});

describe('scene talk redraft (ADR-0084, U6)', () => {
  it('measures dialogue and 속마음 without line breaks and tells the writer the share and the target', () => {
    const prose = ['“왔어?”', '나는 고개를 끄덕였다.', '‘늦었네.’', '바람이 불었다.'].join('\n\n');
    expect(sceneTalkShare(prose)).toBeCloseTo(11 / 31, 2);
    const note = talkRedraftNote(0.07, 0.3, true);
    expect(note).toContain('7%뿐이었다(목표 약 30%)');
    expect(note).not.toMatch(/[A-Za-z]/);
  });
});

describe('solo scenes under the dialogue floor (ADR-0110, G7-4)', () => {
  const floor = { chapter_min: 0.2, partner_required: true };
  // G7r: the regression chapter's two solo scenes were raised to 20 % and 30 % talk and came back at 6.3 % and 4.2 %.
  const planned = [scene(1, 2000, 0.3), scene(2, 3000, 0.25, [HERO, SISTER]), scene(3, 1000, 0.2)];

  it('raises every scene to the floor without the flag, solo ones included', () => {
    const { scenes } = applyDialogueFloor(
      planned.map((s) => ({ ...s, dialogue_density_target: 0.1 })),
      contract(true),
      floor,
    );
    expect(scenes.map((s) => s.dialogue_density_target)).toEqual([0.2, 0.2, 0.2]);
  });

  it('keeps a solo scene at the solo band and lets the scenes with a partner carry the floor', () => {
    const { scenes, findings } = applyDialogueFloor(planned, contract(true), {
      ...floor,
      solo_scenes: true,
      solo_max: 0.05,
    });
    // Solo scenes: 0.05 each; the paired scene carries (0.2 × 6000 − 0.05 × 3000) / 3000 = 0.35.
    expect(scenes.map((s) => s.dialogue_density_target)).toEqual([0.05, 0.35, 0.05]);
    const weighted = scenes.reduce(
      (n, s) => n + s.length_target.value * (s.dialogue_density_target ?? 0),
      0,
    );
    expect(weighted / 6000).toBeCloseTo(0.2, 5);
    expect(findings.map((f) => f.rule)).toEqual(['PLAN-DLG-01', 'PLAN-DLG-04']);
  });

  it('places a partner first when no scene has one, and treats that scene as paired', () => {
    const { scenes, findings } = applyDialogueFloor(
      [scene(1, 2000, 0.3), scene(2, 3000, 0.1)],
      contract(true),
      { ...floor, solo_scenes: true },
    );
    expect(scenes[1]?.participants).toEqual([HERO, SISTER]);
    expect(scenes.map((s) => s.dialogue_density_target)).toEqual([0.05, 0.3]);
    expect(findings[0]?.rule).toBe('PLAN-PARTNER-01');
  });
});
