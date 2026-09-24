/**
 * State ledgers (ADR-0063): compact tables derived deterministically from ACCEPTED canon and accepted text at
 * the chapter's start. Facts are committed atomically at acceptance and are bitemporal, so a ledger read at a
 * pinned canon version and story clock is reproducible: character state cards, the story clock with its
 * countdowns, the directed 호칭/말높이 matrix and the serial's status-window format.
 */
import {
  acceptedTextsForLedgers,
  entitiesById,
  entityStateAt,
  lastAppearances,
  latestCanonicalClock,
  relationshipAt,
  type Client,
  type FactRow,
  type Pool,
} from '@yeonjae/db';
import { elapsedDays, type StoryClock } from '@yeonjae/domain';
import {
  extractCountdowns,
  latestCountdowns,
  parseStatusWindows,
  statusWindowFormat,
  toNfcText,
  type LedgerCountdown,
  type StatusWindowFormat,
} from '@yeonjae/prose';
import { cmp } from './hash.js';

type Queryable = Pool | Client;
import { clockLabel, clockLabelKo, valueLabel } from './render.js';

export type LedgerLang = 'en' | 'ko';

export type CardField =
  | 'location'
  | 'condition'
  | 'power'
  | 'abilities'
  | 'inventory'
  | 'affiliation'
  | 'goal'
  | 'emotion';

export interface StateCard {
  readonly entityId: string;
  readonly name: string;
  readonly fields: Readonly<Partial<Record<CardField, readonly string[]>>>;
  /** Canonical-event chapter numbers of death, when `status.alive` is false. */
  readonly alive: boolean;
  readonly lastChapter: number | undefined;
}

export interface AddressCell {
  readonly fromId: string;
  readonly toId: string;
  readonly fromName: string;
  readonly toName: string;
  readonly terms: readonly string[];
  /** Expected 말높이 from the register axes (0–4): 존대 at ≥ 3, 반말 at ≤ 1 with familiarity ≥ 2. */
  readonly level: 'polite' | 'plain' | undefined;
}

export interface Ledgers {
  readonly chapterNo: number;
  readonly clockStart: StoryClock;
  readonly previousClock: StoryClock | undefined;
  readonly cards: readonly StateCard[];
  readonly countdowns: readonly LedgerCountdown[];
  /** Story days from each countdown's accepted chapter to this chapter's start, when both clocks compare. */
  readonly countdownElapsed: Readonly<Record<string, number>>;
  readonly address: readonly AddressCell[];
  readonly statusWindow: StatusWindowFormat | undefined;
}

export interface LedgerQuery {
  readonly projectId: string;
  readonly timelineId: string;
  readonly canonVersion: number;
  readonly chapterNo: number;
  readonly clockStart: StoryClock;
  readonly onPageIds: readonly string[];
  readonly speakerPairs: readonly { readonly from: string; readonly to: string }[];
}

function fieldOf(attribute: string): CardField | undefined {
  if (attribute === 'status.location') return 'location';
  if (attribute === 'status.goal') return 'goal';
  if (attribute === 'status.emotion' || attribute === 'status.mood') return 'emotion';
  if (attribute.startsWith('status.')) return 'condition';
  if (
    attribute === 'power.rank' ||
    attribute === 'power.level' ||
    attribute.startsWith('power.stat')
  )
    return 'power';
  if (attribute.startsWith('power.') || attribute.includes('title')) return 'abilities';
  if (attribute.startsWith('inventory.') || attribute.startsWith('resource.')) return 'inventory';
  if (attribute.startsWith('affiliation.') || attribute.startsWith('role.')) return 'affiliation';
  return undefined;
}

function cellValue(f: FactRow, names: ReadonlyMap<string, string>): string {
  const v = valueLabel(f.value, f.value_text);
  const keyName = f.key ? (names.get(f.key) ?? f.key) : undefined;
  if (f.attribute.startsWith('power.stat') || f.attribute.startsWith('resource.'))
    return `${keyName ?? f.attribute.split('.').pop() ?? ''} ${v}`;
  if (f.attribute === 'inventory.item') return keyName && v === '—' ? keyName : v;
  return v;
}

interface RegisterAxes {
  readonly formality?: number;
  readonly deference?: number;
  readonly familiarity?: number;
  readonly address_terms?: readonly unknown[];
}

function levelOf(r: RegisterAxes | null): AddressCell['level'] {
  if (!r) return undefined;
  const high = Math.max(r.formality ?? 0, r.deference ?? 0);
  if (high >= 3) return 'polite';
  if (high <= 1 && (r.familiarity ?? 0) >= 2) return 'plain';
  return undefined;
}

export async function loadLedgers(db: Queryable, q: LedgerQuery): Promise<Ledgers> {
  const ids = [...new Set(q.onPageIds)].sort(cmp);
  const entityRows = await entitiesById(db, q.projectId, ids);
  const names = new Map(entityRows.map((e) => [e.id, e.display_name]));
  const cards: StateCard[] = [];
  const last = await lastAppearances(db, {
    projectId: q.projectId,
    timelineId: q.timelineId,
    asOfVersion: q.canonVersion,
    entityIds: ids,
    beforeChapter: q.chapterNo,
  });
  for (const id of ids) {
    const facts = await entityStateAt(db, {
      projectId: q.projectId,
      entityId: id,
      clock: q.clockStart,
      timelineId: q.timelineId,
      asOfVersion: q.canonVersion,
    });
    const keyIds = facts
      .map((f) => f.key)
      .filter((k): k is string => !!k && /^[0-9a-f-]{36}$/.test(k));
    for (const e of keyIds.length ? await entitiesById(db, q.projectId, keyIds) : [])
      names.set(e.id, e.display_name);
    const fields: Partial<Record<CardField, string[]>> = {};
    let alive = true;
    for (const f of [...facts].sort(
      (a, b) => cmp(a.attribute, b.attribute) || cmp(a.key ?? '', b.key ?? '') || cmp(a.id, b.id),
    )) {
      if (f.attribute === 'status.alive') {
        alive = f.value !== false && f.value !== 'false';
        continue;
      }
      const field = fieldOf(f.attribute);
      if (!field) continue;
      fields[field] = [...(fields[field] ?? []), cellValue(f, names)];
    }
    cards.push({
      entityId: id,
      name: names.get(id) ?? id,
      fields,
      alive,
      lastChapter: last.get(id),
    });
  }

  const texts = await acceptedTextsForLedgers(db, q.projectId, q.chapterNo);
  const countdowns = latestCountdowns(
    texts.recent.map((t) => ({
      chapter_no: t.chapter_no,
      mentions: extractCountdowns(toNfcText(t.text)),
    })),
  );
  const countdownElapsed: Record<string, number> = {};
  const clocks = new Map<number, StoryClock | undefined>();
  for (const c of countdowns) {
    if (!clocks.has(c.chapter_no))
      clocks.set(
        c.chapter_no,
        await latestCanonicalClock(db, {
          projectId: q.projectId,
          timelineId: q.timelineId,
          asOfVersion: q.canonVersion,
          chapterNo: c.chapter_no,
        }),
      );
    const from = clocks.get(c.chapter_no);
    const e = from ? elapsedDays(from, q.clockStart) : undefined;
    if (e?.comparable) countdownElapsed[c.label] = Math.round(e.days);
  }
  const windowSources = texts.firstWindow ? [texts.firstWindow, ...texts.recent] : texts.recent;
  const statusWindow = statusWindowFormat(
    windowSources.map((t) => ({
      chapter_no: t.chapter_no,
      windows: parseStatusWindows(toNfcText(t.text)),
    })),
  );

  const address: AddressCell[] = [];
  for (const pair of q.speakerPairs) {
    const r = await relationshipAt(db, {
      projectId: q.projectId,
      fromId: pair.from,
      toId: pair.to,
      clock: q.clockStart,
      timelineId: q.timelineId,
      asOfVersion: q.canonVersion,
    });
    if (!r) continue;
    const reg = r.register as RegisterAxes | null;
    for (const e of await entitiesById(db, q.projectId, [pair.from, pair.to]).then((rows) =>
      rows.filter((x) => !names.has(x.id)),
    ))
      names.set(e.id, e.display_name);
    address.push({
      fromId: pair.from,
      toId: pair.to,
      fromName: names.get(pair.from) ?? pair.from,
      toName: names.get(pair.to) ?? pair.to,
      terms: Array.isArray(reg?.address_terms)
        ? reg.address_terms.filter((x): x is string => typeof x === 'string')
        : [],
      level: levelOf(reg),
    });
  }
  const previousClock =
    q.chapterNo > 1
      ? await latestCanonicalClock(db, {
          projectId: q.projectId,
          timelineId: q.timelineId,
          asOfVersion: q.canonVersion,
          chapterNo: q.chapterNo - 1,
        })
      : undefined;
  return {
    chapterNo: q.chapterNo,
    clockStart: q.clockStart,
    previousClock,
    cards,
    countdowns,
    countdownElapsed,
    address,
    statusWindow,
  };
}

const FIELD_ORDER: readonly CardField[] = [
  'location',
  'condition',
  'power',
  'abilities',
  'inventory',
  'affiliation',
  'goal',
  'emotion',
];
const FIELD_KO: Readonly<Record<CardField, string>> = {
  location: '위치',
  condition: '상태',
  power: '등급·레벨·스탯',
  abilities: '스킬·칭호',
  inventory: '소지품',
  affiliation: '소속',
  goal: '목표',
  emotion: '감정',
};
const FIELD_EN: Readonly<Record<CardField, string>> = {
  location: 'location',
  condition: 'condition',
  power: 'rank/level/stats',
  abilities: 'skills/titles',
  inventory: 'possessions',
  affiliation: 'affiliation',
  goal: 'goal',
  emotion: 'emotion',
};

function cell(values: readonly string[] | undefined, max = 60): string {
  if (!values?.length) return '—';
  const s = values.join(', ').replace(/\|/g, '/').replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface RenderedLedgers {
  readonly cards: string | undefined;
  readonly clock: string;
  readonly address: string | undefined;
  readonly statusWindow: string | undefined;
}

export function renderLedgers(l: Ledgers, lang: LedgerLang): RenderedLedgers {
  const ko = lang === 'ko';
  const used = FIELD_ORDER.filter((f) => l.cards.some((c) => c.fields[f]?.length));
  const head = ko
    ? ['인물', ...used.map((f) => FIELD_KO[f]), '마지막 등장']
    : ['character', ...used.map((f) => FIELD_EN[f]), 'last seen'];
  const cards = l.cards.length
    ? [
        `| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...l.cards.map((c) => {
          const seen =
            c.lastChapter === undefined
              ? ko
                ? '정사 등장 기록 없음'
                : 'no canonical appearance yet'
              : ko
                ? `${String(c.lastChapter)}화`
                : `ch.${String(c.lastChapter)}`;
          const name = c.alive ? c.name : ko ? `${c.name} (사망)` : `${c.name} (dead)`;
          return `| ${[name, ...used.map((f) => cell(c.fields[f])), seen].join(' | ')} |`;
        }),
      ].join('\n')
    : undefined;
  const clockLine = ko
    ? `이번 화 시작: ${clockLabelKo(l.clockStart)}${l.previousClock ? `; 직전 화 마지막 사건: ${clockLabelKo(l.previousClock)}` : ''}.`
    : `This chapter starts at ${clockLabel(l.clockStart)}${l.previousClock ? `; the previous chapter's last event: ${clockLabel(l.previousClock)}` : ''}.`;
  const countdownLines = l.countdowns.map((c) => {
    const elapsed = l.countdownElapsed[c.label];
    const target = c.label === 'D' ? (ko ? 'D-데이' : 'D-day') : c.label;
    if (ko)
      return `- ${target}: ${String(c.chapter_no)}화에서 ‘${c.quote}’(${String(c.days)}일)${elapsed !== undefined ? ` → ${String(elapsed)}일 경과, 이번 화 시작 시 ${String(c.days - elapsed)}일 남음` : ' → 경과 일수 미상, 늘어나면 안 된다'}`;
    return `- ${target}: “${c.quote}” in ch.${String(c.chapter_no)} (${String(c.days)} days)${elapsed !== undefined ? ` → ${String(elapsed)} days elapsed, ${String(c.days - elapsed)} left at this chapter's start` : ' → elapsed days unknown; it may not grow'}`;
  });
  const clock = [
    clockLine,
    ...(countdownLines.length
      ? [ko ? '카운트다운 (승인 원고 기준):' : 'Countdowns (accepted text):', ...countdownLines]
      : []),
  ].join('\n');
  const address = l.address.length
    ? [
        ko
          ? '| 화자 → 상대 | 호칭 | 말높이 |'
          : '| speaker → addressee | address terms | register |',
        '| --- | --- | --- |',
        ...l.address.map((a) => {
          const level =
            a.level === 'polite'
              ? ko
                ? '존댓말'
                : 'polite'
              : a.level === 'plain'
                ? ko
                  ? '반말'
                  : 'plain'
                : '—';
          return `| ${a.fromName} → ${a.toName} | ${cell(a.terms, 40)} | ${level} |`;
        }),
      ].join('\n')
    : undefined;
  const statusWindow = l.statusWindow
    ? ko
      ? `상태창 형식 (${String(l.statusWindow.chapter_no)}화에서 확정): 괄호 ‘${l.statusWindow.bracket || '없음'}’, 항목 순서 ${l.statusWindow.labels.join(' / ')}. 한 줄에 한 항목씩 쓴다.`
      : `Status-window format (fixed in ch.${String(l.statusWindow.chapter_no)}): bracket “${l.statusWindow.bracket || 'none'}”, fields ${l.statusWindow.labels.join(' / ')}; one field per line.`
    : undefined;
  return { cards, clock, address, statusWindow };
}
