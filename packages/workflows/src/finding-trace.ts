/**
 * A per-finding trace of the chapter acceptance loop (run 4, STEP 1.1): for every blocking or major finding an
 * evaluator raised on its own reading — and every finding a second reading demoted to minor — the round, version
 * and reading, where its span stood against the same evaluator's last reading of the chapter, whether a second
 * reading kept it, and what the later readings made of it. Built from what the run persisted; reads only.
 *
 * Carried findings (an evaluator a targeted re-evaluation did not re-run) are copies, not readings, and get no row:
 * the finding's row is the reading that raised it, and its `later` column follows it.
 */
import { type Pool } from '@yeonjae/db';
import { uuidFromKey } from '@yeonjae/domain';
import {
  segmentParagraphs,
  toNfcText,
  utf16IndexToCodePoint,
  type Paragraph,
} from '@yeonjae/prose';

export type Reading = 'full' | 'targeted' | 'confirmation';
export type SpanState =
  'first_reading' | 're_raised' | 'passed_unchanged' | 'changed_since_last_reading' | 'no_quote';
export type Reproduced = 'kept' | 'dropped_by_second_reading' | 'held_by_ledger' | 'single_reading';
export type Later = 'fixed' | 'came_back' | 'never_addressed' | 'open_at_end';

export interface TraceIssue {
  readonly id?: string | undefined;
  readonly source?: string | undefined;
  readonly kind?: string | undefined;
  readonly severity?: string | undefined;
  readonly claim?: string | undefined;
  readonly chapter_span?:
    | {
        readonly start?: number | undefined;
        readonly end?: number | undefined;
        readonly quote?: string | undefined;
        readonly paragraph_ids?: readonly string[] | undefined;
      }
    | undefined;
}

export interface TraceScorecard {
  readonly id: string;
  readonly manuscript_version_id: string;
  readonly issues?: readonly TraceIssue[] | undefined;
  readonly sections?:
    | Readonly<Record<string, { readonly carried_from?: string | undefined } | undefined>>
    | undefined;
  readonly evaluator_calls?: readonly string[] | undefined;
  /**
   * The evaluation's plan (ADR-0060). It lives on the step result, not on the stored scorecard, so the loader
   * leaves both absent; a section's `carried_from` says the same per evaluator.
   */
  readonly mode?: 'full' | 'targeted' | undefined;
  readonly rerun?: readonly string[] | undefined;
  /** The artifact key; `<version id>:full` is an ADR-0086 confirmation. */
  readonly key?: string | undefined;
}

export interface TraceVersion {
  readonly id: string;
  readonly version_no: number;
  readonly text: string;
  readonly quarantined: boolean;
}

export interface TraceChapter {
  readonly number: number;
  readonly versions: readonly TraceVersion[];
  /** In creation order. */
  readonly scorecards: readonly TraceScorecard[];
}

export interface FindingTraceInput {
  readonly chapters: readonly TraceChapter[];
  /** Lets each scorecard's round be recovered from its id (see `roundFromScorecardId`). */
  readonly projectId?: string | undefined;
  /** ADR-0100 second readings: llm call id → role, for the calls whose activity id carries `:agree`. */
  readonly secondReadings?: ReadonlyMap<string, string> | undefined;
}

export interface FindingTraceRow {
  readonly chapter: number;
  /** The scorecard's position among the chapter's scorecards, in creation order. */
  readonly scorecard: number;
  readonly round: number;
  /** `scorecard_id`: recovered exactly from the id; `order`: counted along the chapter's scorecards. */
  readonly round_from: 'scorecard_id' | 'order';
  readonly version_no: number | undefined;
  readonly quarantined: boolean;
  readonly reading: Reading;
  readonly source: string;
  readonly kind: string;
  readonly severity: string;
  readonly quote: string;
  readonly claim: string;
  readonly span_state: SpanState;
  readonly reproduced: Reproduced;
  readonly later: Later;
  readonly issue_id: string | undefined;
}

/** The notes unconfirmCheckerFindings and unconfirmMajors (evaluation.ts) put before a demoted finding's claim. */
const DEMOTED_NOTES = [
  '(두 번째 판독에서 재현되지 않은 설정 의심) ',
  '(두 번째 판독에서 주요 결함으로 재현되지 않음) ',
  '(a doubt the second reading did not reproduce) ',
  '(not reproduced as major on a second reading) ',
];

/** The scorecard section of each evaluator's findings (SOURCE in evaluation.ts, sectionOf in evaluation-plan.ts). */
const SECTION_OF: Readonly<Record<string, string>> = {
  'judge:contract_checker': 'contract_compliance',
  'judge:continuity_checker': 'continuity',
  'judge:knowledge_leak_checker': 'knowledge',
  'judge:prose_judge': 'prose',
  'judge:structure_judge': 'structure',
  'judge:genre_judge': 'genre',
  'judge:voice_judge': 'voice',
  'judge:promise_checker': 'promises',
  'judge:repetition_judge': 'repetition',
};

const MAX_ROUND = 64;
/** Shorter quotes never match by containment alone. */
const MIN_QUOTE = 4;

const isHeavy = (i: TraceIssue) => i.severity === 'blocking' || i.severity === 'major';
/** ADR-0115: a finding below the consensus quorum, and one the finding ledger held on unchanged text. */
const CONSENSUS_NOTE =
  /^\(\d+회 판독 중 \d+회만 주요 결함으로 지적\) |^\(raised as major in \d+ of \d+ readings\) /u;
const HELD_NOTES = [
  '(앞서 통과한 대목의 새 지적: 최종 전체 판독의 합의를 거쳐야 한다) ',
  '(new finding on text that passed unchanged; held for the final full reading) ',
];
const isHeld = (i: TraceIssue) => HELD_NOTES.some((n) => i.claim?.startsWith(n) === true);
const isDemoted = (i: TraceIssue) =>
  isHeld(i) ||
  CONSENSUS_NOTE.test(i.claim ?? '') ||
  DEMOTED_NOTES.some((n) => i.claim?.startsWith(n) === true);
const squash = (s: string) => s.normalize('NFC').replace(/\s+/gu, ' ').trim();
const head = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const evaluatorOf = (source: string) =>
  SECTION_OF[source] ? source.slice('judge:'.length) : undefined;

/**
 * A scorecard's round, recomputed from its id: evaluation.ts derives it as the v8 UUID of
 * `<workflow>|<version>|scorecard|<round>` (`scorecard:full` for a confirmation), and a chapter's workflow is
 * `chapter:<project>:<n>`. Undefined when no round up to MAX_ROUND reproduces the id.
 */
export function roundFromScorecardId(
  projectId: string,
  chapterNo: number,
  card: Pick<TraceScorecard, 'id' | 'manuscript_version_id'>,
): { round: number; confirmation: boolean } | undefined {
  const prefix = `chapter:${projectId}:${String(chapterNo)}|${card.manuscript_version_id}|`;
  for (let round = 0; round <= MAX_ROUND; round++) {
    if (uuidFromKey(`${prefix}scorecard|${String(round)}`) === card.id)
      return { round, confirmation: false };
    if (uuidFromKey(`${prefix}scorecard:full|${String(round)}`) === card.id)
      return { round, confirmation: true };
  }
  return undefined;
}

/** Whether the finding's evaluator read the text for this scorecard; lint and deterministic checks always do. */
function ran(card: TraceScorecard, source: string): boolean {
  const section = SECTION_OF[source];
  if (!section) return true;
  if (card.rerun) return card.rerun.includes(source.slice('judge:'.length));
  return typeof card.sections?.[section]?.carried_from !== 'string';
}

interface VersionView extends TraceVersion {
  readonly codePoints: readonly string[];
  readonly paragraphs: readonly Paragraph[];
}

interface Located {
  readonly issue: TraceIssue;
  readonly source: string;
  readonly kind: string;
  /** The anchored quote, else the span's own text, else its first paragraph's; whitespace squashed. */
  readonly quote: string;
  /** Texts of the paragraphs holding the span; empty when no span locates a paragraph. */
  readonly paragraphs: readonly string[];
}

function spanParagraphs(
  span: NonNullable<TraceIssue['chapter_span']>,
  v: VersionView,
): readonly Paragraph[] {
  const { start, end } = span;
  if (
    typeof start === 'number' &&
    typeof end === 'number' &&
    start >= 0 &&
    start <= end &&
    end <= v.codePoints.length
  ) {
    const hit = v.paragraphs.filter((p) =>
      end > start ? p.start < end && p.end > start : p.start <= start && start < p.end,
    );
    if (hit.length) return hit;
  }
  const ids = span.paragraph_ids ?? [];
  const byId = v.paragraphs.filter((p) => ids.includes(p.id));
  if (byId.length) return byId;
  const quote = span.quote?.normalize('NFC').trim();
  const at = quote ? v.text.indexOf(quote) : -1;
  if (!quote || at < 0) return [];
  const s = utf16IndexToCodePoint(v.text, at);
  const e = utf16IndexToCodePoint(v.text, at + quote.length);
  return v.paragraphs.filter((p) => p.start < e && p.end > s);
}

function locate(issue: TraceIssue, v: VersionView | undefined): Located {
  const span = issue.chapter_span;
  const paragraphs = span && v ? spanParagraphs(span, v) : [];
  const { start, end } = span ?? {};
  const quote = span?.quote?.trim()
    ? span.quote
    : v && typeof start === 'number' && typeof end === 'number' && start < end
      ? v.codePoints.slice(start, end).join('')
      : (paragraphs[0]?.text ?? '');
  return {
    issue,
    source: issue.source ?? 'unknown',
    kind: issue.kind ?? 'other',
    quote: squash(quote),
    paragraphs: paragraphs.map((p) => p.text),
  };
}

/** Same source, and an overlapping quote, a shared paragraph, or — both with no span at all — the same kind. */
function sameFinding(a: Located, b: Located): boolean {
  if (a.source !== b.source) return false;
  if (
    a.quote.length >= MIN_QUOTE &&
    b.quote.length >= MIN_QUOTE &&
    (a.quote.includes(b.quote) || b.quote.includes(a.quote))
  )
    return true;
  if (a.paragraphs.some((p) => b.paragraphs.includes(p))) return true;
  const spanless = (x: Located) => x.paragraphs.length === 0 && x.quote === '';
  return spanless(a) && spanless(b) && a.kind === b.kind;
}

/**
 * One row per blocking or major finding an evaluator raised on its own reading, and per finding a second reading
 * demoted. `reading`: `confirmation` for an ADR-0086 confirmation (artifact key `:full`, a `scorecard:full` id, or a
 * full scorecard on the version of the immediately preceding targeted one), `targeted` when the plan says so or
 * some evaluator's section was carried, else `full`. The evaluator's last reading is the latest earlier scorecard
 * of the chapter in which it ran (its section not carried, or it is in `rerun`); `span_state` is decided in order:
 * `first_reading` (no such reading), `re_raised` (it raised the same finding at blocking/major), `no_quote` (no span
 * locates a paragraph), `changed_since_last_reading` (a span paragraph is not verbatim in that reading's version),
 * else `passed_unchanged`. `later` follows the same finding through later readings of non-quarantined versions.
 */
export function traceFindings(input: FindingTraceInput): FindingTraceRow[] {
  const rows: FindingTraceRow[] = [];
  for (const chapter of input.chapters) {
    const views = new Map<string, VersionView>();
    for (const v of chapter.versions) {
      const nfc = toNfcText(v.text);
      views.set(v.id, {
        ...v,
        text: nfc.text,
        codePoints: nfc.codePoints,
        paragraphs: segmentParagraphs(nfc),
      });
    }
    const cards = chapter.scorecards.filter((c) => views.has(c.manuscript_version_id));
    const byId = cards.map((c) =>
      input.projectId ? roundFromScorecardId(input.projectId, chapter.number, c) : undefined,
    );
    const readings: Reading[] = [];
    cards.forEach((c, i) => {
      const targeted = c.mode
        ? c.mode === 'targeted'
        : Object.values(c.sections ?? {}).some((s) => typeof s?.carried_from === 'string');
      const confirmation =
        c.key?.endsWith(':full') === true ||
        byId[i]?.confirmation === true ||
        (!targeted &&
          readings[i - 1] === 'targeted' &&
          cards[i - 1]?.manuscript_version_id === c.manuscript_version_id);
      readings.push(confirmation ? 'confirmation' : targeted ? 'targeted' : 'full');
    });
    // Without a matching id: the loop evaluates once per round, and a confirmation shares its round.
    const rounds: { round: number; from: FindingTraceRow['round_from'] }[] = [];
    cards.forEach((_, i) => {
      const exact = byId[i];
      const prev = rounds[i - 1];
      rounds.push(
        exact
          ? { round: exact.round, from: 'scorecard_id' }
          : {
              round: !prev ? 0 : readings[i] === 'confirmation' ? prev.round : prev.round + 1,
              from: 'order',
            },
      );
    });
    const located = cards.map((c) =>
      (c.issues ?? []).map((i) => locate(i, views.get(c.manuscript_version_id))),
    );
    const raisedIn = (k: number, f: Located) =>
      (located[k] ?? []).some(
        (g) => g.source === f.source && isHeavy(g.issue) && sameFinding(f, g),
      );

    cards.forEach((card, i) => {
      const version = views.get(card.manuscript_version_id);
      const own = located[i] ?? [];
      for (const f of own) {
        if (!(isHeavy(f.issue) || isDemoted(f.issue)) || !ran(card, f.source)) continue;

        let last = -1;
        for (let j = i - 1; j >= 0 && last < 0; j--) {
          const c = cards[j];
          if (c && ran(c, f.source)) last = j;
        }
        const before = views.get(cards[last]?.manuscript_version_id ?? '')?.text ?? '';
        const spanState: SpanState =
          last < 0
            ? 'first_reading'
            : raisedIn(last, f)
              ? 're_raised'
              : f.paragraphs.length === 0
                ? 'no_quote'
                : f.paragraphs.every((p) => before.includes(p))
                  ? 'passed_unchanged'
                  : 'changed_since_last_reading';

        const evaluator = evaluatorOf(f.source);
        const reread =
          own.some((g) => g.source === f.source && isDemoted(g.issue)) ||
          (evaluator !== undefined &&
            (card.evaluator_calls ?? []).some((id) => input.secondReadings?.get(id) === evaluator));

        const present: boolean[] = [];
        for (let k = i + 1; k < cards.length; k++) {
          const c = cards[k];
          if (!c || views.get(c.manuscript_version_id)?.quarantined === true || !ran(c, f.source))
            continue;
          present.push(raisedIn(k, f));
        }
        const gap = present.indexOf(false);
        const later: Later =
          present.length === 0
            ? 'open_at_end'
            : gap < 0
              ? 'never_addressed'
              : present.slice(gap + 1).includes(true)
                ? 'came_back'
                : 'fixed';

        rows.push({
          chapter: chapter.number,
          scorecard: i,
          round: rounds[i]?.round ?? 0,
          round_from: rounds[i]?.from ?? 'order',
          version_no: version?.version_no,
          quarantined: version?.quarantined ?? false,
          reading: readings[i] ?? 'full',
          source: f.source,
          kind: f.kind,
          severity: f.issue.severity ?? 'minor',
          quote: head(f.quote, 60),
          claim: head(squash(f.issue.claim ?? ''), 100),
          span_state: spanState,
          reproduced: isHeld(f.issue)
            ? 'held_by_ledger'
            : isDemoted(f.issue)
              ? 'dropped_by_second_reading'
              : reread
                ? 'kept'
                : 'single_reading',
          later,
          issue_id: f.issue.id,
        });
      }
    });
  }
  return rows;
}

const SPAN_STATES: readonly SpanState[] = [
  'first_reading',
  're_raised',
  'passed_unchanged',
  'changed_since_last_reading',
  'no_quote',
];

export function renderFindingTrace(rows: readonly FindingTraceRow[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const chapters = [...new Set(rows.map((r) => r.chapter))].sort((a, b) => a - b);
  const out = [
    `# Finding trace — ${String(rows.length)} findings in ${String(chapters.length)} chapters`,
    '',
    "One row per blocking or major finding an evaluator raised on its own reading (carried findings are copies and get none), and per finding a second reading demoted to minor. `span`: the finding against the same evaluator's last reading of the chapter. `later`: the same finding in later readings of non-quarantined versions. A round marked `?` is counted along the scorecards, not recovered from the scorecard id.",
  ];
  for (const ch of chapters) {
    out.push('', `## Chapter ${String(ch)}`, '');
    out.push(
      '| # | round | version | reading | source | severity | kind | span | second reading | later | quote | claim |',
    );
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows.filter((x) => x.chapter === ch))
      out.push(
        `| ${String(r.scorecard)} | r${String(r.round)}${r.round_from === 'order' ? '?' : ''} | v${r.version_no === undefined ? '?' : String(r.version_no)}${r.quarantined ? ' (quarantined)' : ''} | ${r.reading} | ${r.source} | ${r.severity} | ${r.kind} | ${r.span_state} | ${r.reproduced} | ${r.later} | ${cell(r.quote) || '—'} | ${cell(r.claim)} |`,
      );
  }
  const count = (state: SpanState | undefined, reading: Reading | undefined) =>
    String(
      rows.filter(
        (r) =>
          (state === undefined || r.span_state === state) &&
          (reading === undefined || r.reading === reading),
      ).length,
    );
  out.push('', '## Summary', '', '| span state | full | targeted | confirmation | total |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const s of [...SPAN_STATES, undefined])
    out.push(
      `| ${s ?? 'total'} | ${count(s, 'full')} | ${count(s, 'targeted')} | ${count(s, 'confirmation')} | ${count(s, undefined)} |`,
    );
  const confirmations = rows.filter((r) => r.reading === 'confirmation');
  const standing = confirmations.filter(
    (r) => r.reproduced !== 'dropped_by_second_reading' && r.reproduced !== 'held_by_ledger',
  );
  const unchanged = (list: readonly FindingTraceRow[]) =>
    String(list.filter((r) => r.span_state === 'passed_unchanged').length);
  out.push(
    '',
    `Confirmation-reading findings on text that passed unchanged: ${unchanged(confirmations)} of ${String(confirmations.length)}; still blocking or major after any second reading: ${unchanged(standing)} of ${String(standing.length)}.`,
    '',
  );
  return out.join('\n');
}

/** The trace of a project's chapters, read like buildRunReport reads them. Reads only; safe beside a live run. */
export async function findingTrace(
  pool: Pool,
  projectId: string,
  opts: { readonly chapter?: number | undefined } = {},
): Promise<FindingTraceRow[]> {
  const chapters = await pool.query<{ id: string; number: number }>(
    'SELECT id, number FROM chapters WHERE project_id = $1 ORDER BY number',
    [projectId],
  );
  const versions = await pool.query<{
    id: string;
    chapter_id: string;
    version_no: number;
    text: string;
  }>('SELECT id, chapter_id, version_no, text FROM manuscript_versions WHERE project_id = $1', [
    projectId,
  ]);
  const quarantined = await pool.query<{
    id: string;
    chapter_id: string;
    version_no: number;
    text: string;
  }>(
    'SELECT id, chapter_id, version_no, text FROM quarantine_versions WHERE project_id = $1 ORDER BY version_no',
    [projectId],
  );
  const artifacts = await pool.query<{ key: string; payload: TraceScorecard }>(
    `SELECT key, payload FROM workflow_artifacts
      WHERE project_id = $1 AND kind = 'scorecard' ORDER BY created_at, id`,
    [projectId],
  );
  // ADR-0100: a second reading's activity id ends in `:agree`; its call id is in its scorecard's evaluator_calls.
  const agree = await pool.query<{ id: string; role: string }>(
    `SELECT id, role FROM llm_calls WHERE project_id = $1 AND activity_id LIKE '%:agree%'`,
    [projectId],
  );

  const byVersion = new Map<string, TraceVersion & { chapterId: string }>();
  for (const v of versions.rows)
    byVersion.set(v.id, {
      id: v.id,
      version_no: v.version_no,
      text: v.text,
      quarantined: false,
      chapterId: v.chapter_id,
    });
  for (const v of quarantined.rows)
    byVersion.set(v.id, {
      id: v.id,
      version_no: v.version_no,
      text: v.text,
      quarantined: true,
      chapterId: v.chapter_id,
    });
  const cardsOf = new Map<string, TraceScorecard[]>();
  for (const a of artifacts.rows) {
    const chapterId = byVersion.get(a.payload.manuscript_version_id)?.chapterId;
    if (chapterId)
      cardsOf.set(chapterId, [...(cardsOf.get(chapterId) ?? []), { ...a.payload, key: a.key }]);
  }
  return traceFindings({
    projectId,
    secondReadings: new Map(agree.rows.map((r) => [r.id, r.role])),
    chapters: chapters.rows
      .filter((c) => opts.chapter === undefined || c.number === opts.chapter)
      .map((c) => ({
        number: c.number,
        versions: [...byVersion.values()]
          .filter((v) => v.chapterId === c.id)
          .sort((a, b) => a.version_no - b.version_no)
          .map(({ chapterId: _chapterId, ...v }) => v),
        scorecards: cardsOf.get(c.id) ?? [],
      })),
  });
}
