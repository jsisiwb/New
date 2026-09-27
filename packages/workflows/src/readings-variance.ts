/**
 * Reading variance analysis tool (run 5, STEP 1.2; ADR-0114, ADR-0115).
 * Measures variance across multiple evaluator readings on frozen manuscript versions,
 * evaluates clusterReadings, calculates share of findings seen in >=3 of 5 readings,
 * and verifies K=3 (2-of-3) quorum properties.
 */
import type { Pool } from '@yeonjae/db';
import type { Generated } from '@yeonjae/domain';
import { clusterReadings } from './consensus.js';
import { rubricScore } from './evaluation-plan.js';

type Issue = Generated.IssueSchema.Issue;

export interface DimensionSpread {
  readonly min: number;
  readonly max: number;
  readonly spread: number;
  readonly median: number;
  readonly mean: number;
}

export interface VarianceAnalysisResult {
  readonly totalReadings: number;
  readonly totalClusters: number;
  readonly seenInCount: Readonly<Record<number, number>>;
  readonly shareSeenInAtLeast: Readonly<Record<number, number>>;
  readonly quorum2of3Share: number;
  readonly scoreSpreads: Readonly<Record<string, DimensionSpread>>;
  readonly clusters: readonly {
    readonly count: number;
    readonly highestSeverity: string;
    readonly kind: string;
    readonly quote?: string | undefined;
    readonly claim: string;
  }[];
}

export function analyzeReadingVariance(
  readings: readonly (readonly Issue[])[],
  dimensionScores: readonly Readonly<Record<string, number>>[] = [],
): VarianceAnalysisResult {
  const k = readings.length;
  const clusters = clusterReadings(readings);
  const totalClusters = clusters.length;

  const seenInCount: Record<number, number> = {};
  for (let i = 1; i <= k; i++) seenInCount[i] = 0;

  const clusterSummaries = clusters.map((c) => {
    const count = c.members.length;
    seenInCount[count] = (seenInCount[count] ?? 0) + 1;
    const rep = [...c.members].sort(
      (a, b) =>
        (b.issue.severity === 'blocking' ? 3 : b.issue.severity === 'major' ? 2 : 1) -
        (a.issue.severity === 'blocking' ? 3 : a.issue.severity === 'major' ? 2 : 1),
    )[0]?.issue;
    return {
      count,
      highestSeverity: rep?.severity ?? 'minor',
      kind: rep?.kind ?? 'unknown',
      quote: rep?.chapter_span?.quote,
      claim: rep?.claim ?? '',
    };
  });

  const shareSeenInAtLeast: Record<number, number> = {};
  for (let threshold = 1; threshold <= k; threshold++) {
    let countAtLeast = 0;
    for (let c = threshold; c <= k; c++) {
      countAtLeast += seenInCount[c] ?? 0;
    }
    shareSeenInAtLeast[threshold] = totalClusters > 0 ? countAtLeast / totalClusters : 0;
  }

  // Quorum 2-of-3 properties
  const quorum2of3Share = shareSeenInAtLeast[2] ?? 0;

  // Compute dimension score spreads
  const scoreSpreads: Record<string, DimensionSpread> = {};
  if (dimensionScores.length > 0) {
    const allDims = new Set<string>();
    for (const s of dimensionScores) {
      for (const d of Object.keys(s)) allDims.add(d);
    }
    for (const dim of allDims) {
      const vals = dimensionScores
        .map((s) => s[dim])
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b);
      const min = vals[0];
      const max = vals[vals.length - 1];
      if (min !== undefined && max !== undefined) {
        const spread = max - min;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const mid = Math.floor(vals.length / 2);
        const hi = vals[mid] ?? max;
        const median = vals.length % 2 !== 0 ? hi : ((vals[mid - 1] ?? hi) + hi) / 2;
        scoreSpreads[dim] = { min, max, spread, median, mean };
      }
    }
  }

  return {
    totalReadings: k,
    totalClusters,
    seenInCount,
    shareSeenInAtLeast,
    quorum2of3Share,
    scoreSpreads,
    clusters: clusterSummaries,
  };
}

export interface VersionVarianceRow {
  readonly versionId: string;
  readonly projectTitle?: string | undefined;
  readonly versionNo: number;
  readonly readings: number;
  readonly totalClusters: number;
  readonly singleReadingNoise: number;
  readonly singleReadingNoisePct: string;
  readonly seenIn3Plus: number;
  readonly seenIn3PlusPct: string;
  readonly quorum2of3Retained: number;
  readonly quorum2of3Pct: string;
  readonly scoreSpreads: Readonly<Record<string, string>>;
}

export async function measureVersionVariance(
  pool: Pool,
  versionIds: readonly string[],
): Promise<{
  rows: VersionVarianceRow[];
  markdown: string;
}> {
  const rows: VersionVarianceRow[] = [];

  for (const versionId of versionIds) {
    const vRes = await pool.query<{
      id: string;
      project_id: string;
      version_no: number;
      text: string;
    }>('SELECT id, project_id, version_no, text FROM manuscript_versions WHERE id = $1', [
      versionId,
    ]);
    const v = vRes.rows[0];
    if (!v) continue;

    const pRes = await pool.query<{ title: string }>('SELECT title FROM projects WHERE id = $1', [
      v.project_id,
    ]);
    const projectTitle = pRes.rows[0]?.title ?? v.project_id;

    // Load all scorecards for this version
    const scRes = await pool.query<{
      id: string;
      key: string;
      payload: {
        issues?: Issue[];
        sections?: Record<string, { score?: number }>;
      };
    }>(
      `SELECT id, key, payload FROM workflow_artifacts
       WHERE kind = 'scorecard' AND payload->>'manuscript_version_id' = $1
       ORDER BY created_at`,
      [versionId],
    );

    // Collect readings from stored scorecards
    const rawReadings: Issue[][] = [];
    const dimensionScores: Record<string, number>[] = [];

    for (const sc of scRes.rows) {
      if (Array.isArray(sc.payload.issues)) {
        rawReadings.push(sc.payload.issues);
      }
      if (sc.payload.sections) {
        const scores: Record<string, number> = {};
        for (const [dim, sec] of Object.entries(sc.payload.sections)) {
          if (typeof sec.score === 'number') scores[dim] = sec.score;
        }
        if (Object.keys(scores).length > 0) dimensionScores.push(scores);
      }
    }

    // ADR-0118: only the readings that were stored; run 5 padded them to five by sub-sampling, which measured nothing.
    const analysis = analyzeReadingVariance(rawReadings, dimensionScores);
    const total = analysis.totalClusters;
    const single = analysis.seenInCount[1] ?? 0;
    const seen3 =
      (analysis.seenInCount[3] ?? 0) +
      (analysis.seenInCount[4] ?? 0) +
      (analysis.seenInCount[5] ?? 0);
    const q2 = total - single;

    const spreadStrs: Record<string, string> = {};
    for (const [dim, sp] of Object.entries(analysis.scoreSpreads)) {
      spreadStrs[dim] = `${sp.min.toFixed(1)}–${sp.max.toFixed(1)} (Δ${sp.spread.toFixed(1)})`;
    }

    rows.push({
      versionId,
      projectTitle,
      versionNo: v.version_no,
      readings: rawReadings.length,
      totalClusters: total,
      singleReadingNoise: single,
      singleReadingNoisePct: total > 0 ? `${((single / total) * 100).toFixed(1)}%` : '0%',
      seenIn3Plus: seen3,
      seenIn3PlusPct: total > 0 ? `${((seen3 / total) * 100).toFixed(1)}%` : '0%',
      quorum2of3Retained: q2,
      quorum2of3Pct: total > 0 ? `${((q2 / total) * 100).toFixed(1)}%` : '0%',
      scoreSpreads: spreadStrs,
    });
  }

  // Render markdown report
  const lines: string[] = [
    '# Reading variance over the stored scorecards of each version',
    '',
    '| Version ID | Project | Ver | Stored readings | Distinct findings | Seen in one reading | Seen in 3 or more | Seen in 2 or more | Score spread (prose / structure / voice) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const r of rows) {
    const prose = r.scoreSpreads.prose ?? 'N/A';
    const struct = r.scoreSpreads.structure ?? 'N/A';
    const voice = r.scoreSpreads.voice ?? 'N/A';
    lines.push(
      `| \`${r.versionId.slice(0, 8)}…\` | ${r.projectTitle ?? '-'} | v${String(r.versionNo)} | ${String(r.readings)} | ${String(r.totalClusters)} | ${String(r.singleReadingNoise)} (${r.singleReadingNoisePct}) | ${String(r.seenIn3Plus)} (${r.seenIn3PlusPct}) | ${String(r.quorum2of3Retained)} (${r.quorum2of3Pct}) | P: ${prose}, S: ${struct}, V: ${voice} |`,
    );
  }

  return { rows, markdown: lines.join('\n') };
}

/** One stored reading of an evaluator: its raw findings and scores, as the model answered. */
export interface RawReading {
  readonly issues: readonly {
    readonly kind: string;
    readonly severity: string;
    readonly quote?: string | undefined;
  }[];
  readonly score?: number | undefined;
  readonly rubric: Readonly<Record<string, number>>;
}

export interface TripleVariance {
  readonly readings: number;
  readonly distinct: number;
  /** Distinct findings by how many readings raised them. */
  readonly seenIn: Readonly<Record<number, number>>;
  /** Blocking or major in exactly one reading (what a 2-of-3 quorum drops) and in two or more (what stands). */
  readonly heavySingle: number;
  readonly heavyQuorum: number;
  readonly scoreSpread: number | undefined;
  readonly rubricSpread: Readonly<Record<string, number>>;
}

const squash = (s: string | undefined): string => (s ?? '').replace(/\s+/gu, '');

/** Two raw findings are one when their kinds agree and their quotes overlap (or neither quotes). */
export function sameRawFinding(
  a: RawReading['issues'][number],
  b: RawReading['issues'][number],
): boolean {
  if (a.kind !== b.kind) return false;
  const qa = squash(a.quote);
  const qb = squash(b.quote);
  if (!qa || !qb) return !qa && !qb;
  return qa.includes(qb) || qb.includes(qa);
}

const heavy = (severity: string): boolean => severity === 'blocking' || severity === 'major';

/** Variance of K stored readings of one evaluator on one unchanged text (run 6, STEP 1.2; ADR-0118). */
export function tripleVariance(readings: readonly RawReading[]): TripleVariance {
  const clusters: { reading: number; issue: RawReading['issues'][number] }[][] = [];
  readings.forEach((r, reading) => {
    for (const issue of r.issues) {
      const home = clusters.find(
        (c) =>
          !c.some((m) => m.reading === reading) && c.some((m) => sameRawFinding(m.issue, issue)),
      );
      if (home) home.push({ reading, issue });
      else clusters.push([{ reading, issue }]);
    }
  });
  const seenIn: Record<number, number> = {};
  let heavySingle = 0;
  let heavyQuorum = 0;
  for (const c of clusters) {
    seenIn[c.length] = (seenIn[c.length] ?? 0) + 1;
    const heavyReadings = c.filter((m) => heavy(m.issue.severity)).length;
    if (heavyReadings === 1 && c.length === 1) heavySingle += 1;
    if (heavyReadings >= 2) heavyQuorum += 1;
  }
  const scores = readings.map((r) => r.score).filter((s): s is number => typeof s === 'number');
  const keys = new Set(readings.flatMap((r) => Object.keys(r.rubric)));
  const rubricSpread: Record<string, number> = {};
  for (const k of keys) {
    const vals = readings.map((r) => r.rubric[k]).filter((v): v is number => typeof v === 'number');
    if (vals.length) rubricSpread[k] = Math.max(...vals) - Math.min(...vals);
  }
  return {
    readings: readings.length,
    distinct: clusters.length,
    seenIn,
    heavySingle,
    heavyQuorum,
    scoreSpread: scores.length ? Math.max(...scores) - Math.min(...scores) : undefined,
    rubricSpread,
  };
}

/** The base activity of a consensus reading (`structure_judge:2:r1:full:c3` → `structure_judge:2:r1:full`). */
export function readingBase(activityId: string): string {
  return activityId.replace(/:c[23]$/u, '');
}

function rawReadingOf(payload: unknown): RawReading | undefined {
  const json = (payload as { json?: unknown } | null)?.json;
  if (!json || typeof json !== 'object') return undefined;
  const o = json as { issues?: unknown; judge_score?: unknown; dimension_scores?: unknown };
  const issues = (Array.isArray(o.issues) ? o.issues : []).flatMap((i: unknown) => {
    const r = i as { kind?: unknown; severity?: unknown; quote?: unknown };
    return typeof r.kind === 'string'
      ? [
          {
            kind: r.kind,
            severity: typeof r.severity === 'string' ? r.severity : 'minor',
            quote: typeof r.quote === 'string' ? r.quote : undefined,
          },
        ]
      : [];
  });
  const rubric: Record<string, number> = {};
  if (o.dimension_scores && typeof o.dimension_scores === 'object')
    for (const [k, v] of Object.entries(o.dimension_scores as Record<string, unknown>))
      if (typeof v === 'number') rubric[k] = v;
  return { issues, score: typeof o.judge_score === 'number' ? o.judge_score : undefined, rubric };
}

export interface EvaluatorVarianceRow {
  readonly evaluator: string;
  readonly triples: number;
  readonly findingsPerReading: number;
  readonly distinct: number;
  readonly seenInOne: number;
  readonly heavySingle: number;
  readonly heavyQuorum: number;
  readonly scoreSpreadMedian: number | undefined;
  readonly scoreSpreadMax: number | undefined;
  readonly rubricSpreadMax: Readonly<Record<string, number>>;
  /** Judges only: triples whose readings' rubric scores lie on both sides of the gate, and whose median is below it. */
  readonly straddles?: number | undefined;
  readonly medianBelow?: number | undefined;
}

const JUDGE_DIMENSION: Readonly<Record<string, 'prose' | 'structure' | 'genre' | 'voice'>> = {
  prose_judge: 'prose',
  structure_judge: 'structure',
  genre_judge: 'genre',
  voice_judge: 'voice',
};

/** Where a judge's rubric scores of one text sit against its dimension's gate. */
export function gateSides(
  rubrics: readonly Readonly<Record<string, number>>[],
  dimension: 'prose' | 'structure' | 'genre' | 'voice',
  gate: number,
): { straddles: boolean; medianBelow: boolean } {
  const s = rubrics.map((r) => rubricScore(dimension, r)).sort((a, b) => a - b);
  const lo = s[0] ?? 0;
  const hi = s[s.length - 1] ?? 0;
  const mid = s[Math.floor((s.length - 1) / 2)] ?? 0;
  return { straddles: lo < gate && hi >= gate, medianBelow: mid < gate };
}

/**
 * Run 6, STEP 1.2: the readings a consensus policy (ADR-0115) stored — three per evaluator per evaluation, on unchanged
 * text — grouped by evaluation and measured per evaluator. Only complete triples count; nothing is sampled or padded.
 */
export async function measureStoredTriples(
  pool: Pool,
  projectIds: readonly string[],
  gates: Readonly<
    Partial<Record<'prose' | 'structure' | 'genre' | 'voice', number | undefined>>
  > = {},
): Promise<{ rows: EvaluatorVarianceRow[]; markdown: string }> {
  const { rows } = await pool.query<{ project_id: string; activity_id: string; payload: unknown }>(
    `SELECT c.project_id, c.activity_id, a.payload
       FROM llm_calls c JOIN workflow_artifacts a ON a.id = (c.artifact_ref->>'artifact_id')::uuid
      WHERE c.project_id = ANY($1::uuid[]) AND c.status = 'succeeded' AND c.activity_id ~ ':r[0-9]+'
      ORDER BY c.created_at`,
    [projectIds],
  );
  const groups = new Map<string, { evaluator: string; readings: Map<string, RawReading> }>();
  for (const r of rows) {
    const base = readingBase(r.activity_id);
    const reading = rawReadingOf(r.payload);
    if (!reading) continue;
    const key = `${r.project_id}|${base}`;
    const g = groups.get(key) ?? {
      evaluator: base.split(':')[0] ?? base,
      readings: new Map<string, RawReading>(),
    };
    g.readings.set(r.activity_id, reading);
    groups.set(key, g);
  }
  const byEvaluator = new Map<string, TripleVariance[]>();
  const sides = new Map<string, { straddles: number; medianBelow: number }>();
  for (const g of groups.values()) {
    if (g.readings.size !== 3) continue;
    const list = byEvaluator.get(g.evaluator) ?? [];
    list.push(tripleVariance([...g.readings.values()]));
    byEvaluator.set(g.evaluator, list);
    const dimension = JUDGE_DIMENSION[g.evaluator];
    const gate = dimension ? gates[dimension] : undefined;
    if (dimension && gate !== undefined) {
      const side = gateSides(
        [...g.readings.values()].map((r) => r.rubric),
        dimension,
        gate,
      );
      const acc = sides.get(g.evaluator) ?? { straddles: 0, medianBelow: 0 };
      sides.set(g.evaluator, {
        straddles: acc.straddles + (side.straddles ? 1 : 0),
        medianBelow: acc.medianBelow + (side.medianBelow ? 1 : 0),
      });
    }
  }
  const median = (xs: number[]): number | undefined => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : undefined;
  };
  const out: EvaluatorVarianceRow[] = [...byEvaluator.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([evaluator, ts]) => {
      const spreads = ts.map((t) => t.scoreSpread).filter((s): s is number => s !== undefined);
      const rubricSpreadMax: Record<string, number> = {};
      for (const t of ts)
        for (const [k, v] of Object.entries(t.rubricSpread))
          rubricSpreadMax[k] = Math.max(rubricSpreadMax[k] ?? 0, v);
      return {
        evaluator,
        triples: ts.length,
        findingsPerReading:
          Math.round(
            (ts.reduce(
              (n, t) => n + Object.entries(t.seenIn).reduce((m, [k, c]) => m + Number(k) * c, 0),
              0,
            ) /
              (ts.length * 3)) *
              10,
          ) / 10,
        distinct: ts.reduce((n, t) => n + t.distinct, 0),
        seenInOne: ts.reduce((n, t) => n + (t.seenIn[1] ?? 0), 0),
        heavySingle: ts.reduce((n, t) => n + t.heavySingle, 0),
        heavyQuorum: ts.reduce((n, t) => n + t.heavyQuorum, 0),
        scoreSpreadMedian: median(spreads),
        scoreSpreadMax: spreads.length ? Math.max(...spreads) : undefined,
        rubricSpreadMax,
        ...(sides.has(evaluator) ? sides.get(evaluator) : {}),
      };
    });
  const lines = [
    '| Evaluator | Triples | Findings per reading | Distinct findings | Seen in one reading of three | Heavy in one reading only | Heavy in two or more | Judge-score spread (median / max) | Largest rubric spread | Rubric on both sides of the gate / median below it |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...out.map(
      (r) =>
        `| ${r.evaluator} | ${String(r.triples)} | ${String(r.findingsPerReading)} | ${String(r.distinct)} | ${String(r.seenInOne)} (${r.distinct ? ((r.seenInOne / r.distinct) * 100).toFixed(1) : '0'} %) | ${String(r.heavySingle)} | ${String(r.heavyQuorum)} | ${r.scoreSpreadMedian ?? '—'} / ${r.scoreSpreadMax ?? '—'} | ${
          Object.entries(r.rubricSpreadMax)
            .map(([k, v]) => `${k} ${String(v)}`)
            .join(', ') || '—'
        } | ${r.straddles === undefined ? '—' : `${String(r.straddles)} / ${String(r.medianBelow ?? 0)}`} |`,
    ),
  ];
  return { rows: out, markdown: lines.join('\n') };
}
