-- 0023_operator_corpus.sql — the operator's own novels as a reference corpus (ADR-0082).
--
-- WHY. The studio's target voice is the operator's own Korean webnovels. They arrive as EPUB files in a
-- repository the operator will delete later, so the text, its metadata and everything derived from it
-- (statistics, structure annotations, exemplar passages, contrast pairs) must live in the permanent
-- database and be usable after the files are gone.
--
-- SCOPE. A separate schema, `corpus`: studio-level reference data owned by the operator, not tenant data.
-- No grant to the application role — only the owner/migration role (the operator's CLI) reads it, which is
-- stricter than the tenant tables' RLS. Idempotent import: a book is keyed by the SHA-256 of its source file.
--
-- ROLLBACK. Forward-only (data architecture §15); the schema has no dependants outside itself.

CREATE SCHEMA IF NOT EXISTS corpus;

CREATE TABLE corpus.books (
  id               uuid PRIMARY KEY,
  source_repo      text NOT NULL,
  source_file      text NOT NULL,
  source_sha256    text NOT NULL UNIQUE,
  store_id         text,                      -- the leading "[number]" of the file name, kept as metadata
  title            text NOT NULL,
  title_key        text NOT NULL,             -- NFC, brackets/ids/punctuation/space removed: matches the manifest
  author           text,
  status           text,                      -- e.g. 완결, when the book says so
  synopsis         text,
  tags             text[] NOT NULL DEFAULT '{}',
  manifest_title   text,
  text_language    text NOT NULL CHECK (text_language IN ('ko', 'en', 'mixed')),
  is_translation   boolean NOT NULL DEFAULT false,
  voice_eligible   boolean NOT NULL,          -- Korean text in the operator's own words
  pov              text CHECK (pov IN ('first', 'third', 'mixed')),
  pov_inferred     boolean NOT NULL DEFAULT true,
  pov_evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  chapter_count    integer NOT NULL DEFAULT 0,
  import_version   text NOT NULL,
  imported_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX books_title_key_idx ON corpus.books (title_key);

CREATE TABLE corpus.chapters (
  id                   uuid PRIMARY KEY,
  book_id              uuid NOT NULL REFERENCES corpus.books(id) ON DELETE CASCADE,
  spine_index          integer NOT NULL,      -- order in the EPUB spine (every item, notices included)
  kind                 text NOT NULL CHECK (kind IN ('prologue', 'chapter', 'side', 'epilogue', 'afterword', 'notice')),
  position             integer,               -- 1-based 화 position in the main story (prologue + chapters)
  number               integer,               -- the number printed in the heading, when there is one
  title                text NOT NULL,
  text                 text NOT NULL,         -- NFC; one source paragraph per line, blank lines kept
  chars_with_spaces    integer NOT NULL,
  chars_without_spaces integer NOT NULL,
  paragraph_count      integer NOT NULL,
  pov                  text CHECK (pov IN ('first', 'third', 'mixed')),
  source_href          text NOT NULL,
  content_sha256       text NOT NULL,
  UNIQUE (book_id, spine_index)
);
CREATE INDEX chapters_book_position_idx ON corpus.chapters (book_id, position);

REVOKE ALL ON SCHEMA corpus FROM PUBLIC;
