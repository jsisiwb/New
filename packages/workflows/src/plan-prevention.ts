/**
 * Plan-level prevention (ADR-0086, STEP 2 of the operator-voice run). The `standard@14` checkpoint showed defects
 * that no revision round clears because the plan makes them (docs/08-delivery/13-live-run-gemini.md §5). These
 * helpers are deterministic: countable talk targets for the writer (G5-2), removal of scene lines that forbid
 * talking (G5-2), the contract / scene-plan self-consistency pre-check (U7) and the plan critic's inputs and
 * feedback (U8). Numbers come from the pinned policy (rule 8).
 */
import { type Generated } from '@yeonjae/domain';

type ScenePlan = Generated.ScenePlanSchema.ScenePlan;
type ChapterContract = Generated.ChapterContractSchema.ChapterContract;

export interface LineTargetPolicy {
  readonly median_per_1k: number;
  readonly min_per_1k: number;
  readonly monologue_max_per_1k: number;
  readonly median_share: number;
}

export interface SceneLineTargets {
  /** Quoted dialogue lines to aim for. */
  readonly lines: number;
  /** Quoted dialogue lines the scene must not fall below. */
  readonly min: number;
  /** Quoted 속마음 (‘ ’) lines the scene should not exceed. */
  readonly monologueMax: number;
}

/**
 * Countable talk targets for one scene. The operator's median line density is scaled by the scene's planned share
 * against the operator's median share, never below the operator's p10 density; 속마음 lines are capped at the p90
 * density (at least two per scene).
 */
export function sceneLineTargets(
  scene: Pick<ScenePlan, 'dialogue_density_target' | 'length_target'>,
  policy: LineTargetPolicy,
): SceneLineTargets {
  const k = scene.length_target.value / 1000;
  const share = scene.dialogue_density_target ?? policy.median_share;
  const min = Math.max(2, Math.round(policy.min_per_1k * k));
  const lines = Math.max(min, Math.round(policy.median_per_1k * k * (share / policy.median_share)));
  const monologueMax = Math.max(2, Math.round(policy.monologue_max_per_1k * k));
  return { lines, min, monologueMax };
}

/** The writer's Korean note for a scene's talk targets. */
export function lineTargetNote(
  targets: SceneLineTargets,
  partners: readonly string[],
  total: SceneLineTargets | undefined,
): string {
  const who = partners.length ? ` 주고받는 상대: ${partners.join(', ')}.` : '';
  const chapter = total
    ? ` (이번 화 전체 목표는 따옴표 대사 ${String(total.lines)}줄 안팎이다.)`
    : '';
  return `\n\n대사 목표: 따옴표 대사 ${String(targets.lines)}줄 안팎, 적어도 ${String(targets.min)}줄.${who} 따옴표 속마음(‘ ’)은 ${String(targets.monologueMax)}줄까지.${chapter}`;
}

const TALK_BAN =
  /(대화|대사|말(?:을|로|하|이)?|수다|잡담|설명)[^.]{0,20}(금지|하지\s?않|않는다|말\s?것|없(?:이|는)|하는\s?모습|늘어놓)/u;
const TALK_WORD = /대화|대사|말하|떠들|수다|잡담|입을\s?여/u;

export interface PlanFinding {
  readonly rule: string;
  readonly severity: 'blocking' | 'major' | 'minor';
  readonly target: string;
  readonly message: string;
  readonly repaired?: boolean;
}

/** Remove scene must_not lines that forbid talking (G5-2: "no talk during the fight" suppressed every line). */
export function stripTalkBans(scenes: readonly ScenePlan[]): {
  scenes: ScenePlan[];
  findings: PlanFinding[];
} {
  const findings: PlanFinding[] = [];
  const out = scenes.map((s) => {
    const keep = (s.must_not ?? []).filter((m) => !(TALK_WORD.test(m) && TALK_BAN.test(m)));
    if (keep.length === (s.must_not ?? []).length) return s;
    findings.push({
      rule: 'PLAN-DLG-02',
      severity: 'major',
      target: `장면 ${String(s.scene_no)}`,
      message: `대화를 막는 금지 사항 ${String((s.must_not ?? []).length - keep.length)}줄을 지웠다`,
      repaired: true,
    });
    return { ...s, must_not: keep };
  });
  return { scenes: out, findings };
}

/** Someone on page beside the POV character. */
export function contractHasPartner(
  contract: Pick<ChapterContract, 'participants' | 'pov'>,
): boolean {
  return contract.participants.some(
    (p) => p.on_page && p.character_id !== contract.pov.character_id,
  );
}

/**
 * U7: the contract and its scene plans against each other, before any drafting call. Deterministic, so only
 * what can be decided from the plan objects: a talk partner on page, dialogue beats where a partner stands, the
 * final scene ending on the hook when the policy designs the cut, and talk bans left in a scene.
 */
export function checkPlanConsistency(
  contract: Pick<ChapterContract, 'participants' | 'pov' | 'hook'>,
  scenes: readonly ScenePlan[],
  opts: {
    readonly cutDesign?: boolean | undefined;
    readonly partnerRequired?: boolean | undefined;
  } = {},
): PlanFinding[] {
  const findings: PlanFinding[] = [];
  if (opts.partnerRequired && !contractHasPartner(contract))
    findings.push({
      rule: 'PLAN-PARTNER-02',
      severity: 'major',
      target: '계약',
      message: '주인공과 말을 주고받을 인물이 지면에 없다',
    });
  for (const s of scenes) {
    const partners = s.participants.filter((p) => p !== s.pov.character_id);
    const talkBeats = s.beats.filter((b) => b.type === 'dialogue').length;
    if (partners.length > 0 && talkBeats === 0)
      findings.push({
        rule: 'PLAN-DLG-03',
        severity: 'major',
        target: `장면 ${String(s.scene_no)}`,
        message: '상대가 있는 장면에 대사 비트가 없다',
      });
    if ((s.must_not ?? []).some((m) => TALK_WORD.test(m) && TALK_BAN.test(m)))
      findings.push({
        rule: 'PLAN-DLG-02',
        severity: 'major',
        target: `장면 ${String(s.scene_no)}`,
        message: '금지 사항이 대화를 막는다',
      });
  }
  const last = scenes[scenes.length - 1];
  if (opts.cutDesign && last) {
    const beat = last.beats[last.beats.length - 1];
    if (beat?.type !== 'cliffhanger')
      findings.push({
        rule: 'PLAN-CUT-01',
        severity: 'major',
        target: `장면 ${String(last.scene_no)}`,
        message: `마지막 장면의 마지막 비트가 절단이 아니다(계약의 절단: ${contract.hook.description})`,
      });
  }
  return findings;
}

/**
 * U5: the final scene's last beat is the contract's cut. A plan whose last beat is something else gets the cut
 * appended as its final beat (recorded, repaired), so the writer always has it as the scene's end.
 */
export function ensureCutBeat(
  contract: Pick<ChapterContract, 'hook'>,
  scenes: readonly ScenePlan[],
): { scenes: ScenePlan[]; findings: PlanFinding[] } {
  const last = scenes[scenes.length - 1];
  if (!last) return { scenes: [...scenes], findings: [] };
  const beat = last.beats[last.beats.length - 1];
  if (beat?.type === 'cliffhanger') return { scenes: [...scenes], findings: [] };
  const withCut: ScenePlan = {
    ...last,
    ending_beat_type: 'cliffhanger',
    beats: [...last.beats, { type: 'cliffhanger', description: contract.hook.description }],
  };
  return {
    scenes: [...scenes.slice(0, -1), withCut],
    findings: [
      {
        rule: 'PLAN-CUT-01',
        severity: 'major',
        target: `장면 ${String(last.scene_no)}`,
        message: '마지막 비트로 계약의 절단을 붙였다',
        repaired: true,
      },
    ],
  };
}

/** The writer's instruction for the final scene under cut design. */
export function cutNote(contract: Pick<ChapterContract, 'hook'>): string {
  return `\n\n절단: 이 장면은 회차의 마지막 장면이다. 원고의 마지막 한두 줄은 이 순간이다 — ${contract.hook.description} 그 뒤에 수습·걱정·정리·다짐·요약 문장을 한 줄도 붙이지 않는다.`;
}

/** Plan findings rendered for a planner's `plan_feedback`. */
export function renderPlanFeedback(
  findings: readonly { target: string; message: string; fix?: string }[],
): string {
  if (findings.length === 0) return '(없음)';
  return findings.map((f) => `- ${f.target}: ${f.message}${f.fix ? ` → ${f.fix}` : ''}`).join('\n');
}

/** A scene plan rendered for the plan critic: one block per scene, beats in order, names resolved. */
export function renderScenesForCritic(
  scenes: readonly ScenePlan[],
  nameOf: (id: string) => string,
): string {
  return scenes
    .map((s) =>
      [
        `장면 ${String(s.scene_no)} — 목적: ${s.objective}; 시점: ${nameOf(s.pov.character_id)}; 참여자: ${s.participants.map(nameOf).join(', ')}; 분량 ${String(s.length_target.value)}자; 대사 비중 ${String(Math.round((s.dialogue_density_target ?? 0) * 100))}%`,
        ...s.beats.map((b, i) => `  ${String(i + 1)}. [${b.type}] ${b.description}`),
        ...(s.must_not?.length ? [`  금지: ${s.must_not.join(' / ')}`] : []),
      ].join('\n'),
    )
    .join('\n');
}

/** The operator's structure targets for the plan critic, from the policy's numbers and the voice profile. */
export function structureTargets(input: {
  readonly chapterNo: number;
  readonly lineTargets?: LineTargetPolicy | undefined;
  readonly lengthTarget: number;
  readonly plannerVoice?: readonly string[] | undefined;
}): string {
  const lines: string[] = [
    '- 한 화에 핵심 사건 하나, 장면은 1~3개, 사이다·폭로·웃음 같은 보상이 지면에서 터진다.',
    '- 절단은 결단·선언, 위협, 코믹한 한 방, 감정, 폭로, 등장, 반전, 아이러니 중 하나이고 원고의 마지막 비트다. 요약·교훈·하루 마무리로 끝나지 않는다.',
    '- 도입은 소리·용어·대사·직전 절단의 이어받기로 연다. 회상 요약이나 풍경으로 열지 않는다.',
  ];
  if (input.lineTargets) {
    const k = input.lengthTarget / 1000;
    lines.push(
      `- 대사는 따옴표 대사 ${String(Math.round(input.lineTargets.median_per_1k * k))}줄 안팎(적어도 ${String(Math.round(input.lineTargets.min_per_1k * k))}줄), 따옴표 속마음은 ${String(Math.round(input.lineTargets.monologue_max_per_1k * k))}줄까지.`,
    );
  }
  if (input.chapterNo <= 25)
    lines.push(
      '- 초반 25화: 사이다는 늦어도 3화 안에, 고구마는 최대 2화 연속, 한 화 안에서 하루 넘게 건너뛰지 않는다.',
    );
  for (const v of input.plannerVoice ?? []) lines.push(`- ${v}`);
  return lines.join('\n');
}
