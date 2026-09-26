/**
 * `quality:checkpoint <project> [--chapter=N] [--out=<dir>] [--label=<name>] [--json]`: the live-checkpoint
 * record of one chapter run, read from the database (reads only; safe beside a live run). It measures what
 * `13-live-run-gemini.md` records per chapter — length, scenes (planned talk → measured talk + 속마음), quoted
 * lines, the plan critic, first lines, per-round gates and blocking/major counts, the revision scopes per round,
 * reader-secret findings, `KO-DEVICE-01`, the corpus copy check, likeness, calls, tokens, wall clock — and,
 * with `--out`, writes the run report, the findings of every scorecard and the metrics JSON there.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusChapters, type Pool } from '@yeonjae/db';
import { buildRunReport, renderRunReport, type RunReport } from '@yeonjae/workflows';
import { chapterMetrics, codePointLength, operatorLikeness, talkShareOf } from '@yeonjae/prose';
import { operatorBands, statsSource } from './corpus.js';

export const CHECKPOINT_COMMANDS = new Set(['quality:checkpoint']);

interface Result {
  readonly ok: boolean;
  readonly output: unknown;
}

export interface IssueLike {
  readonly kind?: string;
  readonly severity?: string;
  readonly status?: string;
  readonly dimension?: string;
  readonly source?: string;
  readonly claim?: string;
  readonly confidence?: number;
  readonly metric?: { readonly rule_id?: string } | null;
  readonly chapter_span?: { readonly quote?: string } | null;
}

export interface TextShape {
  readonly chars: number;
  readonly chars_no_spaces: number;
  readonly quoted_dialogue_lines: number;
  readonly quoted_inner_lines: number;
  readonly talk_share: number;
  readonly first_lines: readonly string[];
}

/** 자 as the run report counts it (with spaces, without line breaks) and without any whitespace. */
export function textShape(text: string): TextShape {
  const noBreaks = text.replace(/\r?\n/gu, '');
  const chars = codePointLength(noBreaks);
  const lines = text
    .split(/\n/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return {
    chars,
    chars_no_spaces: codePointLength(text.replace(/\s/gu, '')),
    quoted_dialogue_lines: lines.filter((l) => /^[“"]/u.test(l)).length,
    quoted_inner_lines: lines.filter((l) => l.startsWith('‘')).length,
    talk_share: talkShareOf(noBreaks, chars),
    first_lines: lines.slice(0, 3),
  };
}

const READER_SECRET_KINDS = new Set(['reader_knowledge_violation', 'knowledge_leak']);

export interface RoundExtras {
  readonly blocking: number;
  readonly major: number;
  readonly reader_secret: { readonly blocking: number; readonly major: number };
  readonly ko_device: number;
  readonly corpus_copy: number;
}

/** Per scorecard: the counts the checkpoint table reports beside the run report's own. */
export function roundExtras(issues: readonly IssueLike[]): RoundExtras {
  let blocking = 0;
  let major = 0;
  let rsB = 0;
  let rsM = 0;
  let device = 0;
  let copy = 0;
  for (const i of issues) {
    if (i.severity === 'blocking') blocking += 1;
    if (i.severity === 'major') major += 1;
    if (READER_SECRET_KINDS.has(i.kind ?? '')) {
      if (i.severity === 'blocking') rsB += 1;
      if (i.severity === 'major') rsM += 1;
    }
    if (i.metric?.rule_id === 'KO-DEVICE-01') device += 1;
    if (i.kind === 'corpus_copy') copy += 1;
  }
  return {
    blocking,
    major,
    reader_secret: { blocking: rsB, major: rsM },
    ko_device: device,
    corpus_copy: copy,
  };
}

export interface FindingsCard {
  readonly label: string;
  readonly overall: unknown;
  readonly sections: Readonly<Record<string, unknown>>;
  readonly issues: readonly IssueLike[];
}

/** The findings export: every scorecard in order, its sections, and its blocking/major findings. */
export function renderFindings(cards: readonly FindingsCard[]): string {
  const out: string[] = [];
  for (const c of cards) {
    out.push(`=== scorecard ${c.label} overall=${JSON.stringify(c.overall)}`);
    for (const [name, s] of Object.entries(c.sections)) {
      const sec = s as { score?: number; passed?: boolean; issue_ids?: unknown[] };
      out.push(
        `  section ${name}: score=${String(sec.score)} passed=${String(sec.passed)} issues=${String(sec.issue_ids?.length ?? 0)}`,
      );
    }
    for (const i of c.issues) {
      if (i.severity !== 'blocking' && i.severity !== 'major') continue;
      out.push(
        `  [${i.severity}/${i.status ?? '?'}] ${i.dimension ?? '?'} ${i.kind ?? '?'} (${i.source ?? '?'}, confidence ${String(i.confidence ?? '?')})`,
      );
      out.push(`      claim: ${(i.claim ?? '').replace(/\s+/gu, ' ')}`);
      const q = i.chapter_span?.quote?.replace(/\s+/gu, ' ');
      if (q) out.push(`      quote: ${q}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function runCheckpointCommand(
  pool: Pool,
  _cmd: string,
  args: readonly string[],
): Promise<Result> {
  const [projectId] = args;
  if (!projectId || projectId.startsWith('--'))
    return {
      ok: false,
      output: {
        error: 'USAGE',
        usage: 'quality:checkpoint <project> [--chapter=N] [--out=<dir>] [--label=<name>] [--json]',
      },
    };
  const chapterNo = Number(flag(args, 'chapter') ?? '1');
  const report: RunReport = await buildRunReport(pool, projectId);
  const project = await pool.query<{ title: string; settings: Record<string, unknown> }>(
    'SELECT title, settings FROM projects WHERE id = $1',
    [projectId],
  );
  const versions = await pool.query<{ version_no: number; status: string; text: string }>(
    `SELECT v.version_no, v.status, v.text
       FROM (SELECT chapter_id, version_no, status::text AS status, text FROM manuscript_versions WHERE project_id = $1
             UNION ALL SELECT chapter_id, version_no, 'quarantined', text FROM quarantine_versions WHERE project_id = $1) v
       JOIN chapters c ON c.id = v.chapter_id
      WHERE c.number = $2
      ORDER BY v.version_no`,
    [projectId, chapterNo],
  );
  const artifacts = await pool.query<{
    kind: string;
    key: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT kind, key, payload FROM workflow_artifacts
      WHERE project_id = $1 AND kind IN ('scorecard', 'scene_plan', 'scene_draft', 'patch', 'chapter_contract')
      ORDER BY created_at`,
    [projectId],
  );
  const chapterReport = report.chapters.find((c) => c.number === chapterNo);
  const roundsIn = chapterReport?.rounds ?? [];
  const cardOf = (versionId: string) =>
    artifacts.rows.find(
      (a) => a.kind === 'scorecard' && String(a.payload.manuscript_version_id) === versionId,
    );
  const plan = artifacts.rows
    .filter((a) => a.kind === 'scene_plan' && Number(a.payload.chapter_no) === chapterNo)
    .at(-1);
  const drafts = new Map<number, string>();
  for (const a of artifacts.rows)
    if (a.kind === 'scene_draft' && a.key.startsWith(`${String(chapterNo)}:`))
      drafts.set(
        Number(a.payload.scene_no),
        typeof a.payload.text === 'string' ? a.payload.text : '',
      );
  const scopesByRound = new Map<number, string[]>();
  for (const a of artifacts.rows) {
    if (a.kind !== 'patch') continue;
    const m = /:r(\d+)$/u.exec(a.key);
    if (!m) continue;
    const round = Number(m[1]);
    scopesByRound.set(round, [
      ...(scopesByRound.get(round) ?? []),
      typeof a.payload.scope === 'string' ? a.payload.scope : '?',
    ]);
  }
  const source = statsSource('lang/ko@7');
  const bands = operatorBands(await corpusChapters(pool), source);
  const likeness = versions.rows.map((v) => {
    const m = chapterMetrics(v.text, source);
    return {
      version_no: v.version_no,
      status: v.status,
      score: operatorLikeness(m, bands.all).score,
      first_person: operatorLikeness(m, bands.first).score,
    };
  });
  const v1 = versions.rows.find((v) => v.version_no === 1);
  const last = versions.rows.at(-1);
  const contract = artifacts.rows
    .filter((a) => a.kind === 'chapter_contract' && Number(a.payload.chapter_number) === chapterNo)
    .at(-1);
  const lengthTarget = contract?.payload.length_target as { value?: number } | undefined;
  const target =
    Number(lengthTarget?.value ?? project.rows[0]?.settings.target_characters_per_chapter ?? 0) ||
    undefined;
  const v1Shape = v1 ? textShape(v1.text) : undefined;
  const scenes = ((plan?.payload.scenes as Record<string, unknown>[] | undefined) ?? []).map(
    (s) => {
      const no = Number(s.scene_no);
      const text = drafts.get(no);
      const shape = text ? textShape(text) : undefined;
      return {
        scene_no: no,
        planned_share: s.dialogue_density_target ?? null,
        measured_share: shape?.talk_share ?? null,
        chars: shape?.chars ?? null,
      };
    },
  );
  const rounds = roundsIn.map((r, n) => {
    const issues = (cardOf(r.version_id)?.payload.issues as IssueLike[] | undefined) ?? [];
    return {
      round: n,
      version_no: r.version_no,
      quarantined: r.quarantined,
      gate: r.gate_outcome,
      overall: r.overall,
      dimensions: Object.fromEntries(
        r.dimensions.map((d) => [d.dimension, { score: d.score, passed: d.passed }]),
      ),
      scopes: scopesByRound.get(n) ?? [],
      ...roundExtras(issues),
    };
  });
  const metrics = {
    project_id: projectId,
    title: project.rows[0]?.title,
    policy: report.policy,
    lineage: report.lineage,
    run: report.run,
    chapter: chapterNo,
    chapter_status: chapterReport?.status,
    accepted: Boolean(chapterReport?.accepted_version_id),
    target_characters: target,
    v1: v1Shape
      ? {
          ...v1Shape,
          deviation_pct: target
            ? Math.round(((v1Shape.chars - target) / target) * 1000) / 10
            : undefined,
          dialogue_lines_per_1k:
            Math.round((v1Shape.quoted_dialogue_lines / Math.max(1, v1Shape.chars)) * 10000) / 10,
        }
      : undefined,
    last_version: last
      ? { version_no: last.version_no, status: last.status, ...textShape(last.text) }
      : undefined,
    scenes,
    plan_critic: plan?.payload.plan_critic ?? null,
    plan_findings: plan?.payload.plan_findings ?? null,
    rounds,
    likeness,
    totals: report.totals,
    wall_clock: report.wall_clock,
  };
  const out = flag(args, 'out');
  if (out) {
    const label = flag(args, 'label') ?? projectId;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${label}-run-report.md`), renderRunReport(report));
    writeFileSync(
      join(out, `${label}-findings.txt`),
      renderFindings(
        roundsIn.map((r, n) => {
          const card = cardOf(r.version_id)?.payload ?? {};
          return {
            label: `r${String(n)} v${String(r.version_no ?? '?')}${r.quarantined ? ' (quarantined)' : ''}`,
            overall: card.overall,
            sections: (card.sections as Record<string, unknown> | undefined) ?? {},
            issues: (card.issues as IssueLike[] | undefined) ?? [],
          };
        }),
      ),
    );
    writeFileSync(join(out, `${label}-checkpoint.json`), `${JSON.stringify(metrics, null, 2)}\n`);
  }
  return { ok: true, output: args.includes('--json') || !out ? metrics : { written: out } };
}
