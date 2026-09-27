/**
 * `packet:reading --out=<dir> --projects=<id>[,<id>] [--near=<versionId>=<reason>]…` (run 6, STEP 2): the operator's
 * reading packet. Every accepted chapter of the named projects is written with its metrics (the `13-live-run-gemini.md`
 * §19.4 row), and each named near miss (an approved or best version that was not accepted) with what stopped it. It
 * reads rows and artifacts only, calls no model and writes nothing to the database, so it can run beside a live run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusChapters, type Pool } from '@yeonjae/db';
import { loadPolicies, type PolicyRef } from '@yeonjae/domain';
import { chapterMetrics, codePointLength, operatorLikeness, toNfcText } from '@yeonjae/prose';
import { buildRunReport, type ChapterReport, type RoundReport } from '@yeonjae/workflows';
import { operatorBands, statsSource } from './corpus.js';

interface Result {
  ok: boolean;
  output: unknown;
}

export const PACKET_COMMANDS: ReadonlySet<string> = new Set(['packet:reading']);

function flag(args: readonly string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

/** Characters with spaces (line breaks excluded) and without any whitespace, as Korean platforms count. */
export function lengthOf(text: string): { withSpaces: number; noSpaces: number } {
  const nfc = toNfcText(text).text;
  return {
    withSpaces: codePointLength(nfc.replace(/\r?\n/gu, '')),
    noSpaces: codePointLength(nfc.replace(/\s+/gu, '')),
  };
}

/** The first `n` non-empty lines of a text, unedited. */
export function excerptOf(text: string, n = 3): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n);
}

/** The key a project's files are filed under: the first word of its title (G23r, G24a …). */
export function projectKey(title: string): string {
  return (title.split(/\s+/u)[0] ?? 'project').replace(/[^\p{L}\p{N}_-]/gu, '') || 'project';
}

function dims(round: RoundReport | undefined): string {
  if (!round) return 'no scorecard stored';
  const parts = round.dimensions.map(
    (d) =>
      `${d.dimension} ${d.score.toFixed(1)} / ${String(d.threshold)}${d.passed ? '' : ' (below)'}`,
  );
  return `${parts.join(', ')}; overall ${round.overall === undefined ? '?' : round.overall.toFixed(1)}; blocking ${String(round.counts.blocking)} / major ${String(round.counts.major)} / minor ${String(round.counts.minor)}`;
}

function lint(round: RoundReport | undefined): string {
  if (!round) return '—';
  const rules = Object.entries(round.lint).map(([r, v]) => `${r} ×${String(v.count)} (${v.worst})`);
  return rules.length ? rules.join(', ') : 'none';
}

/** A chapter's model calls: the stored rows carry no job, so they are attributed by activity id (`<step>:<n>:…`). */
async function callsFor(
  pool: Pool,
  projectId: string,
  chapterNo: number,
): Promise<{ calls: number; input: number; output: number; seconds: number }> {
  const { rows } = await pool.query<{ calls: string; input: string; output: string; ms: string }>(
    `SELECT count(*)::text AS calls,
            coalesce(sum((c.usage->>'input')::bigint), 0)::text AS input,
            coalesce(sum((c.usage->>'output')::bigint), 0)::text AS output,
            coalesce(sum(c.latency_ms), 0)::text AS ms
       FROM llm_calls c
      WHERE c.project_id = $1 AND split_part(c.activity_id, ':', 2) = $2`,
    [projectId, String(chapterNo)],
  );
  const r = rows[0];
  return {
    calls: Number(r?.calls ?? 0),
    input: Number(r?.input ?? 0),
    output: Number(r?.output ?? 0),
    seconds: Math.round(Number(r?.ms ?? 0) / 1000),
  };
}

async function packetCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const out = flag(args, 'out');
  const projects = (flag(args, 'projects') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const near = args
    .filter((a) => a.startsWith('--near='))
    .map((a) => a.slice('--near='.length))
    .map((a) => ({ versionId: a.split('=')[0] ?? '', reason: a.split('=').slice(1).join('=') }));
  if (!out || (projects.length === 0 && near.length === 0))
    return {
      ok: false,
      output: {
        error: 'USAGE',
        usage: 'packet:reading --out=<dir> --projects=<id>[,<id>] [--near=<versionId>=<reason>]…',
      },
    };
  const source = statsSource('lang/ko@7');
  const bands = operatorBands(await corpusChapters(pool), source);
  const policies = loadPolicies();
  const index: string[] = [
    '| Project | 화 | Policy | Length (자 / without spaces) | Rounds | Scores and gates | Likeness (all / first-person) | Calls / tokens in, out / model time | File |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  let written = 0;
  for (const projectId of projects) {
    const title =
      (await pool.query<{ title: string }>('SELECT title FROM projects WHERE id = $1', [projectId]))
        .rows[0]?.title ?? projectId;
    const key = projectKey(title);
    const report = await buildRunReport(pool, projectId);
    const policy = policies.get(report.policy as PolicyRef);
    const events = await pool.query<{ kind: string; payload: Record<string, unknown>; at: Date }>(
      `SELECT e.kind, e.payload, e.created_at AS at FROM novel_run_events e JOIN novel_runs r ON r.id = e.run_id
        WHERE r.project_id = $1 AND e.kind IN ('chapter.accepted', 'chapter.revision_extended') ORDER BY e.seq`,
      [projectId],
    );
    for (const ch of report.chapters) {
      if (!ch.accepted_version_id) continue;
      const v = await pool.query<{ text: string; version_no: number }>(
        'SELECT text, version_no FROM manuscript_versions WHERE id = $1',
        [ch.accepted_version_id],
      );
      const text = v.rows[0]?.text ?? '';
      const accepted = events.rows.find(
        (e) => e.kind === 'chapter.accepted' && Number(e.payload.chapter_no) === ch.number,
      );
      const grants = events.rows
        .filter(
          (e) =>
            e.kind === 'chapter.revision_extended' && Number(e.payload.chapter_no) === ch.number,
        )
        .reduce((n, e) => n + Number(e.payload.rounds ?? 0), 0);
      const round = approvingRound(ch);
      const len = lengthOf(text);
      const m = chapterMetrics(text, source);
      const likeness = `${String(operatorLikeness(m, bands.all).score)} / ${String(operatorLikeness(m, bands.first).score)}`;
      const calls = await callsFor(pool, projectId, ch.number);
      const acceptedRounds = accepted?.payload.revision_rounds;
      const rounds = `${typeof acceptedRounds === 'number' ? String(acceptedRounds) : '?'}${grants ? ` (after an operator grant of ${String(grants)})` : ' (within the policy cap)'}`;
      const file = join('accepted', key, `ch${String(ch.number).padStart(2, '0')}.md`);
      const callText = `${String(calls.calls)} / ${calls.input.toLocaleString('en-US')}, ${calls.output.toLocaleString('en-US')} / ${String(calls.seconds)} s`;
      mkdirSync(join(out, 'accepted', key), { recursive: true });
      writeFileSync(
        join(out, file),
        [
          `# ${title} — ${String(ch.number)}화 (v${String(v.rows[0]?.version_no ?? '?')})`,
          '',
          'Chapter title: none yet (the title writer is STEP 5.5).',
          '',
          '| | |',
          '| --- | --- |',
          `| Policy | \`${report.policy}\` (${policy?.content_hash ?? 'hash unknown'}) |`,
          `| Accepted | ${accepted ? accepted.at.toISOString() : '?'} |`,
          `| Length | ${len.withSpaces.toLocaleString('en-US')}자, ${len.noSpaces.toLocaleString('en-US')} without spaces |`,
          `| Rounds | ${rounds} |`,
          `| Scores and gates | ${dims(round)} |`,
          `| corpus:likeness | ${likeness} |`,
          `| Lint | ${lint(round)} |`,
          `| Calls / tokens / model time | ${callText} |`,
          '',
          '---',
          '',
          text,
          '',
        ].join('\n'),
      );
      index.push(
        `| ${title} | ${String(ch.number)} | \`${report.policy}\` | ${len.withSpaces.toLocaleString('en-US')} / ${len.noSpaces.toLocaleString('en-US')} | ${rounds} | ${dims(round)} | ${likeness} | ${callText} | [${file}](${file}) |`,
      );
      written += 1;
    }
  }
  const nearRows: string[] = [
    '| Version | Project | 화 | Length | Scores and gates | What stopped it | File |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const n of near) {
    const v = await pool.query<{
      text: string;
      version_no: number;
      project_id: string;
      number: number;
      title: string;
      status: string;
    }>(
      `SELECT v.text, v.version_no, v.project_id, c.number, p.title, v.status::text AS status
         FROM manuscript_versions v JOIN chapters c ON c.id = v.chapter_id JOIN projects p ON p.id = v.project_id
        WHERE v.id = $1`,
      [n.versionId],
    );
    const row = v.rows[0];
    if (!row) continue;
    const report = await buildRunReport(pool, row.project_id);
    const round = report.chapters
      .find((c) => c.number === row.number)
      ?.rounds.filter((r) => r.version_id === n.versionId)
      .at(-1);
    const len = lengthOf(row.text);
    const key = projectKey(row.title);
    const file = join(
      'near-misses',
      `${key}-ch${String(row.number).padStart(2, '0')}-v${String(row.version_no)}.md`,
    );
    mkdirSync(join(out, 'near-misses'), { recursive: true });
    writeFileSync(
      join(out, file),
      [
        `# ${row.title} — ${String(row.number)}화 v${String(row.version_no)} (${row.status}, not accepted)`,
        '',
        `What stopped it: ${n.reason}`,
        '',
        `Scores and gates: ${dims(round)}`,
        '',
        `Length: ${len.withSpaces.toLocaleString('en-US')}자, ${len.noSpaces.toLocaleString('en-US')} without spaces`,
        '',
        '---',
        '',
        row.text,
        '',
      ].join('\n'),
    );
    nearRows.push(
      `| v${String(row.version_no)} | ${row.title} | ${String(row.number)} | ${len.withSpaces.toLocaleString('en-US')} | ${dims(round)} | ${n.reason} | [${file}](${file}) |`,
    );
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'index.md'),
    [
      '# Reading packet index',
      '',
      '## Accepted chapters',
      '',
      ...index,
      '',
      '## Approved or best versions that were not accepted',
      '',
      ...nearRows,
      '',
    ].join('\n'),
  );
  return { ok: true, output: { out, accepted: written, near_misses: nearRows.length - 2 } };
}

/** The round whose version was accepted, else the last evaluated one. */
function approvingRound(ch: ChapterReport): RoundReport | undefined {
  return (
    ch.rounds.filter((r) => r.accepted).at(-1) ?? ch.rounds.filter((r) => !r.quarantined).at(-1)
  );
}

export async function runPacketCommand(
  pool: Pool,
  cmd: string,
  args: readonly string[],
): Promise<Result> {
  if (cmd === 'packet:reading') return packetCmd(pool, args);
  return { ok: false, output: { error: 'UNKNOWN_COMMAND', cmd } };
}
