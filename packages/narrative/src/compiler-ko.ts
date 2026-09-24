/**
 * Korean renderers for the Narrative Identity Block (ADR-0055).
 *
 * A Korean manuscript project must receive its identity block in Korean: English headings and English
 * rule sentences ("Use these English terms", "never native-script names in prose") both pull the model
 * toward English-novel diction and actively contradict a Korean manuscript. These renderers read the same
 * composed identity fields as the English ones; only the rendering language and the language-specific
 * policy lines differ. Enum ids stay machine values in the data and are shown here as Korean descriptions.
 */
import { type ComposedIdentity } from './profiles.js';

export interface ParticipantDigestKo {
  readonly displayName: string;
  readonly shortForms?: readonly string[] | undefined;
  readonly registerLines?: readonly string[] | undefined;
  readonly verbalHabits?: readonly string[] | undefined;
  readonly forbiddenExpressions?: readonly string[] | undefined;
}

const OPENING_KO: Readonly<Record<string, string>> = {
  continue_cliffhanger: '전 회차 절단 직후에서 바로 이어 가기',
  in_medias_res: '사건 한복판에서 시작',
  sharp_dialogue: '날 선 대사 한 줄로 시작',
  status_update: '상태창·시스템 메시지로 시작',
  time_skip_with_tension: '긴장을 품은 시간 도약',
  weather_landscape: '날씨·풍경 묘사',
  lore_dump: '세계관 설명',
  waking_up_routine: '잠에서 깨는 일상 루틴',
};

const ENDING_KO: Readonly<Record<string, string>> = {
  cliffhanger: '클리프행어(위기 직전 절단)',
  reveal: '폭로·정체 공개',
  decision: '결단의 순간',
  arrival_of_threat: '위협의 등장',
  emotional_peak: '감정의 정점',
  quiet_ominous: '조용하고 불길한 여운',
  mid_scene_fade: '장면 도중 흐지부지',
  summary_reflection: '요약·회상 마무리',
};

const PAYOFF_KO: Readonly<Record<string, string>> = {
  satisfaction: '사이다(통쾌한 해소)',
  revelation: '폭로',
  emotional_step: '감정의 한 걸음',
  growth_confirmed: '성장 확인',
  humor_beat: '웃음 포인트',
};

const LORE_VIA_KO: Readonly<Record<string, string>> = {
  action: '행동',
  dialogue: '대사',
  status_text: '상태창',
  narration_slot: '주인공의 속마음·짧은 서술',
};

const SETTING_KO: Readonly<Record<string, string>> = {
  modern_korea: '현대 한국',
  secondary_world: '이세계(가상 세계)',
  murim_historical: '무림·역사 배경',
  other: '기타',
};

const NAMING_KO: Readonly<Record<string, string>> = {
  korean_romanized: '한국식 이름(한글 표기)',
  western: '서양식 이름(한글 표기, 예: 루터 라이트시커)',
  invented: '창작 이름(한글 표기)',
  mixed_by_faction: '세력별로 다른 작명 규칙(한글 표기)',
};

const SHIFT_KO: Readonly<Record<string, string>> = {
  anger: '분노',
  intimacy_step: '친밀도 이정표',
  disguise: '신분 위장',
  mockery: '조롱',
  public_formality: '공적인 자리의 격식',
  age_reveal: '나이 공개',
  emotional_outburst: '감정 폭발',
};

const ko = (map: Readonly<Record<string, string>>, xs: readonly string[] | undefined): string =>
  (xs ?? []).map((x) => map[x] ?? x).join(', ');

function bullet(lines: readonly string[]): string {
  return lines.map((l) => `- ${l}`).join('\n');
}

export function renderStructureKo(id: ComposedIdentity): string {
  const s = id.tradition.structure ?? {};
  const r = id.tradition.rhythm ?? {};
  const over = id.preferences?.numeric_overrides ?? {};
  const narr =
    over['tradition.rhythm.paragraph_max_words_narration'] ?? r.paragraph_max_words_narration;
  const lines: string[] = [];
  if (s.hook_within_sentences !== undefined)
    lines.push(`첫 ${s.hook_within_sentences}문장 안에 긴장이나 전 회차의 연결로 들어간다.`);
  if (s.opening_types_allowed)
    lines.push(`허용되는 도입: ${ko(OPENING_KO, s.opening_types_allowed)}.`);
  if (s.opening_types_forbidden)
    lines.push(`금지되는 도입: ${ko(OPENING_KO, s.opening_types_forbidden)}.`);
  if (s.scene_count_band)
    lines.push(`한 회차는 장면 ${s.scene_count_band.min}~${s.scene_count_band.max}개로 구성한다.`);
  if (s.local_payoff_required_any_of)
    lines.push(
      `이번 회차의 로컬 보상을 하나 이상 준다: ${ko(PAYOFF_KO, s.local_payoff_required_any_of)}.`,
    );
  if (s.ending_types_allowed)
    lines.push(
      `다음 화를 누르게 만드는 절단으로 끝낸다: ${ko(ENDING_KO, s.ending_types_allowed)}. 금지: ${ko(ENDING_KO, s.ending_types_forbidden ?? [])}.`,
    );
  if (s.exposition?.max_consecutive_sentences !== undefined)
    lines.push(
      `설명 문장은 ${s.exposition.max_consecutive_sentences}문장 넘게 연속하지 않는다. 세계 정보는 ${ko(LORE_VIA_KO, s.exposition.lore_via ?? [])}에 녹인다.`,
    );
  if (r.paragraph_max_sentences !== undefined)
    lines.push(
      `문단은 ${r.paragraph_max_sentences}문장 이하${narr !== undefined ? `, 서술 문단은 ${narr}어절 이내` : ''}. 대부분 한두 문장으로 끊고, 강조할 문장은 한 줄 문단으로 떼어 놓는다.`,
    );
  if (r.dialogue_ratio_band)
    lines.push(
      `대사 비중은 대략 ${Math.round(r.dialogue_ratio_band.min * 100)}~${Math.round(r.dialogue_ratio_band.max * 100)}%. 대사 사이에 짧은 행동·반응 비트를 끼운다.`,
    );
  if (r.monologue_ratio_band)
    lines.push(
      `작은따옴표(‘ ’) 속마음은 전체의 ${Math.round(r.monologue_ratio_band.min * 100)}~${Math.round(r.monologue_ratio_band.max * 100)}%.`,
    );
  return lines.length ? bullet(lines) : '';
}

export function renderCadenceKo(id: ComposedIdentity): string {
  const c = id.primaryGenre?.cadence ?? id.tradition.structure?.cadence;
  if (!c) return '';
  const lines: string[] = [];
  if (c.progression_event_every_chapters)
    lines.push(`눈에 보이는 성장·진전 사건을 ${c.progression_event_every_chapters}화마다 한 번.`);
  if (c.satisfaction_every_chapters)
    lines.push(`사이다 비트를 최소 ${c.satisfaction_every_chapters}화마다 한 번.`);
  if (c.max_frustration_streak)
    lines.push(`순수한 고구마(좌절) 회차는 ${c.max_frustration_streak}화 넘게 연속하지 않는다.`);
  if ('relationship_milestone_every_chapters' in c && c.relationship_milestone_every_chapters)
    lines.push(`관계 이정표를 ${c.relationship_milestone_every_chapters}화마다 한 번.`);
  return bullet(lines);
}

export function renderGenresKo(id: ComposedIdentity): string {
  return id.genres
    .map((g) => {
      const lines: string[] = [];
      if (g.reader_fantasy) lines.push(`독자 판타지: ${g.reader_fantasy}`);
      if (g.vocabulary?.preferred_terms?.length)
        lines.push(`장르 용어: ${g.vocabulary.preferred_terms.join(', ')}.`);
      if (g.vocabulary?.discouraged_terms?.length)
        lines.push(`쓰지 않는 말: ${g.vocabulary.discouraged_terms.join(', ')}.`);
      for (const d of g.devices ?? [])
        lines.push(
          `장치 "${d.id}": ${d.description}${d.max_per_chapter !== undefined ? ` (회차당 최대 ${d.max_per_chapter}회)` : ''}${d.format_grammar ? `\n  형식: ${d.format_grammar.replace(/\n/g, ' / ')}` : ''}`,
        );
      for (const n of g.register_notes ?? []) lines.push(`말높이: ${n}`);
      if (g.taboos?.length) lines.push(`피하거나 아껴 쓸 것: ${g.taboos.join('; ')}.`);
      return `장르 ${g.genre_id ?? '?'}:\n${bullet(lines)}`;
    })
    .join('\n');
}

export function renderSettingKo(id: ComposedIdentity): string {
  const s = id.setting;
  if (!s) return '';
  const lines: string[] = [];
  if (s.setting_type) lines.push(`배경 유형: ${SETTING_KO[s.setting_type] ?? s.setting_type}.`);
  if (s.place_names_policy) lines.push(`세계와 지명: ${s.place_names_policy}`);
  if (s.institutions?.length) lines.push(`기관·조직: ${s.institutions.join(', ')}.`);
  if (s.currency) lines.push(`화폐: ${s.currency}.`);
  lines.push(
    '배경이 서양풍 중세 판타지여도 문장·호흡·감정 표현은 한국 웹소설의 것이다. 서양 소설 번역본의 말투를 흉내 내지 않는다.',
  );
  lines.push('문화적 요소는 각주 없이 행동이나 대사 안에서 필요한 만큼만 풀어 준다.');
  for (const n of s.notes ?? []) lines.push(n);
  return bullet(lines);
}

export function renderNamingKo(id: ComposedIdentity): string {
  const n = id.naming;
  if (!n) return '';
  const lines: string[] = [];
  if (n.style) lines.push(`작명: ${NAMING_KO[n.style] ?? n.style}.`);
  for (const note of n.notes ?? []) lines.push(note);
  lines.push(
    '모든 인물·지명은 한글로 표기하고, 등록부의 표시 이름과 약칭만 쓴다. 로마자 표기나 괄호 속 원어 병기는 쓰지 않는다.',
  );
  return bullet(lines);
}

export function renderRegisterKo(id: ComposedIdentity): string {
  const p = id.registerPolicy;
  if (!p) return '';
  const lines: string[] = [];
  for (const r of p.rendering_rules ?? []) lines.push(`${r.condition} 일 때: ${r.guidance}`);
  if (p.anti_patterns?.length) lines.push(`금지: ${p.anti_patterns.join('; ')}.`);
  if (p.allowed_shift_reasons?.length)
    lines.push(
      `말높이는 다음 경우에만 바뀐다: ${ko(SHIFT_KO, p.allowed_shift_reasons)} — 바뀌면 표시한다.`,
    );
  return bullet(lines);
}

export function renderTerminologyKo(id: ComposedIdentity): string {
  const t = id.terminology;
  const lines: string[] = [];
  const rendered = (t?.terms ?? []).map((x) => {
    const label = x.source_term;
    const aliases = x.aliases?.length ? ` (별칭: ${x.aliases.join(', ')})` : '';
    return `${label}${aliases}`;
  });
  if (rendered.length) lines.push(`승인된 용어 표기: ${rendered.join('; ')}.`);
  lines.push(
    '용어는 한국 웹소설 독자에게 익숙한 한국어 표기(상태창, 스킬, 마나, 아카데미 등)를 쓰고, 같은 대상은 끝까지 같은 표기로 부른다. 영어 단어를 로마자 그대로 섞지 않는다.',
  );
  return bullet(lines);
}

export function renderPreferencesKo(id: ComposedIdentity): string {
  const p = id.preferences;
  if (!p) return '';
  const lines: string[] = [];
  for (const t of p.textual ?? [])
    lines.push(`${t.priority === 'must' ? '반드시' : '가능하면'}: ${t.text}`);
  if (p.forbidden_expressions?.length)
    lines.push(`금지 표현: ${p.forbidden_expressions.map((x) => `"${x}"`).join(', ')}.`);
  return bullet(lines);
}

export function renderParticipantsKo(parts: readonly ParticipantDigestKo[]): string {
  return parts
    .map((p) => {
      const lines: string[] = [];
      if (p.shortForms?.length) lines.push(`약칭: ${p.shortForms.join(', ')}`);
      for (const l of p.registerLines ?? []) lines.push(l);
      if (p.verbalHabits?.length) lines.push(`말버릇: ${p.verbalHabits.join('; ')}`);
      if (p.forbiddenExpressions?.length)
        lines.push(`절대 하지 않는 말: ${p.forbiddenExpressions.join('; ')}`);
      return `${p.displayName}\n${bullet(lines)}`;
    })
    .join('\n');
}

type Rubric = NonNullable<ComposedIdentity['tradition']['rubric']>;

export function renderRubricKo(rubric: Rubric | undefined, title: string): string {
  if (!rubric?.length) return '';
  return (
    `${title} — 각 차원을 1~5점으로 채점하고, 먼저 근거 문단 id를 적는다:\n` +
    rubric
      .map((d) => {
        const anchors = d.anchors as Record<string, string | undefined>;
        return `- ${d.dimension}${d.weight !== undefined ? ` (가중치 ${d.weight})` : ''}: 1 = ${anchors['1'] ?? ''} · 3 = ${anchors['3'] ?? ''} · 5 = ${anchors['5'] ?? ''}`;
      })
      .join('\n')
  );
}

const EXEMPLAR_FUNCTION_KO: Readonly<Record<string, string>> = {
  hook: '도입 훅',
  action: '행동',
  banter: '티키타카 대사',
  status_window: '상태창',
  emotional_beat: '감정 비트',
  cliffhanger: '절단',
  exposition_in_action: '행동 속 설명',
  comedy_beat: '웃음 포인트',
};

type StudioExemplar = NonNullable<
  NonNullable<ComposedIdentity['tradition']['style_exemplars']>[number]
>;
/** A studio exemplar, or the operator's style sample (ADR-0073). */
export type Exemplar = Omit<StudioExemplar, 'provenance'> & {
  readonly provenance: StudioExemplar['provenance'] | 'user_supplied';
};

/** The id the operator's style sample carries among the exemplars (ADR-0073). */
export const USER_STYLE_SAMPLE_ID = 'user-style-sample';

/**
 * The operator's style sample as an exemplar (ADR-0073), unless the identity refuses user exemplars. It is
 * the top-priority rhythm reference; like the studio's, its sentences are never copied (EXEMPLAR-COPY).
 */
function userSampleOf(id: ComposedIdentity): Exemplar | undefined {
  const sample = id.preferences?.style_sample;
  if (!sample?.text.trim() || id.preferences?.exemplar_policy?.allow_user_exemplars === false)
    return undefined;
  return {
    id: USER_STYLE_SAMPLE_ID,
    functions: ['action'],
    provenance: 'user_supplied',
    text: sample.text.trim(),
    ...(sample.note ? { note: sample.note } : {}),
  };
}

/**
 * At most three: the operator's style sample first (ADR-0073), then genre layers (primary, then
 * secondary), then the tradition's own.
 */
export function exemplarsOf(id: ComposedIdentity): Exemplar[] {
  const user = userSampleOf(id);
  const all = [
    ...(user ? [user] : []),
    ...id.genres.flatMap((g) => g.style_exemplars ?? []),
    ...(id.tradition.style_exemplars ?? []),
  ];
  const seen = new Set<string>();
  return all.filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, 3);
}

/**
 * Studio-authored voice anchors (ADR-0025, ADR-0056). The model copies rhythm from concrete text far more
 * reliably than from rules, so writers and editors see a few short original passages — framed as rhythm
 * references whose names, events and sentences must never be reused.
 */
export function renderExemplarsKo(id: ComposedIdentity): string {
  const all = exemplarsOf(id);
  const user = all.find((e) => e.id === USER_STYLE_SAMPLE_ID);
  const xs = all.filter((e) => e.id !== USER_STYLE_SAMPLE_ID);
  const userBlock = user
    ? `〔작가 문체 견본 — 최우선〕\n이 작품의 작가가 준 문장이다. 문단 길이, 어미, 대사와 서술의 비율, 속마음의 결을 이 견본에 가장 먼저 맞춘다. 견본의 문장과 표현은 그대로 옮기지 않는다.\n${user.text}\n〔작가 문체 견본 끝〕`
    : '';
  if (xs.length === 0) return userBlock;
  const head =
    '아래 견본은 이 스튜디오가 직접 쓴 합성 문장이다. 문단 길이, 대사와 반응의 간격, 속마음 한 줄, 한 줄 강조 문단, 절단의 리듬만 몸에 익힌다. 견본의 이름·설정·사건·문장은 이 작품에 절대 가져다 쓰지 않고, 시점과 인물은 회차 계약을 따른다.';
  const body = xs.map((e, i) => {
    const fns = e.functions.map((f) => EXEMPLAR_FUNCTION_KO[f] ?? f).join('·');
    const pov = e.pov === 'first' ? '1인칭' : e.pov === 'third_limited' ? '밀착 3인칭' : '';
    const label = [fns, pov].filter(Boolean).join(' | ');
    return `〔견본 ${String(i + 1)} — ${label}〕${e.note ? `\n(${e.note})` : ''}\n${e.text}\n〔견본 ${String(i + 1)} 끝〕`;
  });
  return [...(userBlock ? [userBlock] : []), head, ...body].join('\n\n');
}

const POV_KO: Readonly<Record<string, string>> = {
  first:
    '1인칭 — 서술자는 시점 인물 자신이고 서술에서 자신을 ‘나’로 부른다. 시점 인물의 이름이나 ‘그/그녀’로 자신을 가리키지 않는다.',
  third_limited:
    '밀착 3인칭 — 서술은 시점 인물의 이름과 호칭으로 그를 가리키고, 서술에 ‘나’를 쓰지 않는다. 시점 인물이 모르는 것은 쓰지 않는다.',
  third_omniscient:
    '전지적 3인칭 — 서술은 인물을 이름과 호칭으로 가리키고, 서술에 ‘나’를 쓰지 않는다.',
};

/** The project's point of view as a writer/editor rule (ADR-0073); empty when the intake chose none. */
export function renderPovKo(id: ComposedIdentity): string {
  const pov = id.preferences?.pov;
  return pov ? `시점: ${POV_KO[pov] ?? pov}` : '';
}

/**
 * A rotating few of the operator's translated → webnovel contrast pairs (ADR-0073): `rotation` (the
 * chapter number) picks a different window each chapter so the writer does not overfit three sentences.
 */
export function renderContrastPairsKo(id: ComposedIdentity, rotation: number, count = 3): string {
  const pairs = id.preferences?.contrast_pairs ?? [];
  if (pairs.length === 0) return '';
  const n = Math.min(count, pairs.length);
  const start = ((Math.max(1, Math.floor(rotation)) - 1) * n) % pairs.length;
  const picked = Array.from({ length: n }, (_, i) => pairs[(start + i) % pairs.length]).filter(
    (p): p is NonNullable<typeof p> => p !== undefined,
  );
  return [
    '아래는 작가가 준 대조 예문이다. 왼쪽처럼 쓰지 않고 오른쪽의 호흡으로 쓴다. 문장 자체는 옮기지 않는다.',
    ...picked.map((p) => `- 번역체: ${p.translated}\n  웹소설체: ${p.webnovel}`),
  ].join('\n');
}

/**
 * The diction this identity forbids, as the replacement notes the language layer carries (번역투 markers
 * and stale-cliché patterns). The same lists drive the deterministic Korean style lint, so what the model
 * is told to avoid and what the lint flags are one source.
 */
export function renderAvoidKo(id: ComposedIdentity): string {
  const lang = id.outputLanguage;
  const lines = [
    ...(lang.translation_markers ?? []).map((m) => m.note),
    ...(lang.forbidden_patterns ?? [])
      .filter((f) => f.category === 'stale_cliche' || f.category === 'translation_like')
      .map((f) => f.note),
  ].filter((n): n is string => typeof n === 'string' && n.length > 0);
  if (lines.length === 0) return '';
  return bullet([...new Set(lines)]);
}

export const SECTION_TITLES_KO: Readonly<Record<string, string>> = {
  structure: '구조와 호흡',
  cadence: '연재 카덴스',
  genres: '장르 관습',
  setting: '배경과 문화',
  naming: '작명',
  register: '대사 말높이·호칭',
  participants: '등장인물 말투',
  terminology: '용어',
  preferences: '프로젝트 문체 선호',
  avoid: '쓰지 않는 문장 (번역투·AI 상투구)',
  exemplars: '문체 견본 (리듬 참고용, 베끼기 금지)',
  pov: '시점 (절대)',
  contrast: '대조 예문 (번역체 → 웹소설체)',
  restrictions: '콘텐츠 제한 (절대)',
  prose_rubric: '채점 기준',
  structure_rubric: '채점 기준',
  genre_rubric: '채점 기준',
};

export const IDENTITY_TAIL_KO =
  'IDENTITY_TAIL: 처음부터 한국어로 쓴다(번역투·영어식 어순·대명사 남발 금지). 한국 웹소설 형식을 지킨다: 첫 문장부터 훅, 한두 문장짜리 짧은 문단과 한 줄 강조 문단, 행동→반응→속마음(‘ ’)→대사의 빠른 비트, 이번 회차의 로컬 보상, 다음 화를 누르게 만드는 절단.';
