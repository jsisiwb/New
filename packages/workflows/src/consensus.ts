/**
 * ADR-0115 (`standard@34`): consensus readings and the finding ledger.
 *
 * Run 3 measured that one reading of a model evaluator does not establish a finding (G19-1: the same text read 52 s
 * apart, nothing then a blocking finding) and that every fresh full reading after an approval raised findings the
 * approving readings had not (G19-2, G22-2). These helpers decide a finding from K readings instead of one, and keep a
 * finding's standing tied to the text it quotes: text that did not change keeps its findings, and a new finding on it
 * waits for the final full reading.
 */
import type { Generated } from '@yeonjae/domain';
import type { Paragraph } from '@yeonjae/prose';

type Issue = Generated.IssueSchema.Issue;
type Severity = Issue['severity'];

const RANK: Readonly<Record<Severity, number>> = { note: 0, minor: 1, major: 2, blocking: 3 };

export function isHeavy(i: Pick<Issue, 'severity'>): boolean {
  return i.severity === 'blocking' || i.severity === 'major';
}

/** Two spans of one version overlap by code-point offsets or share a paragraph. */
export function spansOverlap(a: Issue['chapter_span'], b: Issue['chapter_span']): boolean {
  if (!a || !b) return false;
  if (
    typeof a.start === 'number' &&
    typeof a.end === 'number' &&
    typeof b.start === 'number' &&
    typeof b.end === 'number' &&
    a.start < b.end &&
    b.start < a.end
  )
    return true;
  const paragraphs = new Set(a.paragraph_ids ?? []);
  return (b.paragraph_ids ?? []).some((p) => paragraphs.has(p));
}

/**
 * The same finding in two readings of one evaluator: overlapping spans whatever the kind (readings label one slip with
 * different kinds), or, when neither quotes the text, the same kind.
 */
export function findingsMatch(a: Issue, b: Issue): boolean {
  if (a.chapter_span && b.chapter_span) return spansOverlap(a.chapter_span, b.chapter_span);
  if (!a.chapter_span && !b.chapter_span) return a.kind === b.kind;
  return false;
}

export interface ReadingCluster {
  readonly members: readonly { readonly reading: number; readonly issue: Issue }[];
}

/**
 * Groups the findings of K readings of one evaluator. A finding joins the first cluster that it matches and that holds
 * no finding of its own reading yet; findings of one reading never merge with each other.
 */
export function clusterReadings(readings: readonly (readonly Issue[])[]): ReadingCluster[] {
  const clusters: { reading: number; issue: Issue }[][] = [];
  readings.forEach((issues, reading) => {
    for (const issue of issues) {
      const home = clusters.find(
        (c) =>
          !c.some((m) => m.reading === reading) && c.some((m) => findingsMatch(m.issue, issue)),
      );
      if (home) home.push({ reading, issue });
      else clusters.push([{ reading, issue }]);
    }
  });
  return clusters.map((members) => ({ members }));
}

export interface ConsensusOptions {
  readonly quorum: number;
  /** Kinds of the policy's reviewer class; other kinds keep their single-reading rules. */
  readonly reviewer: ReadonlySet<string>;
  readonly ko: boolean;
  /** The override class for a kind at a severity (the pinned policy's matrix). */
  readonly classFor: (kind: Issue['kind'], severity: Severity) => Issue['override_class'];
}

/**
 * One finding per cluster. A reviewer-class finding stands at the highest severity that at least `quorum` readings
 * rate it at or above; rated heavy by fewer readings it is recorded as minor with a note. A finding of another kind
 * (canon contradiction, timeline error, leak, …) stands on one reading, as before. The representative is the heaviest
 * member, the earliest reading on a tie, so its quote, claim and repair are one reading's own.
 */
export function consensusIssues(
  readings: readonly (readonly Issue[])[],
  opts: ConsensusOptions,
): Issue[] {
  const k = readings.length;
  const out: Issue[] = [];
  for (const cluster of clusterReadings(readings)) {
    const rep = [...cluster.members].sort(
      (a, b) => RANK[b.issue.severity] - RANK[a.issue.severity] || a.reading - b.reading,
    )[0]?.issue;
    if (!rep) continue;
    const reviewerClass = opts.reviewer.has(rep.kind) && rep.override_class !== 'never';
    if (!isHeavy(rep) || !reviewerClass) {
      out.push(rep);
      continue;
    }
    // The heaviest severity each reading gave the cluster, heaviest first.
    const perReading = new Map<number, number>();
    for (const m of cluster.members)
      perReading.set(m.reading, Math.max(perReading.get(m.reading) ?? 0, RANK[m.issue.severity]));
    const ranks = [...perReading.values()].sort((a, b) => b - a);
    const agreed = ranks[opts.quorum - 1] ?? 0;
    const votes = ranks.filter((r) => r >= RANK.major).length;
    if (agreed >= RANK.major) {
      const severity: Severity = agreed >= RANK.blocking ? 'blocking' : 'major';
      const cls = severity === rep.severity ? undefined : opts.classFor(rep.kind, severity);
      out.push(
        severity === rep.severity
          ? rep
          : { ...rep, severity, ...(cls ? { override_class: cls } : {}) },
      );
      continue;
    }
    const note = opts.ko
      ? `(${String(k)}회 판독 중 ${String(votes)}회만 주요 결함으로 지적) `
      : `(raised as major in ${String(votes)} of ${String(k)} readings) `;
    out.push({
      ...rep,
      severity: 'minor',
      override_class: 'advisory',
      claim: `${note}${rep.claim}`,
    });
  }
  return out;
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** K readings of one judge: the first reading's other fields, the median of every score. */
export function medianReadings<
  T extends { judge_score?: number; dimension_scores?: Record<string, number> },
>(readings: readonly T[]): T {
  const [first] = readings;
  if (!first) throw new Error('medianReadings needs at least one reading');
  const keys = [...new Set(readings.flatMap((r) => Object.keys(r.dimension_scores ?? {})))];
  const dimension_scores = Object.fromEntries(
    keys.map((key) => [
      key,
      median(
        readings
          .map((r) => r.dimension_scores?.[key])
          .filter((x): x is number => typeof x === 'number'),
      ) ?? 0,
    ]),
  );
  const judge = median(
    readings.map((r) => r.judge_score).filter((x): x is number => typeof x === 'number'),
  );
  return {
    ...first,
    ...(first.dimension_scores || keys.length ? { dimension_scores } : {}),
    ...(judge === undefined ? {} : { judge_score: judge }),
  };
}

export interface CriterionReading {
  readonly criterion_id: string;
  readonly passed: boolean;
  readonly evidence_paragraph_ids?: string[];
  readonly note?: string;
}

/**
 * K readings of the contract checker: a criterion fails only when at least `quorum` readings fail it (a reading that
 * omits it fails it, as one reading does). Each kept entry is the first reading's that agrees with the decision.
 */
export function consensusCriteria(
  readings: readonly (readonly CriterionReading[] | undefined)[],
  quorum: number,
): CriterionReading[] {
  const ids = [...new Set(readings.flatMap((r) => (r ?? []).map((c) => c.criterion_id)))];
  return ids.map((id) => {
    const entries = readings.map((r) => r?.find((c) => c.criterion_id === id));
    const fails = entries.filter((c) => c?.passed !== true).length;
    const passed = fails < quorum;
    const agreeing = entries.find((c) => c?.passed === passed);
    return agreeing ? { ...agreeing } : { criterion_id: id, passed };
  });
}

/**
 * The paragraphs of `next` whose text is not a paragraph of `before` (as a multiset, so a moved paragraph is unchanged
 * and a duplicated one is changed once).
 */
export function changedParagraphIds(
  before: readonly Pick<Paragraph, 'text'>[],
  next: readonly Pick<Paragraph, 'id' | 'text'>[],
): Set<string> {
  const pool = new Map<string, number>();
  for (const p of before) pool.set(p.text, (pool.get(p.text) ?? 0) + 1);
  const changed = new Set<string>();
  for (const p of next) {
    const left = pool.get(p.text) ?? 0;
    if (left > 0) pool.set(p.text, left - 1);
    else changed.add(p.id);
  }
  return changed;
}

/** The paragraphs a span covers: its own paragraph ids, else those its offsets overlap. */
export function spanParagraphIds(
  span: NonNullable<Issue['chapter_span']>,
  paragraphs: readonly Paragraph[],
): string[] {
  if (span.paragraph_ids?.length) return [...span.paragraph_ids];
  const { start, end } = span;
  if (typeof start !== 'number' || typeof end !== 'number') return [];
  return paragraphs.filter((p) => p.start < end && p.end > start).map((p) => p.id);
}

export interface LedgerInput {
  /** This evaluation's findings of one evaluator that read the text (after consensus). */
  readonly fresh: readonly Issue[];
  /** The same evaluator's findings on the parent, re-anchored in this version (no span: it no longer anchors). */
  readonly prior: readonly Issue[];
  /** Paragraph ids of this version whose text changed since the evaluator last read the chapter. */
  readonly changed: ReadonlySet<string>;
  readonly paragraphs: readonly Paragraph[];
  /** Paragraphs on each side of a changed one that a re-reading still judges as new text. */
  readonly window: number;
  readonly ko: boolean;
}

export interface LedgerResult {
  readonly issues: readonly Issue[];
  /** Prior entries kept open because the text they quote did not change (the caller gives them this version's ids). */
  readonly carried: readonly Issue[];
  /** Fresh findings on unchanged text that no open entry explains, recorded as minor until the final full reading. */
  readonly held: readonly Issue[];
}

/**
 * The finding ledger for one evaluator's re-reading. A heavy finding counts when it lies in or next to changed text,
 * quotes nothing (a chapter-level finding), or re-raises an open entry; a heavy finding on unchanged text that no entry
 * explains is held as minor with a note — it was read and passed before, so only the final full reading, by consensus,
 * may raise it. An open entry on unchanged paragraphs stays open whatever the re-reading says, since a reading cannot
 * fix text that did not change; an entry on changed text is resolved unless the re-reading raises it again.
 */
export function applyLedger(input: LedgerInput): LedgerResult {
  const index = new Map(input.paragraphs.map((p, i) => [p.id, i]));
  const changedAt = [...input.changed]
    .map((id) => index.get(id))
    .filter((i): i is number => i !== undefined);
  const ids = (i: Issue) =>
    i.chapter_span ? spanParagraphIds(i.chapter_span, input.paragraphs) : [];
  const touchesChanged = (i: Issue) => ids(i).some((id) => input.changed.has(id));
  const nearChanged = (i: Issue) =>
    ids(i).some((id) => {
      const at = index.get(id);
      return at === undefined || changedAt.some((c) => Math.abs(c - at) <= input.window);
    });
  const openPrior = input.prior.filter((p) => p.status === 'open' && isHeavy(p));
  const note = input.ko
    ? '(앞서 통과한 대목의 새 지적: 최종 전체 판독의 합의를 거쳐야 한다) '
    : '(new finding on text that passed unchanged; held for the final full reading) ';

  const kept: Issue[] = [];
  const held: Issue[] = [];
  for (const f of input.fresh) {
    const onUnchanged =
      isHeavy(f) && f.chapter_span !== undefined && ids(f).length > 0 && !nearChanged(f);
    if (!onUnchanged || openPrior.some((p) => findingsMatch(p, f))) {
      kept.push(f);
      continue;
    }
    const h: Issue = {
      ...f,
      severity: 'minor',
      override_class: 'advisory',
      claim: `${note}${f.claim}`,
    };
    held.push(h);
    kept.push(h);
  }
  const carried: Issue[] = [];
  for (const p of openPrior) {
    if (!p.chapter_span || ids(p).length === 0 || touchesChanged(p)) continue;
    if (kept.some((f) => isHeavy(f) && findingsMatch(f, p))) continue;
    carried.push(p);
  }
  // A lighter fresh reading of a carried entry's text adds nothing beside the entry itself.
  const issues = [
    ...kept.filter((f) => isHeavy(f) || !carried.some((p) => findingsMatch(p, f))),
    ...carried,
  ];
  return { issues, carried, held };
}
