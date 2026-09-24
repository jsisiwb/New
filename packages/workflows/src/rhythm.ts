/**
 * Serial-rhythm directives for the chapter planner (ADR-0073, K8; `planning.rhythm_directives`).
 *
 * Korean serials pace payoffs by 화: a 사이다 beat at least once in any three chapters (never more than two
 * 고구마 chapters in a row), a denser cadence in the first 25 화 funnel, and a 절단 that changes the
 * situation. The accepted contracts already say which chapters carried a `satisfaction` payoff
 * (`local_satisfaction[].type`) and how each ended (`hook.type`), so the directives are computed from
 * them — no model call — and handed to the planner with its hard constraints. After the contract comes
 * back, the same rules are checked against it and recorded (PLAN-RHYTHM-01..03); the record does not
 * block the chapter, the directive is the lever.
 */

export interface RhythmContract {
  readonly chapter_number: number;
  readonly local_satisfaction: readonly { readonly type: string }[];
  readonly hook: { readonly type: string };
}

export interface RhythmFinding {
  readonly rule_id: 'PLAN-RHYTHM-01' | 'PLAN-RHYTHM-02' | 'PLAN-RHYTHM-03';
  readonly message: string;
}

/** Hook types that do not change the situation. */
export const FLAT_HOOKS: ReadonlySet<string> = new Set(['summary_reflection', 'mid_scene_fade']);
export const FUNNEL_CHAPTERS = 25;

const hasSaida = (c: RhythmContract | undefined): boolean =>
  c?.local_satisfaction.some((s) => s.type === 'satisfaction') ?? false;

/**
 * What this chapter owes the rhythm, from the accepted contracts before it (`previous`, any order).
 * `needsSaida` is set when the last two chapters had none (or, inside the funnel, the last one).
 */
export function rhythmNeeds(
  chapterNo: number,
  previous: readonly RhythmContract[],
): {
  readonly needsSaida: boolean;
  readonly inFunnel: boolean;
  readonly reason: string | undefined;
} {
  const byNo = new Map(previous.map((c) => [c.chapter_number, c]));
  const last = byNo.get(chapterNo - 1);
  const beforeLast = byNo.get(chapterNo - 2);
  const inFunnel = chapterNo <= FUNNEL_CHAPTERS;
  if (last && beforeLast && !hasSaida(last) && !hasSaida(beforeLast))
    return { needsSaida: true, inFunnel, reason: 'two_without' };
  if (inFunnel && last && !hasSaida(last)) return { needsSaida: true, inFunnel, reason: 'funnel' };
  return { needsSaida: false, inFunnel, reason: undefined };
}

/** The directive block appended to the planner's hard constraints. */
export function renderRhythmDirectives(
  chapterNo: number,
  previous: readonly RhythmContract[],
  lang: 'en' | 'ko',
): string {
  const need = rhythmNeeds(chapterNo, previous);
  if (lang === 'ko')
    return [
      '[연재 리듬 지시 — 워크플로가 이전 회차 계약에서 계산했다]',
      ...(need.needsSaida
        ? [
            need.reason === 'two_without'
              ? '- 직전 두 화에 사이다가 없었다(고구마 두 화 연속). 이번 화 local_satisfaction에 유형 satisfaction(사이다) 비트를 반드시 하나 이상 넣는다.'
              : '- 초반 25화 구간인데 직전 화에 사이다가 없었다. 이번 화 local_satisfaction에 유형 satisfaction(사이다) 비트를 반드시 넣는다.',
          ]
        : []),
      ...(need.inFunnel
        ? [
            '- 초반 25화 구간이다: 두 화에 한 번 이상 사이다를 주고, 매 화 주인공이 목표에 한 걸음 다가서거나 능력·정보를 얻는다.',
          ]
        : []),
      '- 절단(hook)은 상황을 바꾸는 사건(위기·폭로·등장·결단)으로 끝낸다. 요약·관조(summary_reflection)나 장면 중간의 페이드(mid_scene_fade)로 끝내지 않는다.',
    ].join('\n');
  return [
    '[Serial rhythm directives — computed by the workflow from the previous contracts]',
    ...(need.needsSaida
      ? [
          need.reason === 'two_without'
            ? '- The last two chapters had no payoff (two 고구마 chapters in a row). This chapter must carry at least one local_satisfaction of type satisfaction (사이다).'
            : '- Inside the first 25 chapters and the last chapter had no payoff: this chapter must carry a local_satisfaction of type satisfaction (사이다).',
        ]
      : []),
    ...(need.inFunnel
      ? [
          '- First-25-chapter funnel: a payoff at least every second chapter, and the protagonist gains ground, power or information every chapter.',
        ]
      : []),
    '- End on a hook that changes the situation (crisis, reveal, arrival, decision), never on summary_reflection or mid_scene_fade.',
  ].join('\n');
}

/** The rhythm rules checked against the contract the planner returned. */
export function checkRhythm(
  contract: RhythmContract,
  previous: readonly RhythmContract[],
): RhythmFinding[] {
  const need = rhythmNeeds(contract.chapter_number, previous);
  const out: RhythmFinding[] = [];
  if (need.needsSaida && !hasSaida(contract))
    out.push({
      rule_id: need.reason === 'two_without' ? 'PLAN-RHYTHM-01' : 'PLAN-RHYTHM-02',
      message:
        need.reason === 'two_without'
          ? `chapter ${String(contract.chapter_number)} would be the third chapter in a row without a 사이다 payoff`
          : `chapter ${String(contract.chapter_number)} is inside the 25-chapter funnel after a chapter without a payoff and carries none`,
    });
  if (FLAT_HOOKS.has(contract.hook.type))
    out.push({
      rule_id: 'PLAN-RHYTHM-03',
      message: `chapter ${String(contract.chapter_number)} ends on ${contract.hook.type}, which does not change the situation`,
    });
  return out;
}
