/**
 * The operator's first reading of the pipeline's chapters (run 6; ADR-0120 … ADR-0123): the code-rendered blocks the
 * 4.12.0 planners, writers and critics read. Pure functions; every block is Korean (a Korean project is the only
 * one these knobs reach) and renders `undefined` when it does not apply, so callers pass `(없음)`.
 */

/** ADR-0120: what chapters 1–3 must let the reader know, and how fast they may move. */
export function openingDesign(chapterNo: number, chapters: number): string | undefined {
  if (chapterNo > chapters) return undefined;
  const common = [
    '- 큰 사건은 이 화에 하나만 둔다. 사건을 줄줄이 몰아넣지 않고, 한 상황과 그 결과까지 다룬다.',
    '- 세계와 설정은 설명 덩어리로 쏟지 않는다. 주인공의 목소리로, 지금 벌어지는 일과 그 이유를 붙여 짧게 풀어준다.',
    '- 장소는 무대 지시가 아니다. 소리·냄새·빛·촉감과 그곳 사람들이 하는 일로 독자가 그 공간에 서 있게 한다.',
  ];
  if (chapterNo === 1)
    return [
      '[도입부 설계 — 1화]',
      '- 첫 화는 독자가 이 이야기에 발을 들이는 화다. 사건을 터뜨리기 전에, 또는 사건 한가운데서 연다면 그 사건 속에서, 독자가 다음을 알게 한다: 주인공이 지금 어디에 있는지(장소와 때), 어떤 사람인지(말투·관심사·처지가 드러나는 행동), 무엇을 원하고 무엇이 걸려 있는지, 이 세계의 핵심 규칙 하나.',
      '- 첫 줄은 소리·말·강한 한 문장으로 붙잡고, 곧바로 주인공이 지금 겪는 구체적인 한 상황 안으로 들어간다.',
      '- 이야기를 여는 큰 사건(빙의·회귀·각성·첫 위기)은 독자가 주인공의 처지를 이해한 뒤에 무게를 싣는다. 처지를 모르는 독자 앞에서 사건부터 연달아 터뜨리지 않는다.',
      '- 화가 끝날 때 독자는 이 이야기가 앞으로 무엇을 다룰지(전제, 주인공의 목표, 세계의 핵심 규칙) 안다. 절단은 그 전제 위에서 건다.',
      ...common,
    ].join('\n');
  if (chapterNo === 2)
    return [
      '[도입부 설계 — 2화]',
      '- 주인공이 새 처지(새 몸·새 세계·새 신분·새 상황)에 발을 딛는 화다. 공간을 감각으로 익히고, 주변 인물 한둘과 관계를 트고, 세계의 규칙 하나를 몸으로 겪는다.',
      '- 1화의 전제를 다시 설명하지 않는다. 그 전제가 이 세계의 하루에서 어떻게 작동하는지 보여준다.',
      '- 주인공의 첫 목표가 구체적으로 정해진다.',
      ...common,
    ].join('\n');
  return [
    `[도입부 설계 — ${String(chapterNo)}화]`,
    `- ${String(chapters)}화까지가 도입부다. 주인공의 목표와 첫 갈등이 분명해지고, 첫 보상(사이다)이 터질 자리가 만들어진다.`,
    '- 새 장소나 새 인물은 하나씩, 감각과 관계로 넓힌다.',
    ...common,
  ].join('\n');
}

/** ADR-0120: the first scene's role in an opening chapter (the later scenes keep `sceneRole`'s text). */
export function openingSceneRole(sceneNo: number, total: number): string | undefined {
  if (sceneNo !== 1) return undefined;
  const body =
    '첫 줄로 붙잡되, 주인공이 지금 어디서 무엇을 하고 있는지 구체적인 한 상황 안으로 들어간다. 장소·처지·세계의 핵심 규칙을 이 장면 안에서 주인공의 목소리로 알게 한다.';
  if (total <= 1) return `단독 장면 — ${body} 이번 화의 보상을 터뜨린 뒤 절단으로 끝낸다.`;
  return `첫 장면(1/${String(total)}) — ${body} 장면을 정리하지 말고, 다음 장면으로 밀어 넣는 긴장 속에서 끊는다.`;
}

/** ADR-0120: appended to the brief of the arc that opens the series. */
export const ARC_OPENING_BRIEF =
  ' 1~3화는 도입부다: 독자가 주인공의 처지와 이 세계를 익히는 화들이다. 도입부의 한 화에는 큰 비트를 하나만 두고, 아크의 핵심 사건을 도입부에서 소진하지 않는다.';

const COMEDY_KO: Readonly<Record<string, string>> = {
  misunderstanding: '착각',
  slapstick: '몸개그',
  dramatic_irony: '독자만 아는 아이러니',
  character: '성격에서 나오는 웃음',
  meta: '장르를 비트는 메타',
  wordplay: '말장난',
  banter: '티키타카',
  none: '웃음 없음',
};

const ENDING_KO: Readonly<Record<string, string>> = {
  cliffhanger: '위기 직전에 끊기',
  reveal: '폭로',
  decision: '결단·선언',
  arrival_of_threat: '위협의 등장',
  emotional_peak: '감정이 터지는 한마디',
  quiet_ominous: '조용한 불길함',
  mid_scene_fade: '장면 중간에 흐려짐',
  summary_reflection: '요약·관조',
};

const OPENING_KO: Readonly<Record<string, string>> = {
  continue_cliffhanger: '직전 절단 이어받기',
  in_medias_res: '사건 한가운데',
  sharp_dialogue: '날 선 대사',
  status_update: '상태창',
  time_skip_with_tension: '긴장을 안은 시간 건너뛰기',
  weather_landscape: '날씨·풍경',
  lore_dump: '설정 설명',
  waking_up_routine: '잠에서 깨는 일상',
};

export interface DeviceContract {
  readonly chapter_number: number;
  readonly hook: { readonly type: string };
  readonly opening: { readonly type: string };
  readonly devices?: { readonly comedy: string } | undefined;
}

/** ADR-0123: the devices of the accepted chapters before this one, and the rule not to repeat them. */
export function renderDeviceLedger(
  chapterNo: number,
  previous: readonly DeviceContract[],
): string | undefined {
  const rows = [...previous]
    .filter((c) => c.chapter_number < chapterNo)
    .sort((a, b) => a.chapter_number - b.chapter_number);
  if (rows.length === 0) return undefined;
  const label = (map: Readonly<Record<string, string>>, v: string | undefined) =>
    v === undefined ? '기록 없음' : (map[v] ?? v);
  return [
    '[장치 기록 — 직전 화]',
    ...rows.map(
      (c) =>
        `- ${String(c.chapter_number)}화: 웃음 ${label(COMEDY_KO, c.devices?.comedy)}, 절단 ${label(ENDING_KO, c.hook.type)}, 도입 ${label(OPENING_KO, c.opening.type)}`,
    ),
    '이번 화의 웃음은 위 화들과 다른 결로 고른다. 절단과 도입도 바로 앞 화와 같은 유형을 되풀이하지 않는다.',
  ].join('\n');
}

/** ADR-0123: the comedy kinds a contract may not reuse (those of the ledger's chapters). */
export function repeatedComedy(
  comedy: string | undefined,
  previous: readonly DeviceContract[],
): boolean {
  if (comedy === undefined || comedy === 'none') return false;
  return previous.some((c) => c.devices?.comedy === comedy);
}

const clip = (s: unknown, n: number): string => {
  const t = typeof s === 'string' ? s.replace(/\s+/gu, ' ').trim() : '';
  const cps = Array.from(t);
  return cps.length > n ? `${cps.slice(0, n).join('')}…` : t;
};

export interface OtherStory {
  readonly title: string;
  readonly concept: Readonly<Record<string, unknown>>;
}

/** ADR-0121: other projects' approved concepts in the same workspace, as the skeletons a new concept must avoid. */
export function renderOtherStories(stories: readonly OtherStory[]): string | undefined {
  if (stories.length === 0) return undefined;
  const lines = stories.map((s) => {
    const c = s.concept;
    const diff = Array.isArray(c.differentiators) ? c.differentiators[0] : undefined;
    const parts = [
      `로그라인: ${clip(c.logline, 140)}`,
      `1화 훅: ${clip(c.chapter_one_hook, 140)}`,
      diff ? `차별점: ${clip(diff, 100)}` : undefined,
      c.protagonist_sketch ? `주인공: ${clip(c.protagonist_sketch, 100)}` : undefined,
    ].filter(Boolean);
    return `- 「${s.title}」 ${parts.join(' / ')}`;
  });
  return [
    '[이미 쓰인 이야기 — 같은 작업 공간의 다른 작품]',
    ...lines,
    '위 작품들과 같은 뼈대(1화의 사건 순서, 주인공의 유형과 태도, 핵심 장치)를 다시 쓰지 않는다.',
  ].join('\n');
}

export interface OtherOpening {
  readonly title: string;
  readonly contract: {
    readonly opening?: { readonly description?: string } | undefined;
    readonly must_happen?: readonly { readonly description?: string }[] | undefined;
    readonly hook?: { readonly description?: string } | undefined;
  };
}

/** ADR-0121: the chapter-1 skeletons other projects of the workspace already used. */
export function renderOtherOpenings(openings: readonly OtherOpening[]): string | undefined {
  if (openings.length === 0) return undefined;
  return [
    '[다른 작품의 1화 — 같은 순서로 짜지 않는다]',
    ...openings.map((o) => {
      const beats = (o.contract.must_happen ?? [])
        .slice(0, 5)
        .map((m) => clip(m.description, 60))
        .filter(Boolean)
        .join(' → ');
      return `- 「${o.title}」 도입: ${clip(o.contract.opening?.description, 80)} / 사건: ${beats || '—'} / 절단: ${clip(o.contract.hook?.description, 80)}`;
    }),
  ].join('\n');
}

type Design = Readonly<Record<string, unknown>>;

const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : typeof v === 'string' && v.trim()
      ? [v.trim()]
      : [];
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

function innerVoice(design: Design | undefined): Design | undefined {
  const v = design?.inner_voice;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Design) : undefined;
}

/** ADR-0121: the POV character's inner-voice card for the scene writer, from the character designer's `inner_voice`. */
export function renderVoiceCard(name: string, design: Design | undefined): string | undefined {
  const v = innerVoice(design);
  if (!v) return undefined;
  const rows: [string, string | undefined][] = [
    ['유형', text(v.archetype)],
    ['기질', text(v.temperament)],
    ['웃음의 결', text(v.humor)],
    ['감정의 닻', text(v.emotional_anchor)],
    ['말버릇·생각 버릇', list(v.habits).join(' / ') || undefined],
    ['하지 않는 말과 생각', list(v.never).join(' / ') || undefined],
    ['몰릴 때', text(v.under_pressure)],
  ];
  const body = rows.filter(([, x]) => x !== undefined).map(([k, x]) => `- ${k}: ${x ?? ''}`);
  return body.length ? [`[속목소리 카드 — ${name}]`, ...body].join('\n') : undefined;
}

/** ADR-0121: the one-line inner voice the voice judge checks narration and monologue against. */
export function voiceCardLine(design: Design | undefined): string | undefined {
  const v = innerVoice(design);
  if (!v) return undefined;
  const parts = [
    text(v.archetype) ? `유형 ${text(v.archetype) ?? ''}` : undefined,
    text(v.temperament) ? `기질 ${text(v.temperament) ?? ''}` : undefined,
    text(v.humor) ? `웃음 ${text(v.humor) ?? ''}` : undefined,
    text(v.emotional_anchor) ? `감정의 닻 ${text(v.emotional_anchor) ?? ''}` : undefined,
    list(v.habits).length ? `버릇 ${list(v.habits).join(', ')}` : undefined,
    list(v.never).length ? `하지 않는 말 ${list(v.never).join(', ')}` : undefined,
  ].filter(Boolean);
  return parts.length ? `속목소리: ${parts.join('; ')}` : undefined;
}

/** ADR-0122: the scene's place as a lived space, from the world builder's `senses`, `life` and `detail`. */
export function settingNote(name: string, design: Design | undefined): string | undefined {
  const senses = design?.senses;
  const s =
    senses && typeof senses === 'object' && !Array.isArray(senses) ? (senses as Design) : {};
  const rows = [
    text(s.sight) ? `보이는 것 ${text(s.sight) ?? ''}` : undefined,
    text(s.sound) ? `들리는 것 ${text(s.sound) ?? ''}` : undefined,
    text(s.smell) ? `냄새 ${text(s.smell) ?? ''}` : undefined,
    text(s.touch) ? `닿는 것 ${text(s.touch) ?? ''}` : undefined,
    text(design?.life) ? `이곳 사람들 ${text(design?.life) ?? ''}` : undefined,
    text(design?.detail) ? `사는 흔적 ${text(design?.detail) ?? ''}` : undefined,
  ].filter(Boolean);
  if (rows.length === 0) return undefined;
  return `\n\n[공간] ${name} — ${rows.join('; ')}. 이 가운데 두세 가지를 인물의 행동과 말 속에 섞는다. 목록처럼 늘어놓지 않는다.`;
}
