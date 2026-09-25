-- 0024_corpus_annotations_passages.sql — what the studio derives from the operator corpus (ADR-0082, ADR-0083).
--
-- WHY. Structure annotations (C2), exemplar passages by scene type (C5) and contrast pairs (C6) are derived
-- from the corpus once and read by every later call; they must survive the source files like the corpus.
--
-- SCOPE. Three tables in the `corpus` schema, owned by the operator role like the corpus itself. A
-- derived row names what produced it (a deterministic analyzer version or a pipeline role@version) so a
-- re-derivation adds rows instead of overwriting history.
--
-- ROLLBACK. Forward-only; the tables have no dependants outside the schema.

CREATE TABLE corpus.annotations (
  id          uuid PRIMARY KEY,
  chapter_id  uuid NOT NULL REFERENCES corpus.chapters(id) ON DELETE CASCADE,
  annotator   text NOT NULL,              -- 'structure@1' (deterministic) or '<role>@<version>' (pipeline)
  payload     jsonb NOT NULL,
  llm_call_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, annotator)
);

CREATE TABLE corpus.passages (
  id          uuid PRIMARY KEY,
  chapter_id  uuid NOT NULL REFERENCES corpus.chapters(id) ON DELETE CASCADE,
  start_cp    integer NOT NULL,           -- code-point offsets into corpus.chapters.text
  end_cp      integer NOT NULL,
  text        text NOT NULL,
  scene_type  text NOT NULL,              -- 오프닝·전투·대화·상태창·일상·만담·착각·절단 (stored as ids)
  tagger      text NOT NULL,
  features    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, start_cp, end_cp, tagger)
);
CREATE INDEX passages_scene_type_idx ON corpus.passages (scene_type);

CREATE TABLE corpus.contrast_pairs (
  id                 uuid PRIMARY KEY,
  passage_id         uuid NOT NULL REFERENCES corpus.passages(id) ON DELETE CASCADE,
  translationese     text NOT NULL,       -- a pipeline role's 번역투 rewrite of the passage
  generator          text NOT NULL,       -- '<role>@<version>'
  llm_call_id        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passage_id, generator)
);
