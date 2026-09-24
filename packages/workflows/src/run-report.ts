/**
 * A deterministic report of a novel run from what the run persisted (audit §8.4, §10.5, §11): per chapter
 * the scorecard of every evaluated version (gate outcome, gated dimensions with their composition, issue
 * counts, lint findings by rule), plan-check findings and quarantined versions; per role the model calls
 * with attempts, latency, tokens and cost; the run's wall clock. It reads only rows and artifacts, calls no
 * model and writes nothing, so it can run beside a live run.
 */
import { getNovelRun, pinnedIdentityDocument, type Pool } from '@yeonjae/db';
import { measure, toNfcText } from '@yeonjae/prose';
import { type Heartbeat } from './run-heartbeat.js';

export interface RoleStats {
  readonly role: string;
  readonly calls: number;
  readonly succeeded: number;
  /** Attempts over all calls; a call that succeeded on its second route counts two. */
  readonly attempts: number;
  readonly failed_attempts: number;
  /** Latency of the succeeded attempt, in milliseconds; failed attempts record none. */
  readonly latency_ms: {
    readonly p50: number;
    readonly p90: number;
    readonly max: number;
    readonly total: number;
  };
  readonly tokens: { readonly input: number; readonly output: number };
  readonly cost_cents: number;
}

export interface DimensionRow {
  readonly dimension: string;
  readonly score: number;
  readonly threshold: number;
  readonly passed: boolean;
  readonly rubric_score?: number | undefined;
  readonly lint_composite?: number | undefined;
}

export interface RoundReport {
  readonly version_id: string;
  readonly version_no: number | undefined;
  readonly quarantined: boolean;
  readonly accepted: boolean;
  readonly overall: number | undefined;
  readonly gate_outcome: string | undefined;
  readonly auto_approvable: boolean | undefined;
  readonly dimensions: readonly DimensionRow[];
  readonly counts: Readonly<Record<'blocking' | 'major' | 'minor' | 'note', number>>;
  /** Issue count per source (`lint:ko_style`, `contract_checker`, …). */
  readonly sources: Readonly<Record<string, number>>;
  /** Korean lint findings per rule (the metric's rule id, else the issue kind), with the worst severity. */
  readonly lint: Readonly<Record<string, { readonly count: number; readonly worst: string }>>;
}

export interface ChapterReport {
  readonly number: number;
  readonly status: string;
  readonly accepted_version_id: string | null;
  /** 자 of the accepted text (characters with spaces, without line breaks). */
  readonly characters: number | undefined;
  /** 자 without spaces (ADR-0073, K3): Korean platforms count both ways. */
  readonly characters_no_spaces?: number | undefined;
  readonly versions: number;
  readonly quarantined: readonly { readonly version_no: number; readonly reason: string }[];
  readonly plan_check: Readonly<Record<string, number>>;
  readonly rounds: readonly RoundReport[];
}

export interface RunReport {
  readonly project_id: string;
  readonly policy: string;
  readonly output_language: string;
  readonly lineage: Readonly<Record<string, unknown>>;
  readonly run:
    | {
        readonly status: string;
        readonly target_chapters: number;
        readonly next_chapter: number | null;
        readonly stop_after_chapter: number | null;
        readonly last_error: unknown;
      }
    | undefined;
  /**
   * From the run's creation (else the first recorded call) to the last recorded call. A call row is written
   * when the call ends, so the first call's own duration is inside this span only through the run start.
   */
  readonly wall_clock: {
    readonly started_at: string | undefined;
    readonly last_call_at: string | undefined;
    readonly seconds: number;
  };
  readonly totals: {
    readonly calls: number;
    readonly attempts: number;
    readonly failed_attempts: number;
    readonly tokens: { readonly input: number; readonly output: number };
    readonly cost_cents: number;
  };
  readonly roles: readonly RoleStats[];
  readonly chapters: readonly ChapterReport[];
  readonly normalizations?: Readonly<Record<string, number>> | undefined;
  /** The runner's newest status-file beat (ADR-0072), when the operator passed one. */
  readonly heartbeat?: Heartbeat | undefined;
}

interface CallRow {
  readonly role: string;
  readonly status: string;
  readonly attempt: number;
  readonly latency_ms: number;
  readonly usage: { input?: number; output?: number } | null;
  readonly cost_cents: string | number;
  readonly created_at: Date;
  readonly attempt_records: readonly { outcome?: string }[] | null;
}

/** Nearest-rank percentile of an ascending list; 0 for an empty one. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? 0;
}

export function roleStats(rows: readonly CallRow[]): RoleStats[] {
  const byRole = new Map<string, CallRow[]>();
  for (const r of rows) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r]);
  return [...byRole.entries()]
    .map(([role, calls]) => {
      const ok = calls.filter((c) => c.status === 'succeeded');
      const lat = ok.map((c) => c.latency_ms).sort((a, b) => a - b);
      const records = calls.flatMap((c) => c.attempt_records ?? []);
      return {
        role,
        calls: calls.length,
        succeeded: ok.length,
        attempts: calls.reduce((n, c) => n + Math.max(1, c.attempt), 0),
        failed_attempts: records.filter((a) => a.outcome !== 'succeeded').length,
        latency_ms: {
          p50: percentile(lat, 50),
          p90: percentile(lat, 90),
          max: lat[lat.length - 1] ?? 0,
          total: lat.reduce((n, v) => n + v, 0),
        },
        tokens: {
          input: calls.reduce((n, c) => n + (c.usage?.input ?? 0), 0),
          output: calls.reduce((n, c) => n + (c.usage?.output ?? 0), 0),
        },
        cost_cents: calls.reduce((n, c) => n + Number(c.cost_cents), 0),
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role));
}

interface ScorecardPayload {
  readonly manuscript_version_id?: string;
  readonly overall?: { score?: number };
  readonly sections?: Record<
    string,
    { rubric_score?: number; lint_composite?: number } | undefined
  >;
  readonly issues?: readonly {
    source?: string;
    severity?: string;
    kind?: string;
    metric?: { rule_id?: string };
  }[];
  readonly acceptance?: {
    gate_outcome?: string;
    auto_approvable?: boolean;
    dimension_results?: readonly {
      dimension: string;
      score: number;
      threshold: number;
      passed: boolean;
    }[];
  };
}

const SEVERITY_ORDER = ['note', 'minor', 'major', 'blocking'];

export function roundOf(
  card: ScorecardPayload,
  version: { version_no?: number | undefined; quarantined: boolean; accepted: boolean },
): RoundReport {
  const issues = card.issues ?? [];
  const counts = { blocking: 0, major: 0, minor: 0, note: 0 };
  const sources: Record<string, number> = {};
  const lint: Record<string, { count: number; worst: string }> = {};
  for (const i of issues) {
    const sev = (
      SEVERITY_ORDER.includes(i.severity ?? '') ? i.severity : 'minor'
    ) as keyof typeof counts;
    counts[sev] += 1;
    const source = i.source ?? 'unknown';
    sources[source] = (sources[source] ?? 0) + 1;
    if (source === 'lint:ko_style') {
      const rule = i.metric?.rule_id ?? i.kind ?? 'other';
      const prev = lint[rule];
      const worst =
        prev && SEVERITY_ORDER.indexOf(prev.worst) >= SEVERITY_ORDER.indexOf(sev)
          ? prev.worst
          : sev;
      lint[rule] = { count: (prev?.count ?? 0) + 1, worst };
    }
  }
  return {
    version_id: card.manuscript_version_id ?? '',
    version_no: version.version_no,
    quarantined: version.quarantined,
    accepted: version.accepted,
    overall: card.overall?.score,
    gate_outcome: card.acceptance?.gate_outcome,
    auto_approvable: card.acceptance?.auto_approvable,
    dimensions: (card.acceptance?.dimension_results ?? []).map((d) => ({
      ...d,
      ...(card.sections?.[d.dimension]?.rubric_score !== undefined
        ? { rubric_score: card.sections[d.dimension]?.rubric_score }
        : {}),
      ...(card.sections?.[d.dimension]?.lint_composite !== undefined
        ? { lint_composite: card.sections[d.dimension]?.lint_composite }
        : {}),
    })),
    counts,
    sources,
    lint,
  };
}

export async function buildRunReport(
  pool: Pool,
  projectId: string,
  opts: {
    readonly normalizations?: Readonly<Record<string, number>> | undefined;
    readonly heartbeat?: Heartbeat | undefined;
  } = {},
): Promise<RunReport> {
  const project = await pool.query<{
    production_policy_version: string;
    output_language: string | null;
  }>('SELECT production_policy_version, output_language FROM projects WHERE id = $1', [projectId]);
  const identity = await pinnedIdentityDocument(pool, { projectId, kind: 'narrative_identity' });
  const run = await getNovelRun(pool, projectId);
  const chapters = await pool.query<{
    id: string;
    number: number;
    status: string;
    accepted_version_id: string | null;
  }>(
    'SELECT id, number, status, accepted_version_id FROM chapters WHERE project_id = $1 ORDER BY number',
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
    rejection_reason: string | null;
  }>(
    'SELECT id, chapter_id, version_no, rejection_reason FROM quarantine_versions WHERE project_id = $1 ORDER BY version_no',
    [projectId],
  );
  const artifacts = await pool.query<{ kind: string; payload: Record<string, unknown> }>(
    `SELECT kind, payload FROM workflow_artifacts
      WHERE project_id = $1 AND kind IN ('scorecard', 'plan_check') ORDER BY created_at, id`,
    [projectId],
  );
  const calls = await pool.query<CallRow>(
    `SELECT role, status, attempt, latency_ms, usage, cost_cents, created_at, attempt_records
       FROM llm_calls WHERE project_id = $1 ORDER BY created_at`,
    [projectId],
  );

  const versionInfo = new Map<string, { chapterId: string; versionNo: number; q: boolean }>();
  for (const v of versions.rows)
    versionInfo.set(v.id, { chapterId: v.chapter_id, versionNo: v.version_no, q: false });
  for (const v of quarantined.rows)
    versionInfo.set(v.id, { chapterId: v.chapter_id, versionNo: v.version_no, q: true });
  const accepted = new Set(chapters.rows.map((c) => c.accepted_version_id).filter(Boolean));
  const numberOf = new Map(chapters.rows.map((c) => [c.id, c.number]));

  const rounds = new Map<number, RoundReport[]>();
  const planChecks = new Map<number, Record<string, number>>();
  for (const a of artifacts.rows) {
    if (a.kind === 'plan_check') {
      const p = a.payload as { chapter_no?: number; findings?: { rule?: string }[] };
      if (typeof p.chapter_no !== 'number') continue;
      const tally: Record<string, number> = {};
      for (const f of p.findings ?? [])
        tally[f.rule ?? 'other'] = (tally[f.rule ?? 'other'] ?? 0) + 1;
      planChecks.set(p.chapter_no, tally);
      continue;
    }
    const card = a.payload as ScorecardPayload;
    const info = versionInfo.get(card.manuscript_version_id ?? '');
    const chapterNo = info ? numberOf.get(info.chapterId) : undefined;
    if (chapterNo === undefined) continue;
    rounds.set(chapterNo, [
      ...(rounds.get(chapterNo) ?? []),
      roundOf(card, {
        version_no: info?.versionNo,
        quarantined: info?.q ?? false,
        accepted: accepted.has(card.manuscript_version_id ?? ''),
      }),
    ]);
  }

  const chapterReports: ChapterReport[] = chapters.rows.map((c) => {
    const acceptedText = versions.rows.find((v) => v.id === c.accepted_version_id)?.text;
    return {
      number: c.number,
      status: c.status,
      accepted_version_id: c.accepted_version_id,
      characters:
        acceptedText === undefined ? undefined : measure(toNfcText(acceptedText)).characters,
      ...(acceptedText === undefined
        ? {}
        : {
            characters_no_spaces: Array.from(toNfcText(acceptedText).text.replace(/\s/gu, ''))
              .length,
          }),
      versions: versions.rows.filter((v) => v.chapter_id === c.id).length,
      quarantined: quarantined.rows
        .filter((q) => q.chapter_id === c.id)
        .map((q) => ({ version_no: q.version_no, reason: q.rejection_reason ?? '' })),
      plan_check: planChecks.get(c.number) ?? {},
      rounds: rounds.get(c.number) ?? [],
    };
  });

  const roles = roleStats(calls.rows);
  const first = run?.created_at ?? calls.rows[0]?.created_at;
  const last = calls.rows[calls.rows.length - 1]?.created_at;
  const lineage =
    (identity?.payload as { lineage?: Record<string, unknown> } | undefined)?.lineage ?? {};
  return {
    project_id: projectId,
    policy: project.rows[0]?.production_policy_version ?? '',
    output_language: project.rows[0]?.output_language ?? 'en',
    lineage,
    run: run
      ? {
          status: run.status,
          target_chapters: run.target_chapters,
          next_chapter: run.next_chapter,
          stop_after_chapter: run.stop_after_chapter,
          last_error: run.last_error,
        }
      : undefined,
    wall_clock: {
      started_at: first?.toISOString(),
      last_call_at: last?.toISOString(),
      seconds: first && last ? Math.round((last.getTime() - first.getTime()) / 1000) : 0,
    },
    totals: {
      calls: calls.rows.length,
      attempts: roles.reduce((n, r) => n + r.attempts, 0),
      failed_attempts: roles.reduce((n, r) => n + r.failed_attempts, 0),
      tokens: {
        input: roles.reduce((n, r) => n + r.tokens.input, 0),
        output: roles.reduce((n, r) => n + r.tokens.output, 0),
      },
      cost_cents: roles.reduce((n, r) => n + r.cost_cents, 0),
    },
    roles,
    chapters: chapterReports,
    ...(opts.normalizations ? { normalizations: opts.normalizations } : {}),
    ...(opts.heartbeat ? { heartbeat: opts.heartbeat } : {}),
  };
}

const sec = (ms: number) => `${Math.round(ms / 1000)} s`;

/** The report as Markdown tables, for a run log or a delivery document. */
export function renderRunReport(r: RunReport): string {
  const out: string[] = [];
  out.push(`# Run report — ${r.project_id}`, '');
  out.push(
    `- Policy: \`${r.policy}\`; manuscript language: \`${r.output_language}\`; language layer: \`${typeof r.lineage.output_language === 'string' ? r.lineage.output_language : '—'}\``,
  );
  if (r.run)
    out.push(
      `- Run: ${r.run.status}; next chapter ${String(r.run.next_chapter ?? '—')} of ${String(r.run.target_chapters)}; stop after ${String(r.run.stop_after_chapter ?? '—')}`,
    );
  out.push(
    `- Model calls: ${String(r.totals.calls)} (${String(r.totals.attempts)} attempts, ${String(r.totals.failed_attempts)} failed); tokens in/out ${String(r.totals.tokens.input)}/${String(r.totals.tokens.output)}; cost ${String(r.totals.cost_cents)}¢`,
    `- Wall clock: ${r.wall_clock.started_at ?? '—'} → ${r.wall_clock.last_call_at ?? '—'} (${String(r.wall_clock.seconds)} s)`,
  );
  if (r.heartbeat) {
    const h = r.heartbeat;
    out.push(
      `- Heartbeat: ${h.beat_at} (pid ${String(h.pid)}); idle ${h.idle_seconds === undefined ? '—' : `${String(h.idle_seconds)} s`} of ${String(h.stuck_after_seconds)} s; ${h.stuck ? `STUCK — ${h.reason ?? ''}` : 'live'}${h.running_step ? `; in flight: ${h.running_step.step} since ${h.running_step.since}` : ''}${h.last_call ? `; last call ${h.last_call.role} ${h.last_call.status} at ${h.last_call.at}` : ''}`,
    );
  }
  out.push('');
  out.push('## Chapters', '');
  out.push(
    '| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |',
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of r.chapters) {
    const final = c.rounds[c.rounds.length - 1];
    const pc = Object.entries(c.plan_check)
      .map(([k, v]) => `${k}×${String(v)}`)
      .join(', ');
    out.push(
      `| ${String(c.number)} | ${c.status} | ${c.characters === undefined ? '—' : String(c.characters)} | ${c.characters_no_spaces === undefined ? '—' : String(c.characters_no_spaces)} | ${String(c.versions)} | ${String(c.rounds.length)} | ${final?.gate_outcome ?? '—'} | ${String(c.quarantined.length)} | ${pc || '—'} |`,
    );
  }
  for (const c of r.chapters) {
    if (c.rounds.length === 0) continue;
    out.push('', `### 화 ${String(c.number)}`, '');
    out.push(
      '| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |',
    );
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    c.rounds.forEach((rd, i) => {
      const dim = (name: string) => {
        const d = rd.dimensions.find((x) => x.dimension === name);
        if (!d) return '—';
        const parts = [`${String(d.score)}/${String(d.threshold)}${d.passed ? '' : ' ✗'}`];
        if (d.rubric_score !== undefined) parts.push(`r${String(d.rubric_score)}`);
        if (d.lint_composite !== undefined) parts.push(`l${String(d.lint_composite)}`);
        return parts.join(' ');
      };
      const lint = Object.entries(rd.lint)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(
          ([k, v]) =>
            `${k}×${String(v.count)}${v.worst === 'major' || v.worst === 'blocking' ? '!' : ''}`,
        )
        .join(', ');
      const tag = rd.accepted ? ' (accepted)' : rd.quarantined ? ' (quarantined)' : '';
      out.push(
        `| r${String(i)} | v${String(rd.version_no ?? '?')}${tag} | ${rd.gate_outcome ?? '—'} | ${String(rd.overall ?? '—')} | ${dim('prose')} | ${dim('structure')} | ${dim('genre')} | ${dim('voice')} | ${String(rd.counts.blocking)}/${String(rd.counts.major)}/${String(rd.counts.minor)} | ${lint || '—'} |`,
      );
    });
  }
  out.push('', '## Model calls by role', '');
  out.push('| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of r.roles)
    out.push(
      `| ${s.role} | ${String(s.calls)} | ${String(s.succeeded)} | ${String(s.attempts)} | ${String(s.failed_attempts)} | ${sec(s.latency_ms.p50)} | ${sec(s.latency_ms.p90)} | ${sec(s.latency_ms.max)} | ${String(s.tokens.input)}/${String(s.tokens.output)} |`,
    );
  if (r.normalizations) {
    out.push('', '## Normalizer counters (ADR-0057)', '');
    const entries = Object.entries(r.normalizations).sort((a, b) => a[0].localeCompare(b[0]));
    out.push(
      entries.length
        ? entries.map(([k, v]) => `- \`${k}\`: ${String(v)}`).join('\n')
        : '- none recorded',
    );
  }
  out.push('');
  return out.join('\n');
}
