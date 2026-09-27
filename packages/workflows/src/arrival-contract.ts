/** Arrival is a chapter-scoped reading requirement, never an assertion that an event already happened. */
import { type Generated } from '@yeonjae/domain';

type Intake = Generated.StoryIntakeSchema.StoryIntake;
type Requirement = Generated.StorySpecSchema.StorySpec['items'][number];
type Contract = Generated.ChapterContractSchema.ChapterContract;
const CHECKPOINTS = ['orientation', 'verification', 'response'] as const;

export function withArrivalRequirements(
  items: readonly Requirement[],
  intake: Intake,
  enabled: boolean,
): Requirement[] {
  const genres = [intake.genre.primary, ...(intake.genre.secondary ?? [])];
  if (!enabled || intake.manuscript_language !== 'ko' || intake.opening_mode === 'established')
    return [...items];
  const transition = genres.includes('possession')
    ? '빙의'
    : genres.includes('regression')
      ? '회귀'
      : genres.includes('reincarnation')
        ? '환생'
        : undefined;
  if (!transition && intake.opening_mode !== 'arrival') return [...items];
  const experience = transition ?? '갑작스러운 처지의 변화';
  const requirements = [
    `1화는 주인공이 ${experience}를 처음 겪는 상황이다. 직전 삶에서 어떤 사람이었고 마지막으로 무엇을 기억하는지, 현재 어디에 있으며 무엇이 달라졌는지를 구체적 지각과 행동으로 독자가 이해하게 한다. 이미 적응한 일상·공략·시험·돈벌이에서 시작하지 않는다.`,
    `1화에서 주인공은 꿈이나 착각이라는 가설을 세우고 확인 행동을 한다. 관찰한 증거와 기억 속 지식을 비교하여 현재의 몸·장소·세계에 대한 잠정적 결론에 이르는 과정을 지면에 보여 준다. 감각 하나나 경고창만 보고 곧바로 완벽히 적응하지 않는다. 전이의 궁극적 원인은 밝혀내지 않아도 된다.`,
    `1화의 중심 보상은 처지를 조금 이해하고 첫 실질적 선택을 할 수 있게 되는 것이다. 상실·그리움·안도·두려움 등 이 인물에게 맞는 반응과 행동 이유를 충분히 받아낸 뒤 선택한다. 복잡한 생각은 미루겠다는 한 줄로 적응을 생략하지 않는다. 첫 공략의 완승·군중의 경악·즉각적 숭배는 첫 선택 뒤의 회차로 넘긴다.`,
  ];
  const out = [...items];
  const ids = new Set(items.map((r) => r.id));
  let next = 99999;
  for (const [index, text] of requirements.entries()) {
    while (ids.has(`REQ-${next}`)) next--;
    const id = `REQ-${next--}`;
    ids.add(id);
    out.push({
      id,
      kind: 'hard',
      category: 'mandatory_scene',
      text,
      language: 'ko',
      provenance: intake.opening_mode === 'arrival' ? 'user' : 'system_default',
      confirmed_by_user: intake.opening_mode === 'arrival',
      scope: { level: 'chapter_range', chapter_from: 1, chapter_to: 1 },
      structured: { arrival_checkpoint: CHECKPOINTS[index] },
    });
  }
  return out;
}

/** Called for each planner attempt, including repairs, so the model cannot drop the required experience. */
export function bindArrivalRequirements(
  content: Partial<Contract>,
  requirements: readonly Requirement[],
  chapterNo: number,
  enabled: boolean,
): Partial<Contract> {
  if (!enabled || chapterNo !== 1 || !Array.isArray(content.must_happen)) return content;
  const arrival = requirements.filter(
    (r) =>
      r.kind === 'hard' &&
      r.category === 'mandatory_scene' &&
      r.scope.level === 'chapter_range' &&
      r.scope.chapter_from === 1 &&
      r.scope.chapter_to === 1 &&
      CHECKPOINTS.some(
        (key) => (r.structured as Record<string, unknown> | undefined)?.arrival_checkpoint === key,
      ),
  );
  if (!arrival.length) return content;
  const ids = new Set(arrival.map((r) => r.id));
  const events: Contract['must_happen'] = arrival.map((r) => {
    const authored = content.must_happen?.find((m) => m.requirement_id === r.id);
    return {
      id: `arrival-${r.id}`,
      kind: 'required_scene',
      description:
        authored?.id === `arrival-${r.id}` && authored.description.startsWith(r.text)
          ? authored.description
          : authored
            ? `${r.text}\n구체화: ${authored.description}`
            : r.text,
      requirement_id: r.id,
      verifiable_by: 'judge',
    };
  });
  return {
    ...content,
    must_happen: [
      ...events,
      ...content.must_happen.filter(
        (m) => !ids.has(m.requirement_id ?? '') && !events.some((e) => e.id === m.id),
      ),
    ],
    hard_requirement_refs: [...new Set([...(content.hard_requirement_refs ?? []), ...ids])],
  };
}
