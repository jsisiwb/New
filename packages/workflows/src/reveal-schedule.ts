/**
 * The reveal schedule (U1, live defect G5-1). A bible secret carries one reveal chapter, which the pipeline
 * read as the chapter the *reader* may learn it. In a first-person 회귀/빙의 serial that made the premise itself a
 * reader secret: the hero's own regression, scheduled "not before 150" for the other characters, was blocked in
 * chapter 1 because the knowledge-leak checker read the same number as a reader date.
 *
 * Here every secret gets two dates and a layer:
 * - `readerFrom`: the 화 from which the reader may learn it. A secret owned by the first-person narrator is the
 *   narrator's own knowledge, so the reader shares it from 화 1 (the operator's books state the possession at
 *   once); any other secret keeps its reveal chapter.
 * - `othersFrom`: the 화 from which characters outside its knowers may learn it (the bible's reveal chapter).
 * - `layer`: current timeline, prior-life memory (회귀 전 기억) or source-work knowledge (원작/게임 지식). The
 *   protagonist may think and decide with prior-life and source-work knowledge; only stating a hidden fact to the
 *   reader, or a character acting on what they cannot know, is a leak.
 *
 * Deterministic: the planner, the writer and the knowledge-leak checker read renderings of one schedule.
 */
import { type StoryBible } from './planning.js';

export type KnowledgeLayer = 'current' | 'prior_loop' | 'source_work';

export interface ScheduledSecret {
  /** The bible proposition's local id. */
  readonly localId: string;
  readonly statement: string;
  readonly ownerIds: readonly string[];
  readonly knowerIds: readonly string[];
  readonly layer: KnowledgeLayer;
  /** The 화 from which the reader may learn it; undefined = not scheduled (hidden). */
  readonly readerFrom: number | undefined;
  /** The 화 from which characters outside the knowers may learn it; undefined = not scheduled. */
  readonly othersFrom: number | undefined;
  /** Owned by the first-person narrator: the reader shares it from the start. */
  readonly narratorOwn: boolean;
}

export type ReaderStatus = 'known' | 'revealable' | 'hidden';

const PRIOR_LIFE =
  /(?:지난|이전|전)\s?생|전생|회귀\s?전|회귀하기\s?전|과거\s?회차|[0-9일이삼]\s?회차|미래에서|멸망\s?(?:전|후|이후)|앞선\s?삶/u;
const SOURCE_WORK = /원작|게임\s?(?:속|에서|의|상)|공략|설정집|소설\s?속|작가/u;

/** The layer a secret belongs to: an explicit bible value wins, else the statement's own words decide. */
export function knowledgeLayerOf(statement: string, explicit?: unknown): KnowledgeLayer {
  if (explicit === 'current' || explicit === 'prior_loop' || explicit === 'source_work')
    return explicit;
  if (PRIOR_LIFE.test(statement)) return 'prior_loop';
  if (SOURCE_WORK.test(statement)) return 'source_work';
  return 'current';
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function chapterOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/**
 * Every bible secret on the schedule. `narratorId` is the first-person narrator's bible id (absent for a
 * third-person serial: then every secret keeps its reveal chapter for the reader too).
 */
export function revealSchedule(
  bible: Pick<StoryBible, 'propositions'> | undefined,
  opts: { readonly narratorId?: string | undefined } = {},
): ScheduledSecret[] {
  const out: ScheduledSecret[] = [];
  for (const p of bible?.propositions ?? []) {
    const s = p.secret;
    if (!s) continue;
    const ownerIds = ids(s.owner_ids);
    const knowerIds = ids(s.allowed_knower_ids);
    const othersFrom = chapterOf(s.reveal_not_before_chapter);
    const narratorOwn = opts.narratorId !== undefined && ownerIds.includes(opts.narratorId);
    const explicitReader = chapterOf(s.reader_reveal_chapter);
    // U3: a secret that becomes true later cannot reach the reader before it is true.
    const trueFrom = chapterOf(s.true_from_chapter);
    const base = explicitReader ?? (narratorOwn ? 1 : othersFrom);
    const readerFrom =
      trueFrom !== undefined && base !== undefined ? Math.max(base, trueFrom) : (base ?? trueFrom);
    out.push({
      localId: p.local_id,
      statement: p.statement,
      ownerIds,
      knowerIds,
      layer: knowledgeLayerOf(p.statement, s.layer),
      readerFrom,
      othersFrom,
      narratorOwn,
    });
  }
  return out;
}

export function readerStatus(s: ScheduledSecret, chapterNo: number): ReaderStatus {
  if (s.readerFrom === undefined || s.readerFrom > chapterNo) return 'hidden';
  return s.readerFrom === chapterNo && !s.narratorOwn ? 'revealable' : 'known';
}

/** Secrets the reader may not learn in this chapter. */
export function hiddenFromReader(
  schedule: readonly ScheduledSecret[],
  chapterNo: number,
): ScheduledSecret[] {
  return schedule.filter((s) => readerStatus(s, chapterNo) === 'hidden');
}

const LAYER_KO: Record<KnowledgeLayer, string> = {
  current: '현재 시간선',
  prior_loop: '회귀 전 기억',
  source_work: '원작·게임 지식',
};

export type ScheduleAudience = 'planner' | 'writer' | 'checker';

/**
 * The schedule as a Korean section for one audience. The planner and the writer learn what they may use and
 * what they may only hint at; the checker learns what is *not* a leak, so it blocks only real ones.
 */
export function renderRevealSchedule(
  schedule: readonly ScheduledSecret[],
  chapterNo: number,
  audience: ScheduleAudience,
  opts: {
    readonly nameOf?: ((id: string) => string) | undefined;
    readonly hintBudget?: number | undefined;
  } = {},
): string | undefined {
  if (schedule.length === 0) return undefined;
  const n = opts.nameOf ?? ((id: string) => id);
  const hints = opts.hintBudget ?? 1;
  const who = (s: ScheduledSecret) => s.knowerIds.map(n).join(', ') || '없음';
  const others = (s: ScheduledSecret) =>
    s.othersFrom !== undefined ? `${String(s.othersFrom)}화부터` : '공개 시점 미정';
  const known = schedule.filter((s) => readerStatus(s, chapterNo) === 'known');
  const now = schedule.filter((s) => readerStatus(s, chapterNo) === 'revealable');
  const hidden = hiddenFromReader(schedule, chapterNo);
  const lines: string[] = [];
  if (known.length) {
    lines.push(
      audience === 'checker'
        ? '독자가 이미 아는 것 — 서술·속마음·주인공의 판단에 나와도 누출이 아니다(다른 인물이 아는 척하면 누출이다):'
        : '독자가 이미 아는 것 — 서술과 속마음에 그대로 써도 된다. 다른 인물은 아는 인물 외에는 모른다:',
    );
    for (const s of known)
      lines.push(
        `- “${s.statement}” (${LAYER_KO[s.layer]}; 아는 인물: ${who(s)}; 다른 인물에게는 ${others(s)})`,
      );
  }
  if (now.length) {
    lines.push(
      audience === 'planner'
        ? '이번 화에 독자에게 공개할 수 있는 것 — 공개한다면 핵심 사건이나 절단으로 쓴다:'
        : '이번 화부터 독자에게 공개할 수 있는 것:',
    );
    for (const s of now)
      lines.push(`- “${s.statement}” (${LAYER_KO[s.layer]}; 아는 인물: ${who(s)})`);
  }
  if (hidden.length) {
    lines.push(
      audience === 'checker'
        ? '독자에게 아직 밝히면 안 되는 것 — 서술·대사·속마음으로 직접 말하면 누출이다. 주인공이 이 지식으로 판단하고 행동하는 것, 한 번의 에두른 암시는 누출이 아니다:'
        : audience === 'planner'
          ? `독자에게 아직 밝히지 않는 것 — 계약의 핵심 사건·반드시 일어날 일·절단이 이것을 말하게 하지 않는다. 주인공이 이 지식으로 판단하고 움직이는 장면은 좋다. 암시는 한 화에 ${String(hints)}번까지, 사실 자체는 쓰지 않는다:`
          : `독자에게 아직 밝히지 않는 것 — 서술·대사·속마음 어디에서도 사실을 말하지 않는다. 주인공이 이 지식으로 판단하고 움직이는 것은 좋다. 이번 화의 암시는 ${String(hints)}번까지, 에둘러서만:`,
    );
    for (const s of hidden)
      lines.push(
        `- “${s.statement}” (${LAYER_KO[s.layer]}; 아는 인물: ${who(s)}; 독자에게 ${
          s.readerFrom !== undefined ? `${String(s.readerFrom)}화부터` : '공개 시점 미정'
        })`,
      );
  }
  if (audience !== 'checker')
    lines.push(
      '회귀 전 기억과 원작·게임 지식은 주인공만 가진다. 주인공은 그것으로 생각하고 결정하지만, 다른 인물은 그 지식을 모른다.',
    );
  return lines.join('\n');
}

/** The contract's reader guards: the chapter's hidden secrets, by canon proposition id. */
export function readerGuardsFor(
  schedule: readonly ScheduledSecret[],
  chapterNo: number,
  canonIdOf: (localId: string) => string | undefined,
): { proposition_id: string; reader_from_chapter?: number }[] {
  const out: { proposition_id: string; reader_from_chapter?: number }[] = [];
  for (const s of hiddenFromReader(schedule, chapterNo)) {
    const id = canonIdOf(s.localId);
    if (!id) continue;
    out.push({
      proposition_id: id,
      ...(s.readerFrom !== undefined ? { reader_from_chapter: s.readerFrom } : {}),
    });
  }
  return out;
}
