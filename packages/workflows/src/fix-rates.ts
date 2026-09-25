/**
 * Per-kind fix rates of revision rounds (ADR-0087, STEP 3). Every patched round persists a regression report
 * that names the issues it targeted and which of them it resolved (ADR-0014); the parent's scorecard names their
 * kinds. Aggregated over projects, the table says which finding kinds a patch repairs and which it does not —
 * the evidence for which rung of the escalation ladder a kind starts on. Reads only.
 */
import { type Pool } from '@yeonjae/db';

export interface FixRateRow {
  readonly kind: string;
  readonly dimension: string;
  readonly targeted: number;
  readonly resolved: number;
  /** Rounds whose patch was kept (regression passed) among those targeting this kind. */
  readonly kept: number;
}

export interface FixRateReport {
  readonly projects: number;
  readonly rounds: number;
  readonly keptRounds: number;
  readonly rows: readonly FixRateRow[];
}

interface ReportPayload {
  parent_version_id?: string;
  passed?: boolean;
  targeted?: { resolved_issue_ids?: string[]; unresolved_issue_ids?: string[] };
}

interface IssueLite {
  id: string;
  kind: string;
  dimension: string;
}

export async function fixRates(pool: Pool, projectIds?: readonly string[]): Promise<FixRateReport> {
  const filter = projectIds?.length ? 'AND project_id = ANY($1::uuid[])' : '';
  const args = projectIds?.length ? [projectIds] : [];
  const reports = await pool.query<{ project_id: string; payload: ReportPayload }>(
    `SELECT project_id, payload FROM workflow_artifacts WHERE kind = 'regression_report' ${filter}`,
    args,
  );
  const cards = await pool.query<{ key: string; payload: { issues?: IssueLite[] } }>(
    `SELECT key, payload FROM workflow_artifacts WHERE kind = 'scorecard' ${filter}`,
    args,
  );
  const issuesByVersion = new Map<string, Map<string, IssueLite>>();
  for (const c of cards.rows) {
    const versionId = c.key.replace(/:full$/, '');
    const byId = issuesByVersion.get(versionId) ?? new Map<string, IssueLite>();
    for (const i of c.payload.issues ?? []) byId.set(i.id, i);
    issuesByVersion.set(versionId, byId);
  }
  const rows = new Map<
    string,
    { kind: string; dimension: string; targeted: number; resolved: number; kept: number }
  >();
  let keptRounds = 0;
  for (const r of reports.rows) {
    const parent = r.payload.parent_version_id;
    const byId = parent ? issuesByVersion.get(parent) : undefined;
    if (!byId) continue;
    const kept = r.payload.passed === true;
    if (kept) keptRounds++;
    const resolved = new Set(r.payload.targeted?.resolved_issue_ids ?? []);
    const ids = [
      ...(r.payload.targeted?.resolved_issue_ids ?? []),
      ...(r.payload.targeted?.unresolved_issue_ids ?? []),
    ];
    for (const id of ids) {
      const issue = byId.get(id);
      if (!issue) continue;
      const key = `${issue.dimension}|${issue.kind}`;
      const row = rows.get(key) ?? {
        kind: issue.kind,
        dimension: issue.dimension,
        targeted: 0,
        resolved: 0,
        kept: 0,
      };
      row.targeted++;
      if (resolved.has(id)) row.resolved++;
      if (kept) row.kept++;
      rows.set(key, row);
    }
  }
  return {
    projects: new Set(reports.rows.map((r) => r.project_id)).size,
    rounds: reports.rows.length,
    keptRounds,
    rows: [...rows.values()].sort(
      (a, b) => b.targeted - a.targeted || a.kind.localeCompare(b.kind),
    ),
  };
}

export function renderFixRates(r: FixRateReport): string {
  const pct = (a: number, b: number) => (b ? `${String(Math.round((a / b) * 100))} %` : '—');
  return [
    `# Fix rates of revision rounds — ${String(r.projects)} projects, ${String(r.rounds)} patched rounds, ${String(r.keptRounds)} kept`,
    '',
    '| dimension | kind | targeted | resolved | fix rate | in kept rounds |',
    '| --- | --- | --- | --- | --- | --- |',
    ...r.rows.map(
      (x) =>
        `| ${x.dimension} | ${x.kind} | ${String(x.targeted)} | ${String(x.resolved)} | ${pct(x.resolved, x.targeted)} | ${String(x.kept)} |`,
    ),
  ].join('\n');
}
