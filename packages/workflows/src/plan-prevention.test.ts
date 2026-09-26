import { describe, expect, it } from 'vitest';
import { type Generated } from '@yeonjae/domain';
import {
  checkPlanConsistency,
  contractHasPartner,
  dedupeRepeatedLines,
  cutNote,
  ensureCutBeat,
  lineTargetNote,
  soloLineTargetNote,
  renderPlanFeedback,
  sceneLineTargets,
  stripTalkBans,
  structureTargets,
} from './plan-prevention.js';

type ScenePlan = Generated.ScenePlanSchema.ScenePlan;

const LT = { median_per_1k: 9.2, min_per_1k: 5.3, monologue_max_per_1k: 2.1, median_share: 0.234 };

// Synthetic one-line beats (test strings, not manuscript).
function scene(n: number, over: Partial<ScenePlan> = {}): ScenePlan {
  return {
    scene_no: n,
    objective: '목적',
    pov: { character_id: 'hero', person: 'first' },
    participants: ['hero', 'mentor'],
    location_id: 'hall',
    beats: [
      { type: 'action', description: '움직인다.' },
      { type: 'dialogue', description: '교관↔주인공, 네 번 주고받음' },
    ],
    length_target: { unit: 'characters', value: 1800, tolerance_ratio: 0.12 },
    dialogue_density_target: 0.3,
    speaker_pairs: [],
    ...over,
  };
}

const contract = {
  pov: { character_id: 'hero', person: 'first' as const },
  participants: [
    { character_id: 'hero', on_page: true, role_in_chapter: 'protagonist' as const },
    { character_id: 'mentor', on_page: true, role_in_chapter: 'mentor' as const },
  ],
  hook: { type: 'reveal' as const, description: '교관이 결과를 외친다.' },
};

describe('plan-level prevention (ADR-0086)', () => {
  it('gives countable talk targets from the operator densities, scaled by the planned share', () => {
    // 1,800자 at the operator's median share: 9.2 × 1.8 ≈ 17 lines, at least 5.3 × 1.8 ≈ 10.
    expect(sceneLineTargets(scene(1, { dialogue_density_target: 0.234 }), LT)).toEqual({
      lines: 17,
      min: 10,
      monologueMax: 4,
    });
    // A scene planned below the operator's median never drops under the p10 density.
    expect(sceneLineTargets(scene(1, { dialogue_density_target: 0.05 }), LT).lines).toBe(10);
    expect(sceneLineTargets(scene(1, { dialogue_density_target: 0.45 }), LT).lines).toBe(32);
    const note = lineTargetNote({ lines: 17, min: 10, monologueMax: 4 }, ['교관'], undefined);
    expect(note).toContain('따옴표 대사 17줄 안팎, 적어도 10줄');
    expect(note).toContain('주고받는 상대: 교관');
    expect(note).toContain('4줄까지');
  });

  it('removes scene lines that forbid talking and keeps the rest', () => {
    const out = stripTalkBans([
      scene(1, { must_not: ['전투 중 불필요하게 대화하는 모습', '적에게 자비를 베푸는 묘사'] }),
      scene(2, { must_not: ['요약으로 닫는 서술'] }),
    ]);
    expect(out.scenes[0]?.must_not).toEqual(['적에게 자비를 베푸는 묘사']);
    expect(out.scenes[1]?.must_not).toEqual(['요약으로 닫는 서술']);
    expect(out.findings.map((f) => f.rule)).toEqual(['PLAN-DLG-02']);
  });

  it('checks the plan against its contract: partner, dialogue beats, the cut as the last beat', () => {
    expect(contractHasPartner(contract)).toBe(true);
    const alone = { ...contract, participants: contract.participants.slice(0, 1) };
    expect(contractHasPartner(alone)).toBe(false);
    const noTalk = scene(2, { beats: [{ type: 'action', description: '달린다.' }] });
    const findings = checkPlanConsistency(alone, [scene(1), noTalk], {
      cutDesign: true,
      partnerRequired: true,
    });
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'PLAN-CUT-01',
      'PLAN-DLG-03',
      'PLAN-PARTNER-02',
    ]);
    const withCut = ensureCutBeat(contract, [scene(1), scene(2)]);
    expect(withCut.scenes[1]?.beats.at(-1)).toEqual({
      type: 'cliffhanger',
      description: '교관이 결과를 외친다.',
    });
    expect(withCut.scenes[1]?.ending_beat_type).toBe('cliffhanger');
    expect(ensureCutBeat(contract, withCut.scenes).findings).toEqual([]);
    expect(
      checkPlanConsistency(contract, withCut.scenes, { cutDesign: true, partnerRequired: true }),
    ).toEqual([]);
  });

  it('renders Korean feedback, the cut note and structure targets without English', () => {
    const text = [
      renderPlanFeedback([
        { target: '장면 2', message: '같은 설명이 되풀이된다', fix: '한 장면에만 둔다' },
      ]),
      cutNote(contract),
      structureTargets({
        chapterNo: 1,
        lineTargets: LT,
        lengthTarget: 5300,
        plannerVoice: ['한 화에 사건 하나'],
      }),
    ].join('\n');
    expect(text).toContain('장면 2: 같은 설명이 되풀이된다 → 한 장면에만 둔다');
    expect(text).toContain('따옴표 대사 49줄 안팎(적어도 28줄)');
    expect(/[A-Za-z]/.test(text)).toBe(false);
    expect(renderPlanFeedback([])).toBe('(없음)');
  });

  it('drops a line repeated word for word right after itself, but keeps short sound lines', () => {
    const out = dedupeRepeatedLines(
      [
        '덜컹 덜컹.',
        '',
        '덜컹 덜컹.',
        '',
        '네놈이 정녕 미쳤구나!',
        '',
        '네놈이 정녕 미쳤구나!',
        '',
        '끝.',
      ].join('\n'),
    );
    expect(out.removed).toBe(1);
    expect(out.text).toBe(
      ['덜컹 덜컹.', '', '덜컹 덜컹.', '', '네놈이 정녕 미쳤구나!', '', '끝.'].join('\n'),
    );
  });
});

describe('the solo scene note (ADR-0110, G7-4)', () => {
  it('gives no quoted-line quota, only the 속마음 cap, in Korean', () => {
    const note = soloLineTargetNote({ lines: 11, min: 5, monologueMax: 4 });
    expect(note).toContain('말을 주고받을 상대가 없다');
    expect(note).toContain('4줄까지');
    expect(note).not.toMatch(/따옴표 대사 \d+줄/u);
    expect(note).not.toMatch(/[A-Za-z]/u);
  });
});
