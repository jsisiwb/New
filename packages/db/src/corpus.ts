/**
 * The operator corpus in the permanent database (ADR-0082, migration 0023). Books are keyed by the SHA-256
 * of their source file, so an import is idempotent: the same file never lands twice, and each book's
 * chapters are written in the same transaction as the book, so a failed import leaves nothing half-done.
 */
import { uuidv7 } from '@yeonjae/domain';
import { withTransaction, type Pool } from './client.js';

export interface CorpusBookInput {
  readonly source_repo: string;
  readonly source_file: string;
  readonly source_sha256: string;
  readonly store_id?: string | undefined;
  readonly title: string;
  readonly title_key: string;
  readonly author?: string | undefined;
  readonly status?: string | undefined;
  readonly synopsis?: string | undefined;
  readonly tags: readonly string[];
  readonly manifest_title?: string | undefined;
  readonly text_language: 'ko' | 'en' | 'mixed';
  readonly is_translation: boolean;
  readonly voice_eligible: boolean;
  readonly pov?: 'first' | 'third' | 'mixed' | undefined;
  readonly pov_evidence: Readonly<Record<string, unknown>>;
  readonly import_version: string;
}

export interface CorpusChapterInput {
  readonly spine_index: number;
  readonly kind: 'prologue' | 'chapter' | 'side' | 'epilogue' | 'afterword' | 'notice';
  readonly position?: number | undefined;
  readonly number?: number | undefined;
  readonly title: string;
  readonly text: string;
  readonly chars_with_spaces: number;
  readonly chars_without_spaces: number;
  readonly paragraph_count: number;
  readonly pov?: 'first' | 'third' | 'mixed' | undefined;
  readonly source_href: string;
  readonly content_sha256: string;
}

export interface CorpusBookRow extends CorpusBookInput {
  readonly id: string;
  readonly chapter_count: number;
  readonly imported_at: string;
}

export async function importCorpusBook(
  pool: Pool,
  book: CorpusBookInput,
  chapters: readonly CorpusChapterInput[],
): Promise<{ readonly book_id: string; readonly created: boolean }> {
  return withTransaction(pool, async (c) => {
    const existing = await c.query<{ id: string }>(
      'SELECT id FROM corpus.books WHERE source_sha256 = $1',
      [book.source_sha256],
    );
    const found = existing.rows[0];
    if (found) return { book_id: found.id, created: false };
    const id = uuidv7();
    await c.query(
      `INSERT INTO corpus.books (id, source_repo, source_file, source_sha256, store_id, title, title_key,
         author, status, synopsis, tags, manifest_title, text_language, is_translation, voice_eligible, pov,
         pov_inferred, pov_evidence, chapter_count, import_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,$18,$19)`,
      [
        id,
        book.source_repo,
        book.source_file,
        book.source_sha256,
        book.store_id ?? null,
        book.title,
        book.title_key,
        book.author ?? null,
        book.status ?? null,
        book.synopsis ?? null,
        [...book.tags],
        book.manifest_title ?? null,
        book.text_language,
        book.is_translation,
        book.voice_eligible,
        book.pov ?? null,
        JSON.stringify(book.pov_evidence),
        chapters.filter((ch) => ch.kind === 'chapter' || ch.kind === 'prologue').length,
        book.import_version,
      ],
    );
    for (const ch of chapters)
      await c.query(
        `INSERT INTO corpus.chapters (id, book_id, spine_index, kind, position, number, title, text,
           chars_with_spaces, chars_without_spaces, paragraph_count, pov, source_href, content_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          uuidv7(),
          id,
          ch.spine_index,
          ch.kind,
          ch.position ?? null,
          ch.number ?? null,
          ch.title,
          ch.text,
          ch.chars_with_spaces,
          ch.chars_without_spaces,
          ch.paragraph_count,
          ch.pov ?? null,
          ch.source_href,
          ch.content_sha256,
        ],
      );
    return { book_id: id, created: true };
  });
}

export async function listCorpusBooks(pool: Pool): Promise<CorpusBookRow[]> {
  const { rows } = await pool.query<CorpusBookRow>(
    `SELECT id, source_repo, source_file, source_sha256, store_id, title, title_key, author, status, synopsis,
            tags, manifest_title, text_language, is_translation, voice_eligible, pov, pov_evidence,
            import_version, chapter_count, imported_at::text AS imported_at
       FROM corpus.books ORDER BY imported_at, title`,
  );
  return rows;
}

export interface CorpusChapterRow {
  readonly id: string;
  readonly book_id: string;
  readonly book_title: string;
  readonly kind: CorpusChapterInput['kind'];
  readonly position: number | null;
  readonly number: number | null;
  readonly title: string;
  readonly text: string;
  readonly chars_with_spaces: number;
  readonly chars_without_spaces: number;
  readonly paragraph_count: number;
  readonly pov: 'first' | 'third' | 'mixed' | null;
}

/** Main-story chapters (prologue + chapters) of voice-eligible books, or of the given books, in order. */
export async function corpusChapters(
  pool: Pool,
  opts: {
    readonly bookIds?: readonly string[] | undefined;
    readonly includeIneligible?: boolean | undefined;
    readonly maxPosition?: number | undefined;
  } = {},
): Promise<CorpusChapterRow[]> {
  const { rows } = await pool.query<CorpusChapterRow>(
    `SELECT c.id, c.book_id, b.title AS book_title, c.kind, c.position, c.number, c.title, c.text,
            c.chars_with_spaces, c.chars_without_spaces, c.paragraph_count, c.pov
       FROM corpus.chapters c JOIN corpus.books b ON b.id = c.book_id
      WHERE c.kind IN ('prologue', 'chapter')
        AND ($1::uuid[] IS NULL OR c.book_id = ANY($1))
        AND ($2::boolean OR b.voice_eligible)
        AND ($3::int IS NULL OR c.position <= $3)
      ORDER BY b.imported_at, b.title, c.position`,
    [
      opts.bookIds ? [...opts.bookIds] : null,
      opts.includeIneligible ?? false,
      opts.maxPosition ?? null,
    ],
  );
  return rows;
}

export interface CorpusPassageInput {
  readonly chapter_id: string;
  readonly start_cp: number;
  readonly end_cp: number;
  readonly text: string;
  readonly scene_type: string;
  readonly tagger: string;
  readonly features: Readonly<Record<string, unknown>>;
}

/**
 * Store derived passages (C5, migration 0024). A passage is keyed by chapter, offsets and tagger, so a
 * second derivation with the same tagger adds nothing and a new tagger adds rows beside the old ones.
 */
export async function insertCorpusPassages(
  pool: Pool,
  passages: readonly CorpusPassageInput[],
): Promise<{ readonly inserted: number }> {
  return withTransaction(pool, async (c) => {
    let inserted = 0;
    for (const p of passages) {
      const r = await c.query(
        `INSERT INTO corpus.passages (id, chapter_id, start_cp, end_cp, text, scene_type, tagger, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (chapter_id, start_cp, end_cp, tagger) DO NOTHING`,
        [uuidv7(), p.chapter_id, p.start_cp, p.end_cp, p.text, p.scene_type, p.tagger, p.features],
      );
      inserted += r.rowCount ?? 0;
    }
    return { inserted };
  });
}

export interface CorpusPassageRow {
  readonly id: string;
  readonly chapter_id: string;
  readonly book_title: string;
  readonly position: number | null;
  readonly pov: 'first' | 'third' | 'mixed' | null;
  readonly start_cp: number;
  readonly end_cp: number;
  readonly text: string;
  readonly scene_type: string;
  readonly features: Readonly<Record<string, unknown>>;
}

/** Passages of one tagger from voice-eligible books, optionally of some scene types, in corpus order. */
export async function corpusPassages(
  pool: Pool,
  opts: { readonly tagger: string; readonly sceneTypes?: readonly string[] | undefined },
): Promise<CorpusPassageRow[]> {
  const { rows } = await pool.query<CorpusPassageRow>(
    `SELECT p.id, p.chapter_id, b.title AS book_title, c.position, c.pov, p.start_cp, p.end_cp, p.text,
            p.scene_type, p.features
       FROM corpus.passages p
       JOIN corpus.chapters c ON c.id = p.chapter_id
       JOIN corpus.books b ON b.id = c.book_id
      WHERE p.tagger = $1 AND b.voice_eligible
        AND ($2::text[] IS NULL OR p.scene_type = ANY($2))
      ORDER BY b.imported_at, b.title, c.position, p.start_cp`,
    [opts.tagger, opts.sceneTypes ? [...opts.sceneTypes] : null],
  );
  return rows;
}
