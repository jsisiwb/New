/** Authored serial pacing. All fields are PLANNED; accepted chapter state wins on continuation. */
import { type Generated } from '@yeonjae/domain';
import { WorkflowError } from './errors.js';

type Blueprint = Generated.SeriesBlueprintSchema.SeriesBlueprint;
export type SerialPlan = NonNullable<Blueprint['serial_plan']>;

/** Called only after schema validation: reject gaps instead of manufacturing missing story beats. */
export function validateSerialCoverage(
  blueprint: Blueprint,
  targetChapters: number,
  openingChapters: number,
): void {
  const fail = (message: string): never => {
    throw new WorkflowError('ARC_PLAN_INVALID', `Serial architecture: ${message}`, {
      step: 'blueprint',
      recommendedActions: ['regenerate'],
    });
  };
  const plan = blueprint.serial_plan;
  if (!plan) return fail('the policy requires an authored serial_plan.');
  let next = 1;
  for (const episode of plan.episodes) {
    const { from, to } = episode.chapter_range;
    const season = blueprint.seasons.find((s) => s.ordinal === episode.season_ordinal);
    if (from !== next || to < from || to > targetChapters)
      fail(`episode ${episode.title} must start at ${next} and stay within the series.`);
    if (!season || from < season.chapter_range_est.from || to > season.chapter_range_est.to)
      fail(`episode ${episode.title} crosses or references an unknown season.`);
    next = to + 1;
  }
  if (next !== targetChapters + 1) fail('episodes must cover every requested chapter.');
  const count = Math.min(targetChapters, openingChapters);
  if (
    plan.opening_chapters.length !== count ||
    plan.opening_chapters.some((chapter, i) => chapter.chapter !== i + 1)
  )
    fail(`opening_chapters must cover chapters 1 through ${count} exactly once in order.`);
}

export function renderArrival(plan: SerialPlan): string {
  const a = plan.arrival;
  return [
    '[도착과 현실 인식 — 1화에서 경험할 과정, 아직 일어난 사건이 아님]',
    `이전 삶: ${a.original_identity}`,
    `마지막 기억: ${a.last_memory}`,
    `처음 확인할 어긋남: ${a.first_mismatch}`,
    `처음 세울 가설: ${a.initial_explanation}`,
    `현실인지 확인하는 행동과 증거: ${a.reality_test}`,
    `돌아갈 수 없을지 모른다는 감정적 대가: ${a.emotional_cost}`,
    `확인 뒤 내릴 첫 실질적 선택: ${a.first_choice}`,
    '기억·관찰·추측·확인을 구분한다. 빙의 전제라면 빙의 사실은 독자에게 숨길 반전이 아니다. 원작 지식이 있어도 새 몸과 실제 사람에게 적응한 상태로 건너뛰지 않는다. 다른 인물의 비밀과 미래 사건은 공개 일정을 지킨다.',
  ].join('\n');
}

/** No later chapter briefs or episode exits are included in a prose-producing call. */
export function renderOpeningChapter(
  plan: SerialPlan | undefined,
  chapterNo: number,
): string | undefined {
  const chapter = plan?.opening_chapters.find((c) => c.chapter === chapterNo);
  if (!plan || !chapter) return undefined;
  return [
    '[PLANNED — 연재 설계의 현재 회차; 승인된 직전 원고와 정사가 우선]',
    ...(chapterNo === 1 ? [renderArrival(plan)] : []),
    `[${chapterNo}화 인과와 독자 이해]`,
    `계획된 진입 상태: ${chapter.entry_state}`,
    `중심 상황: ${chapter.central_situation}`,
    `이번에 독자가 알게 될 것: ${chapter.reader_discovery}`,
    `상황을 이해한 뒤 내리는 선택: ${chapter.choice}`,
    `이번 화의 작은 보상: ${chapter.local_payoff}`,
    `선택이 만든 이탈 상태: ${chapter.exit_state}`,
    `다음 회차로 넘기는 순간: ${chapter.next_hook}`,
    '지면에서 이해하고 반응할 시간을 준다. 직전 절단의 행동과 감정을 먼저 이어받고, 실제 결과가 계획과 다르면 승인된 결과에서 새 인과를 만든다. 계획된 상태를 이미 일어난 정사로 덮어쓰지 않는다.',
  ].join('\n');
}

export function renderEpisode(plan: SerialPlan, episode: SerialPlan['episodes'][number]): string {
  const { from, to } = episode.chapter_range;
  return [
    '[PLANNED — 이번 에피소드만의 목표와 경계]',
    `${from}~${to}화 「${episode.title}」`,
    `진입: ${episode.entry_state}`,
    `목표: ${episode.objective}`,
    `변수: ${episode.complication}`,
    `회수할 보상: ${episode.payoff}`,
    `이번 에피소드의 이탈 상태: ${episode.exit_state}`,
    `다음 에피소드에 남길 압력: ${episode.next_pressure}`,
    '시즌 전체의 최종 상태를 이번 에피소드에서 미리 달성하지 않는다. 이전 승인 원고가 계획과 다르면 그 실제 결과에서 이어 간다.',
    ...plan.opening_chapters
      .filter((c) => c.chapter >= from && c.chapter <= to)
      .map((c) => renderOpeningChapter(plan, c.chapter)),
  ].join('\n');
}
