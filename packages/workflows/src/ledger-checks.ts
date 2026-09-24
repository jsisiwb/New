/**
 * State-ledger checks (ADR-0063). Two deterministic gates read the ledgers of accepted canon: the pre-draft
 * plan check (contract and scene plans against the ledgers, first meetings and the story clock) and the draft
 * check (countdowns, status-window format and registered address terms in the drafted text).
 */
import { loadLedgers, type Ledgers } from '@yeonjae/context';
import { firstMeetings, getProject, type FirstMeetingRow, type Pool } from '@yeonjae/db';
import { elapsedDays } from '@yeonjae/domain';
import {
  checkAddressRegister,
  checkCountdowns,
  checkStatusWindows,
  extractCountdowns,
  parseStatusWindows,
  toNfcText,
  type NfcText,
} from '@yeonjae/prose';
import { type ChapterContract } from './planning.js';

export interface LedgerFinding {
  readonly rule: string;
  readonly dimension: 'continuity' | 'genre' | 'voice';
  readonly kind: 'timeline_error' | 'format_drift' | 'register_error';
  readonly severity: 'major' | 'minor';
  readonly claim: string;
  readonly paragraph_ids: readonly string[];
}

export function onPageIds(contract: ChapterContract): string[] {
  return [
    ...new Set(contract.participants.filter((p) => p.on_page).map((p) => p.character_id)),
  ].sort();
}

function speakerPairs(ids: readonly string[]): { from: string; to: string }[] {
  return ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ from, to })));
}

export async function ledgersForContract(
  pool: Pool,
  projectId: string,
  contract: ChapterContract,
): Promise<Ledgers> {
  const ids = onPageIds(contract);
  return loadLedgers(pool, {
    projectId,
    timelineId: contract.timeline_id,
    canonVersion: (await getProject(pool, projectId)).canon_version,
    chapterNo: contract.chapter_number,
    clockStart: contract.story_time.start,
    onPageIds: ids,
    speakerPairs: speakerPairs(ids),
  });
}

/** A drafted chapter against the ledgers. */
export function draftLedgerFindings(text: NfcText, ledgers: Ledgers): LedgerFinding[] {
  const countdowns = checkCountdowns(
    extractCountdowns(text),
    ledgers.countdowns,
    ledgers.countdownElapsed,
  ).map((f): LedgerFinding => ({
    rule: f.rule,
    dimension: 'continuity',
    kind: 'timeline_error',
    severity: f.severity,
    claim: f.message,
    paragraph_ids: [f.paragraph_id],
  }));
  const windows = checkStatusWindows(parseStatusWindows(text), ledgers.statusWindow).map(
    (f): LedgerFinding => ({
      rule: f.rule,
      dimension: 'genre',
      kind: 'format_drift',
      severity: f.severity,
      claim: f.message,
      paragraph_ids: [f.paragraph_id],
    }),
  );
  const address = checkAddressRegister(
    text,
    ledgers.address.flatMap((a) =>
      a.level ? [{ from: a.fromName, to: a.toName, terms: a.terms, level: a.level }] : [],
    ),
  ).map((f): LedgerFinding => ({
    rule: f.rule,
    dimension: 'voice',
    kind: 'register_error',
    severity: f.severity,
    claim: f.message,
    paragraph_ids: [f.paragraph_id],
  }));
  return [...countdowns, ...windows, ...address];
}

export interface PlanFinding {
  readonly rule: 'PLAN-DEAD-01' | 'PLAN-CLOCK-01' | 'PLAN-COUNT-01' | 'PLAN-MEET-01';
  readonly blocking: boolean;
  readonly message: string;
}

/** Every Korean/English text the planner wrote for this chapter: contract fields and scene plans. */
function planTexts(contract: ChapterContract, scenes: readonly unknown[]): string[] {
  const strings: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk([
    contract.purpose,
    contract.must_happen,
    contract.hook,
    contract.opening,
    contract.ending_state,
  ]);
  walk(scenes);
  return strings;
}

/**
 * The contract and scene plans against the ledgers. Blocking: an on-page participant the ledger records as
 * dead (PLAN-DEAD-01), story time running backwards from the previous chapter's last canonical event
 * (PLAN-CLOCK-01). Recorded: a planned countdown that disagrees with the ledger (PLAN-COUNT-01) and a planned
 * reunion of two characters who have never met (PLAN-MEET-01).
 */
export function checkPlanConsistency(input: {
  readonly contract: ChapterContract;
  readonly scenes: readonly unknown[];
  readonly ledgers: Ledgers;
  readonly meetings: readonly FirstMeetingRow[];
}): PlanFinding[] {
  const out: PlanFinding[] = [];
  const onPage = new Set(onPageIds(input.contract));
  for (const c of input.ledgers.cards)
    if (!c.alive && onPage.has(c.entityId))
      out.push({
        rule: 'PLAN-DEAD-01',
        blocking: true,
        message: `정사에서 사망한 인물이 이번 화에 직접 등장한다: ${c.name}.`,
      });
  const prev = input.ledgers.previousClock;
  const start = input.contract.story_time.start;
  const e = prev ? elapsedDays(prev, start) : undefined;
  if (e?.comparable && e.days < 0)
    out.push({
      rule: 'PLAN-CLOCK-01',
      blocking: true,
      message: `이야기 시간이 거꾸로 간다: 직전 화 마지막 사건 ${prev?.world_date ?? '?'} → 이번 화 시작 ${start.world_date ?? '?'} (${String(Math.round(e.days))}일).`,
    });
  const texts = planTexts(input.contract, input.scenes);
  const mentions = texts.flatMap((t) => extractCountdowns(toNfcText(t)));
  for (const f of checkCountdowns(
    mentions,
    input.ledgers.countdowns,
    input.ledgers.countdownElapsed,
  ))
    out.push({
      rule: 'PLAN-COUNT-01',
      blocking: false,
      message: `계획의 카운트다운: ${f.message}`,
    });
  const names = new Map(input.ledgers.cards.map((c) => [c.entityId, c.name]));
  for (const m of input.meetings) {
    if (m.chapter_no !== null || m.related) continue;
    const a = names.get(m.a);
    const b = names.get(m.b);
    if (!a || !b) continue;
    if (texts.some((t) => t.includes(a) && t.includes(b) && /재회|다시 만/u.test(t)))
      out.push({
        rule: 'PLAN-MEET-01',
        blocking: false,
        message: `한 번도 만난 적 없는 ${a}와(과) ${b}의 재회를 계획했다. 첫 만남으로 쓰거나 이전 인연을 먼저 세운다.`,
      });
  }
  return out;
}

export async function planConsistency(
  pool: Pool,
  projectId: string,
  contract: ChapterContract,
  scenes: readonly unknown[],
): Promise<{ findings: PlanFinding[]; ledgers: Ledgers }> {
  const ledgers = await ledgersForContract(pool, projectId, contract);
  const meetings = await firstMeetings(pool, {
    projectId,
    timelineId: contract.timeline_id,
    entityIds: onPageIds(contract),
    asOfVersion: (await getProject(pool, projectId)).canon_version,
  });
  return { findings: checkPlanConsistency({ contract, scenes, ledgers, meetings }), ledgers };
}
