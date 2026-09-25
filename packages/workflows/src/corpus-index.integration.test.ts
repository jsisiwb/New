/**
 * The operator corpus in Postgres (ADR-0082): an idempotent import keyed by the file hash, voice-eligible
 * main-story chapters only, and the copy index built from the database rather than from files.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { corpusChapters, importCorpusBook, listCorpusBooks, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { corpusCopyIndexFor } from './corpus-index.js';

const run = databaseUrl() ? describe : describe.skip;

const chapter = (
  spine: number,
  kind: 'chapter' | 'notice',
  position: number | undefined,
  text: string,
) => ({
  spine_index: spine,
  kind,
  ...(position !== undefined ? { position } : {}),
  title: String(spine),
  text,
  chars_with_spaces: text.length,
  chars_without_spaces: text.replace(/\s/g, '').length,
  paragraph_count: 1,
  source_href: `Text/c${String(spine)}.xhtml`,
  content_sha256: `sha-${String(spine)}`,
});

const book = (sha: string, voice: boolean) => ({
  source_repo: 'test',
  source_file: `${sha}.epub`,
  source_sha256: sha,
  title: voice ? '한국어 작품' : '번역본',
  title_key: sha,
  tags: ['판타지'],
  text_language: voice ? ('ko' as const) : ('en' as const),
  is_translation: !voice,
  voice_eligible: voice,
  pov_evidence: {},
  import_version: 'test',
});

run('operator corpus in the database (ADR-0082)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('imports a book once, keeps chapters in order, and serves only voice-eligible main chapters', async () => {
    const chapters = [
      chapter(1, 'notice', undefined, '공지 문장이다.'),
      chapter(2, 'chapter', 1, '빗물이 고인 골목 끝에서 낡은 등불이 천천히 흔들리고 있었다.'),
      chapter(3, 'chapter', 2, '검은 외투의 사내는 대답 대신 담배를 비벼 껐다.'),
    ];
    const first = await importCorpusBook(pool, book('aaa', true), chapters);
    const again = await importCorpusBook(pool, book('aaa', true), chapters);
    expect(first.created).toBe(true);
    expect(again).toEqual({ book_id: first.book_id, created: false });
    await importCorpusBook(pool, book('bbb', false), [
      chapter(1, 'chapter', 1, 'An English line.'),
    ]);
    const books = await listCorpusBooks(pool);
    expect(books.map((b) => [b.title, b.chapter_count, b.voice_eligible])).toEqual([
      ['한국어 작품', 2, true],
      ['번역본', 1, false],
    ]);
    const rows = await corpusChapters(pool);
    expect(rows.map((r) => r.position)).toEqual([1, 2]);
    expect((await corpusChapters(pool, { includeIneligible: true })).length).toBe(3);
  });

  it('builds the copy index from the database and finds a reused sentence', async () => {
    const index = await corpusCopyIndexFor(pool, 14);
    expect(index?.size).toBeGreaterThan(0);
    const copies =
      index?.findCopies('그날 밤. 검은 외투의 사내는 대답 대신 담배를 비벼 껐다.') ?? [];
    expect(copies).toHaveLength(1);
    expect(copies[0]?.source_id).toBe('한국어 작품 2화');
  });
});
