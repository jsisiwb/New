/**
 * Operator corpus commands (ADR-0082):
 *
 *   corpus:import <dir|git-url> [--source=<label>]   EPUBs + Manifest.csv → corpus.books / corpus.chapters
 *   corpus:list [--json]                             imported books, language, POV, tags, chapter counts
 *   corpus:stats [--json] [--out=<file.md>]          C1 statistics as percentiles, per book, POV and position
 *
 * The import is idempotent (a book is keyed by its file's SHA-256) and resumable (each book commits alone).
 * Once imported, nothing reads the files again: the corpus lives in the permanent database.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  corpusChapters,
  importCorpusBook,
  listCorpusBooks,
  type CorpusChapterRow,
  type Pool,
} from '@yeonjae/db';
import { ProfileStore } from '@yeonjae/narrative';
import {
  chapterMetrics,
  distributions,
  METRIC_KEYS,
  parseManifest,
  readCorpusBook,
  storeIdOf,
  titleKey,
  type ChapterMetrics,
  type Distribution,
  type KoStyleSource,
  type MetricKey,
} from '@yeonjae/prose';

export const CORPUS_COMMANDS = new Set(['corpus:import', 'corpus:list', 'corpus:stats']);
export const CORPUS_IMPORT_VERSION = 'corpus-import@1';

interface Result {
  readonly ok: boolean;
  readonly output: unknown;
}

const flag = (args: readonly string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function sourceDir(arg: string): { dir: string; repo: string } {
  if (/^https?:\/\//.test(arg) || arg.endsWith('.git')) {
    const dir = mkdtempSync(join(tmpdir(), 'yeonjae-corpus-'));
    execFileSync('git', ['clone', '--quiet', '--depth', '1', arg, dir], { stdio: 'ignore' });
    return { dir, repo: arg.replace(/\.git$/, '') };
  }
  return { dir: arg, repo: arg };
}

/** The lint source the statistics are measured with: the Korean language layer's own lists. */
export function statsSource(layer = 'lang/ko@6'): KoStyleSource {
  const ol = ProfileStore.fromDirectory().get(layer).output_language;
  if (!ol) throw new Error(`${layer} has no output_language block`);
  return {
    translationMarkers: ol.translation_markers,
    forbiddenPatterns: ol.forbidden_patterns,
    thresholds: ol.lint_thresholds,
    calquePhrases: ol.calque_phrases,
  };
}

async function importCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const [target] = args;
  if (!target)
    return { ok: false, output: { error: 'USAGE', usage: 'corpus:import <dir|git-url>' } };
  const { dir, repo } = sourceDir(target);
  const label = flag(args, 'source') ?? repo;
  const manifestPath = join(dir, 'Manifest.csv');
  const manifest = existsSync(manifestPath)
    ? parseManifest(readFileSync(manifestPath, 'utf8'))
    : [];
  const byKey = new Map(manifest.map((m) => [titleKey(m.title), m]));
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.epub'))
    .sort();
  const results: unknown[] = [];
  for (const file of files) {
    const buf = readFileSync(join(dir, file));
    const sha = createHash('sha256').update(buf).digest('hex');
    const book = readCorpusBook(buf, file);
    const entry = byKey.get(book.title_key) ?? byKey.get(titleKey(file));
    const res = await importCorpusBook(
      pool,
      {
        source_repo: label,
        source_file: file,
        source_sha256: sha,
        store_id: storeIdOf(file),
        title: book.title,
        title_key: book.title_key,
        author: book.author,
        status: book.status,
        synopsis: book.synopsis,
        tags: entry?.tags ?? book.subjects,
        manifest_title: entry?.title,
        text_language: book.text_language,
        is_translation: book.is_translation,
        voice_eligible: book.voice_eligible,
        pov: book.pov,
        pov_evidence: { ...book.pov_evidence },
        import_version: CORPUS_IMPORT_VERSION,
      },
      book.chapters.map((c) => ({
        ...c,
        content_sha256: createHash('sha256').update(c.text).digest('hex'),
      })),
    );
    const main = book.chapters.filter((c) => c.kind === 'chapter' || c.kind === 'prologue');
    results.push({
      file,
      created: res.created,
      book_id: res.book_id,
      title: book.title,
      manifest_match: entry !== undefined,
      tags: entry?.tags ?? book.subjects,
      text_language: book.text_language,
      is_translation: book.is_translation,
      voice_eligible: book.voice_eligible,
      pov: book.pov,
      main_chapters: main.length,
      side_chapters: book.chapters.filter((c) => c.kind === 'side' || c.kind === 'epilogue').length,
      notices: book.chapters.filter((c) => c.kind === 'notice').length,
    });
  }
  const unmatched = manifest
    .filter(
      (m) =>
        !results.some(
          (r) =>
            (r as { manifest_match: boolean; title: string }).manifest_match &&
            titleKey((r as { title: string }).title) === titleKey(m.title),
        ),
    )
    .map((m) => m.title);
  return { ok: true, output: { source: label, books: results, manifest_unmatched: unmatched } };
}

export interface CorpusStatsReport {
  readonly layer: string;
  readonly groups: readonly {
    readonly label: string;
    readonly chapters: number;
    readonly metrics: Readonly<Record<MetricKey, Distribution>>;
  }[];
}

export function statsReport(
  rows: readonly CorpusChapterRow[],
  source: KoStyleSource,
): CorpusStatsReport {
  const measured: { row: CorpusChapterRow; m: ChapterMetrics }[] = rows.map((row) => ({
    row,
    m: chapterMetrics(row.text, source),
  }));
  const group = (label: string, pick: (r: CorpusChapterRow) => boolean) => {
    const sel = measured.filter((x) => pick(x.row)).map((x) => x.m);
    return { label, chapters: sel.length, metrics: distributions(sel) };
  };
  const books = [...new Set(rows.map((r) => r.book_title))];
  const groups = [
    group('all Korean chapters', () => true),
    group('화 1–25 (all books)', (r) => (r.position ?? 0) <= 25),
    group('화 26+ (all books)', (r) => (r.position ?? 0) > 25),
    group('first-person chapters', (r) => r.pov === 'first'),
    group('mixed-POV chapters', (r) => r.pov === 'mixed'),
    group('third-person chapters', (r) => r.pov === 'third'),
    group('first-person 화 1–25', (r) => r.pov === 'first' && (r.position ?? 0) <= 25),
    ...books.flatMap((b) => [
      group(`${b} — 화 1–25`, (r) => r.book_title === b && (r.position ?? 0) <= 25),
      group(`${b} — 화 26+`, (r) => r.book_title === b && (r.position ?? 0) > 25),
    ]),
  ];
  return { layer: 'lang/ko@6', groups: groups.filter((g) => g.chapters > 0) };
}

export function renderStatsMarkdown(r: CorpusStatsReport): string {
  const out: string[] = [];
  for (const g of r.groups) {
    out.push(`### ${g.label} (n = ${String(g.chapters)})`, '');
    out.push('| metric | p2 | p10 | p50 | p90 | p98 |', '| --- | --- | --- | --- | --- | --- |');
    for (const k of METRIC_KEYS) {
      const d = g.metrics[k];
      out.push(
        `| ${k} | ${String(d.p2)} | ${String(d.p10)} | ${String(d.p50)} | ${String(d.p90)} | ${String(d.p98)} |`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

export async function runCorpusCommand(
  pool: Pool,
  cmd: string,
  args: readonly string[],
): Promise<Result> {
  if (cmd === 'corpus:import') return importCmd(pool, args);
  if (cmd === 'corpus:list') {
    const books = await listCorpusBooks(pool);
    const rows = books.map((b) => ({
      title: b.title,
      store_id: b.store_id,
      tags: b.tags,
      text_language: b.text_language,
      is_translation: b.is_translation,
      voice_eligible: b.voice_eligible,
      pov: b.pov,
      pov_inferred: true,
      chapters: b.chapter_count,
      source_file: b.source_file,
    }));
    return { ok: true, output: rows };
  }
  if (cmd === 'corpus:stats') {
    const rows = await corpusChapters(pool);
    const report = statsReport(rows, statsSource());
    const out = flag(args, 'out');
    if (out) writeFileSync(out, renderStatsMarkdown(report));
    return { ok: true, output: args.includes('--json') ? report : renderStatsMarkdown(report) };
  }
  return { ok: false, output: { error: 'UNKNOWN_COMMAND', cmd } };
}
