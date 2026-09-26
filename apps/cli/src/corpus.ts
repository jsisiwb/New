/**
 * Operator corpus commands (ADR-0082):
 *
 *   corpus:import <dir|git-url> [--source=<label>]   EPUBs + Manifest.csv → corpus.books / corpus.chapters
 *   corpus:list [--json]                             imported books, language, POV, tags, chapter counts
 *   corpus:stats [--json] [--out=<file.md>]          C1 statistics as percentiles, per book, POV and position
 *   corpus:calibrate [--layer=] [--json] [--out=]    C4 lint calibration: each rule's value on every chapter
 *   corpus:passages [--dry-run]                      C5 exemplar passages by scene function → corpus.passages
 *   corpus:likeness (--project=<id>|--file=<path>)   C8 share of style metrics inside the operator's band
 *   corpus:stock-phrases [--n=] [--min-drafts=]      C7 phrases the pipeline repeats and the operator never uses
 *
 * The import is idempotent (a book is keyed by its file's SHA-256) and resumable (each book commits alone).
 * Once imported, nothing reads the files again: the corpus lives in the permanent database.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptedChapter,
  corpusChapters,
  corpusPassages,
  importCorpusBook,
  insertCorpusPassages,
  listCorpusBooks,
  pinnedIdentityDocument,
  type CorpusChapterRow,
  type Pool,
} from '@yeonjae/db';
import {
  buildBlindPacket,
  decodeKey,
  encodeKey,
  pickOperatorMatches,
  type OperatorChapter,
  type PacketSource,
} from '@yeonjae/workflows';
import { ProfileStore } from '@yeonjae/narrative';
import {
  chapterMetrics,
  distributions,
  distributionOf,
  lintKoreanWebnovel,
  METRIC_KEYS,
  operatorLikeness,
  PASSAGE_TAGGER,
  paragraphPerLine,
  percentile,
  stockPhraseCandidates,
  tagPassages,
  parseManifest,
  readCorpusBook,
  storeIdOf,
  titleKey,
  type ChapterMetrics,
  type Distribution,
  type KoStyleSource,
  type MetricKey,
} from '@yeonjae/prose';

export const CORPUS_COMMANDS = new Set([
  'corpus:import',
  'corpus:list',
  'corpus:stats',
  'corpus:calibrate',
  'corpus:passages',
  'corpus:likeness',
  'corpus:stock-phrases',
  'corpus:blind-packet',
  'corpus:reveal',
  'corpus:verify',
]);
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

/**
 * `corpus:verify <dir|git-url> [--json]` (STEP 4.1): re-read every EPUB with the importer's own parser, write nothing,
 * and compare it with the database copy — the book by its file's SHA-256, then every chapter by spine index (kind,
 * title, 자 with and without spaces, content SHA-256). `complete` is true only when every file's book and every
 * chapter match, so the source files can be retired once it holds.
 *
 * `corpus:verify --database [--json]` (run 3) needs no source files: every stored chapter is measured again from its own
 * stored text, and each book's chapter count is checked. The source repository is needed only when this reports a
 * mismatch.
 */
async function verifyCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const [target] = args;
  if (target === '--database') return verifyDatabaseCmd(pool);
  if (!target || target.startsWith('--'))
    return {
      ok: false,
      output: { error: 'USAGE', usage: 'corpus:verify <dir|git-url> | --database [--json]' },
    };
  const { dir } = sourceDir(target);
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.epub'))
    .sort();
  const books: Record<string, unknown>[] = [];
  let complete = true;
  const seen = new Set<string>();
  for (const file of files) {
    const buf = readFileSync(join(dir, file));
    const sha = createHash('sha256').update(buf).digest('hex');
    const parsed = readCorpusBook(buf, file);
    const db = await pool.query<{ id: string; title: string; chapter_count: number }>(
      'SELECT id, title, chapter_count FROM corpus.books WHERE source_sha256 = $1',
      [sha],
    );
    const row = db.rows[0];
    if (!row) {
      complete = false;
      books.push({ file, sha256: sha, in_database: false });
      continue;
    }
    seen.add(row.id);
    const stored = await pool.query<{
      spine_index: number;
      kind: string;
      title: string;
      chars_with_spaces: number;
      chars_without_spaces: number;
      content_sha256: string;
    }>(
      `SELECT spine_index, kind, title, chars_with_spaces, chars_without_spaces, content_sha256
         FROM corpus.chapters WHERE book_id = $1 ORDER BY spine_index`,
      [row.id],
    );
    const bySpine = new Map(stored.rows.map((r) => [r.spine_index, r]));
    const mismatches: Record<string, unknown>[] = [];
    let chars = 0;
    for (const c of parsed.chapters) {
      const r = bySpine.get(c.spine_index);
      const hash = createHash('sha256').update(c.text).digest('hex');
      chars += c.chars_with_spaces;
      const fields = r
        ? (['kind', 'title', 'chars_with_spaces', 'chars_without_spaces'] as const).filter(
            (k) => r[k] !== c[k],
          )
        : ['missing'];
      if (r && r.content_sha256 !== hash) fields.push('content_sha256');
      if (fields.length) mismatches.push({ spine_index: c.spine_index, fields });
    }
    const extra = stored.rows.filter(
      (r) => !parsed.chapters.some((c) => c.spine_index === r.spine_index),
    ).length;
    const ok =
      mismatches.length === 0 && extra === 0 && stored.rows.length === parsed.chapters.length;
    if (!ok) complete = false;
    books.push({
      file,
      sha256: sha,
      in_database: true,
      title: row.title,
      chapters_file: parsed.chapters.length,
      chapters_database: stored.rows.length,
      main_chapters: parsed.chapters.filter((c) => c.kind === 'chapter' || c.kind === 'prologue')
        .length,
      chars_with_spaces: chars,
      voice_eligible: parsed.voice_eligible,
      is_translation: parsed.is_translation,
      mismatches: mismatches.slice(0, 20),
      mismatch_count: mismatches.length,
      extra_in_database: extra,
      matches: ok,
    });
  }
  const others = await pool.query<{ id: string; title: string }>(
    'SELECT id, title FROM corpus.books ORDER BY imported_at',
  );
  const notInSource = others.rows.filter((b) => !seen.has(b.id)).map((b) => b.title);
  return { ok: true, output: { source: target, complete, books, database_only: notInSource } };
}

export interface StoredCorpusChapter {
  readonly text: string;
  readonly chars_with_spaces: number;
  readonly chars_without_spaces: number;
  readonly paragraph_count: number;
  readonly content_sha256: string;
}

/** The stored measures of a chapter that its own stored text does not reproduce, measured as the importer measures. */
export function storedChapterMismatches(c: StoredCorpusChapter): string[] {
  const found: Record<keyof Omit<StoredCorpusChapter, 'text'>, string | number> = {
    chars_with_spaces: c.text.replace(/\n/g, '').length,
    chars_without_spaces: c.text.replace(/\s/g, '').length,
    paragraph_count: c.text.split('\n').filter((l) => l.trim() !== '').length,
    content_sha256: createHash('sha256').update(c.text).digest('hex'),
  };
  return (Object.keys(found) as (keyof typeof found)[]).filter((k) => found[k] !== c[k]);
}

async function verifyDatabaseCmd(pool: Pool): Promise<Result> {
  const books = await pool.query<{
    id: string;
    title: string;
    chapter_count: number;
    voice_eligible: boolean;
    is_translation: boolean;
  }>(
    'SELECT id, title, chapter_count, voice_eligible, is_translation FROM corpus.books ORDER BY imported_at',
  );
  let complete = books.rows.length > 0;
  const out: Record<string, unknown>[] = [];
  const totals = { books: books.rows.length, spine_chapters: 0, main_chapters: 0, korean_main: 0 };
  for (const b of books.rows) {
    const rows = await pool.query<StoredCorpusChapter & { spine_index: number; kind: string }>(
      `SELECT spine_index, kind, text, chars_with_spaces, chars_without_spaces, paragraph_count, content_sha256
         FROM corpus.chapters WHERE book_id = $1 ORDER BY spine_index`,
      [b.id],
    );
    const mismatches = rows.rows
      .map((r) => ({ spine_index: r.spine_index, fields: storedChapterMismatches(r) }))
      .filter((m) => m.fields.length > 0);
    const main = rows.rows.filter((r) => r.kind === 'chapter' || r.kind === 'prologue').length;
    const ok = mismatches.length === 0 && rows.rows.length === b.chapter_count;
    if (!ok) complete = false;
    totals.spine_chapters += rows.rows.length;
    totals.main_chapters += main;
    if (b.voice_eligible && !b.is_translation) totals.korean_main += main;
    out.push({
      title: b.title,
      chapters_database: rows.rows.length,
      chapter_count: b.chapter_count,
      main_chapters: main,
      chars_with_spaces: rows.rows.reduce((n, r) => n + r.chars_with_spaces, 0),
      voice_eligible: b.voice_eligible,
      is_translation: b.is_translation,
      mismatches: mismatches.slice(0, 20),
      mismatch_count: mismatches.length,
      matches: ok,
    });
  }
  return { ok: true, output: { source: 'database', complete, totals, books: out } };
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

/**
 * Lint rules whose value is a property of the text alone, so the operator's chapters can calibrate them
 * (C4, ADR-0083). `inverted`: a low value is the failure (dialogue share). Rules that depend on the project
 * (names, point of view, exemplars) are not calibrated here.
 */
export const CALIBRATED_RULES: readonly { readonly id: string; readonly inverted?: boolean }[] = [
  { id: 'KO-TRN-RATE' },
  { id: 'KO-AIT-COUNT' },
  { id: 'KO-PRN-RATE' },
  { id: 'KO-SIM-RATE' },
  { id: 'KO-CONJ-RATE' },
  { id: 'KO-PARA-LONG' },
  { id: 'KO-PARA-CHARS' },
  { id: 'KO-END-02' },
  { id: 'KO-OVR-01' },
  { id: 'KO-OVR-02' },
  { id: 'KO-OVR-03' },
  { id: 'KO-OVR-04' },
  { id: 'KO-COMMA-RATE' },
  { id: 'KO-SENT-LONG' },
  { id: 'KO-DLG-SHARE', inverted: true },
  { id: 'KO-PUNCT-ELL' },
  { id: 'KO-PUNCT-DASH' },
  { id: 'KO-IDIOM-01' },
  { id: 'KO-ORDER-01' },
];

export interface RuleCalibration {
  readonly id: string;
  readonly inverted: boolean;
  readonly current?: { readonly warn: number; readonly fail: number } | undefined;
  readonly all: Distribution;
  readonly first_person: Distribution;
  /** The far tail of all Korean chapters: p99.5 (inverted: p0.5). */
  readonly tail: number;
  readonly first_person_tail: number;
  /**
   * ADR-0083: warn at p90 and fail at p99.5 of all Korean chapters (inverted: p10 / p0.5), so about one
   * operator chapter in two hundred fails a rule on its own.
   */
  readonly proposed: { readonly warn: number; readonly fail: number };
}

/** Each calibrated rule's value on every chapter: the lint run with thresholds every value crosses. */
export function calibrationReport(
  rows: readonly CorpusChapterRow[],
  source: KoStyleSource,
): RuleCalibration[] {
  const zero: Record<string, { warn: number; fail: number } | undefined> = {
    ...(source.thresholds ?? {}),
  };
  // KO-PARA-CHARS keeps the layer's value: its warn length defines what KO-PARA-LONG counts as long.
  for (const r of CALIBRATED_RULES)
    if (r.id !== 'KO-PARA-CHARS')
      zero[r.id] = r.inverted ? { warn: 2, fail: -1 } : { warn: 0, fail: 1e9 };
  const values = new Map<string, { all: number[]; first: number[] }>();
  for (const r of CALIBRATED_RULES) values.set(r.id, { all: [], first: [] });
  for (const row of rows) {
    const text = paragraphPerLine(row.text);
    const report = lintKoreanWebnovel(text, { ...source, thresholds: zero });
    const perRule = new Map<string, number>();
    for (const f of report.findings)
      if (f.value !== undefined && values.has(f.rule_id))
        perRule.set(f.rule_id, Math.max(perRule.get(f.rule_id) ?? -Infinity, f.value));
    // Dialogue share counts straight quotes too (defect C-1); the longest paragraph is the metric itself.
    const metrics = chapterMetrics(row.text, source);
    perRule.set('KO-DLG-SHARE', metrics.talk_share);
    perRule.set('KO-PARA-CHARS', metrics.max_paragraph_chars);
    for (const r of CALIBRATED_RULES) {
      const v = perRule.get(r.id) ?? 0;
      const slot = values.get(r.id);
      slot?.all.push(v);
      if (row.pov === 'first') slot?.first.push(v);
    }
  }
  return CALIBRATED_RULES.map((r) => {
    const v = values.get(r.id) ?? { all: [], first: [] };
    const all = distributionOf(v.all);
    const sortedAll = [...v.all].sort((a, b) => a - b);
    const sortedFirst = [...v.first].sort((a, b) => a - b);
    const q = r.inverted ? 0.5 : 99.5;
    const tail = Math.round(percentile(sortedAll, q) * 1000) / 1000;
    return {
      id: r.id,
      inverted: r.inverted ?? false,
      current: source.thresholds?.[r.id],
      all,
      first_person: distributionOf(v.first),
      tail,
      first_person_tail: Math.round(percentile(sortedFirst, q) * 1000) / 1000,
      proposed: r.inverted ? { warn: all.p10, fail: tail } : { warn: all.p90, fail: tail },
    };
  });
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
  if (cmd === 'corpus:calibrate') {
    const rows = await corpusChapters(pool);
    const report = calibrationReport(rows, statsSource(flag(args, 'layer') ?? 'lang/ko@6'));
    const table = [
      '| rule | current warn / fail | all p2 / p10 / p50 / p90 / p98 / tail | first-person p2 / p10 / p50 / p90 / p98 / tail | proposed warn / fail |',
      '| --- | --- | --- | --- | --- |',
      ...report.map((r) => {
        const d = (x: Distribution, tail: number) =>
          `${String(x.p2)} / ${String(x.p10)} / ${String(x.p50)} / ${String(x.p90)} / ${String(x.p98)} / ${String(tail)}`;
        const cur = r.current ? `${String(r.current.warn)} / ${String(r.current.fail)}` : '—';
        return `| ${r.id}${r.inverted ? ' (low fails)' : ''} | ${cur} | ${d(r.all, r.tail)} | ${d(r.first_person, r.first_person_tail)} | ${String(r.proposed.warn)} / ${String(r.proposed.fail)} |`;
      }),
    ].join('\n');
    const out = flag(args, 'out');
    if (out) writeFileSync(out, table);
    return { ok: true, output: args.includes('--json') ? report : table };
  }
  if (cmd === 'corpus:passages') return passagesCmd(pool, args);
  if (cmd === 'corpus:likeness') return likenessCmd(pool, args);
  if (cmd === 'corpus:stock-phrases') return stockPhrasesCmd(pool, args);
  if (cmd === 'corpus:blind-packet') return blindPacketCmd(pool, args);
  if (cmd === 'corpus:reveal') return revealCmd(args);
  if (cmd === 'corpus:verify') return verifyCmd(pool, args);
  return { ok: false, output: { error: 'UNKNOWN_COMMAND', cmd } };
}

/** C5: tag every voice-eligible main-story chapter and store the passages (idempotent per tagger). */
async function passagesCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const rows = await corpusChapters(pool);
  const passages = rows.flatMap((row) =>
    tagPassages(row.text, { position: row.position }).map((p) => ({
      chapter_id: row.id,
      start_cp: p.start_cp,
      end_cp: p.end_cp,
      text: p.text,
      scene_type: p.scene_type,
      tagger: PASSAGE_TAGGER,
      features: { ...p.features, pov: row.pov, position: row.position },
    })),
  );
  const byType: Record<string, number> = {};
  for (const p of passages) byType[p.scene_type] = (byType[p.scene_type] ?? 0) + 1;
  if (args.includes('--dry-run'))
    return {
      ok: true,
      output: { tagger: PASSAGE_TAGGER, chapters: rows.length, candidates: byType },
    };
  const { inserted } = await insertCorpusPassages(pool, passages);
  const stored = await corpusPassages(pool, { tagger: PASSAGE_TAGGER });
  return {
    ok: true,
    output: {
      tagger: PASSAGE_TAGGER,
      chapters: rows.length,
      candidates: byType,
      inserted,
      stored: stored.length,
    },
  };
}

/** The operator's style bands (all Korean chapters and first-person ones) and their own likeness scores. */
export function operatorBands(rows: readonly CorpusChapterRow[], source: KoStyleSource) {
  const metrics = rows.map((r) => ({ pov: r.pov, m: chapterMetrics(r.text, source) }));
  const all = distributions(metrics.map((x) => x.m));
  const first = distributions(metrics.filter((x) => x.pov === 'first').map((x) => x.m));
  const own = distributionOf(metrics.map((x) => operatorLikeness(x.m, all).score));
  return { all, first, own };
}

/** C8: the share of a chapter's style metrics inside the operator's p10–p90 band, beside the operator's own. */
async function likenessCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const project = flag(args, 'project');
  const file = flag(args, 'file');
  if (!project && !file)
    return {
      ok: false,
      output: { error: 'USAGE', usage: 'corpus:likeness (--project=<id>|--file=<path>)' },
    };
  const source = statsSource(flag(args, 'layer') ?? 'lang/ko@7');
  const bands = operatorBands(await corpusChapters(pool), source);
  const texts: { label: string; text: string }[] = [];
  if (file) texts.push({ label: file, text: readFileSync(file, 'utf8') });
  if (project) {
    const { rows } = await pool.query<{
      chapter: number;
      version_no: number;
      status: string;
      text: string;
    }>(
      `SELECT c.number AS chapter, v.version_no, v.status, v.text
         FROM (SELECT chapter_id, version_no, status::text AS status, text FROM manuscript_versions WHERE project_id = $1
               UNION ALL SELECT chapter_id, version_no, 'quarantined', text FROM quarantine_versions WHERE project_id = $1) v
         JOIN chapters c ON c.id = v.chapter_id
        ORDER BY c.number, v.version_no`,
      [project],
    );
    for (const r of rows)
      texts.push({
        label: `화 ${String(r.chapter)} v${String(r.version_no)} (${r.status})`,
        text: r.text,
      });
  }
  const scored = texts.map((t) => {
    const m = chapterMetrics(t.text, source);
    const all = operatorLikeness(m, bands.all);
    const first = operatorLikeness(m, bands.first);
    return {
      label: t.label,
      score: all.score,
      first_person_score: first.score,
      outside: all.outside,
    };
  });
  const out = { operator_own_scores: bands.own, versions: scored };
  if (args.includes('--json')) return { ok: true, output: out };
  const lines = [
    `operator chapters (own bands): p10 ${String(bands.own.p10)} / p50 ${String(bands.own.p50)} / p90 ${String(bands.own.p90)}`,
    ...scored.map(
      (s) =>
        `${s.label}: ${String(s.score)} (first-person bands ${String(s.first_person_score)}) — outside: ${s.outside
          .map((o) => `${o.key} ${String(o.value)} [${String(o.p10)}–${String(o.p90)}]`)
          .join(', ')}`,
    ),
  ];
  return { ok: true, output: lines.join('\n') };
}

/** C7: word n-grams the pipeline's first drafts repeat across chapters and the operator's chapters lack. */
async function stockPhrasesCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const n = Number(flag(args, 'n') ?? '2');
  const minDrafts = Number(flag(args, 'min-drafts') ?? '3');
  const maxCorpusUses = Number(flag(args, 'max-corpus') ?? '0');
  const limit = Number(flag(args, 'limit') ?? '80');
  const { rows } = await pool.query<{ text: string }>(
    `SELECT v.text FROM manuscript_versions v WHERE v.language = 'ko' AND v.origin = 'assembled'
     UNION ALL SELECT q.text FROM quarantine_versions q WHERE q.origin = 'assembled'`,
  );
  const corpus = (await corpusChapters(pool)).map((r) => r.text);
  const phrases = stockPhraseCandidates(
    rows.map((r) => r.text),
    corpus,
    { n, minDrafts, maxCorpusUses },
  ).slice(0, limit);
  return {
    ok: true,
    output: { drafts: rows.length, corpus_chapters: corpus.length, n, minDrafts, phrases },
  };
}

/**
 * N3: accepted chapters of the named projects mixed with the operator's chapters at the same positions, normalized
 * alike, shuffled by the seed; the answer key is written encoded, its hash in the manifest.
 */
async function blindPacketCmd(pool: Pool, args: readonly string[]): Promise<Result> {
  const projects = (flag(args, 'projects') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const seed = flag(args, 'seed');
  const out = flag(args, 'out');
  const [from = 1, to = 5] = (flag(args, 'chapters') ?? '1-5').split('-').map(Number);
  if (projects.length === 0 || !seed || !out || !Number.isInteger(from) || !Number.isInteger(to))
    return {
      ok: false,
      output: {
        error: 'USAGE',
        usage:
          'corpus:blind-packet --projects=<id>[,<id>] --seed=<text> --out=<dir> [--chapters=1-5]',
      },
    };
  const pipeline: (PacketSource & { readonly pov: 'first' | 'third' | null })[] = [];
  for (const projectId of projects) {
    const title =
      (await pool.query<{ title: string }>('SELECT title FROM projects WHERE id = $1', [projectId]))
        .rows[0]?.title ?? projectId;
    const doc = await pinnedIdentityDocument(pool, { projectId, kind: 'narrative_identity' });
    const pov = (doc?.payload as { preferences?: { pov?: string } } | undefined)?.preferences?.pov;
    for (let n = from; n <= to; n++) {
      const found = await acceptedChapter(pool, projectId, n);
      if (found.state !== 'accepted') continue;
      pipeline.push({
        origin: 'pipeline',
        label: `pipeline: ${title} (${projectId}) 화 ${String(n)} v${String(found.chapter.version.version_no)}`,
        position: n,
        text: found.chapter.version.text,
        pov: pov === 'first' ? 'first' : pov ? 'third' : null,
      });
    }
  }
  if (pipeline.length === 0) return { ok: false, output: { error: 'NO_ACCEPTED_CHAPTERS' } };
  const ordinals = new Map<string, number>();
  const chapters: OperatorChapter[] = (await corpusChapters(pool))
    .filter((r) => r.kind === 'chapter')
    .map((r) => {
      const ordinal = (ordinals.get(r.book_id) ?? 0) + 1;
      ordinals.set(r.book_id, ordinal);
      return { id: r.id, book: r.book_title, ordinal, pov: r.pov, text: r.text };
    });
  const operator: PacketSource[] = pickOperatorMatches(
    pipeline.map((p) => ({ position: p.position, pov: p.pov })),
    chapters,
    seed,
  ).map((m) => ({
    origin: 'operator',
    label: `operator: ${m.book} chapter ${String(m.ordinal)} (${m.id})`,
    position: m.ordinal,
    text: m.text,
  }));
  const built = buildBlindPacket(
    [...pipeline.map(({ pov: _pov, ...source }) => source), ...operator],
    seed,
  );
  mkdirSync(out, { recursive: true });
  const manifest = { ...built.manifest, pipeline: pipeline.length, operator: operator.length };
  writeFileSync(join(out, 'packet.md'), built.packet);
  writeFileSync(join(out, 'answer-key.b64.txt'), `${encodeKey(built.key)}\n`);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, output: { out, ...manifest } };
}

/** The answer key of a packet folder, checked against its manifest. */
function revealCmd(args: readonly string[]): Result {
  const dir = flag(args, 'dir');
  if (!dir)
    return { ok: false, output: { error: 'USAGE', usage: 'corpus:reveal --dir=<packet folder>' } };
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    key_sha256: string;
  };
  const key = decodeKey(readFileSync(join(dir, 'answer-key.b64.txt'), 'utf8'), manifest);
  return {
    ok: true,
    output: key.items.map(({ item, origin, label }) => ({ item, origin, label })),
  };
}
