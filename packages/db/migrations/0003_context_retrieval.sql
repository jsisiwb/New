-- 0003_context_retrieval.sql — Checkpoint 4: summaries, lexical search over accepted content, Active Constraint
-- Sets, context-pack records, embedding-set registry (ADR-0010, ADR-0011, ADR-0033, ADR-0035, ADR-0045).
-- Invariants enforced here, never only in application code:
--   * an L1 summary and every search document that cites a manuscript cite an ACCEPTED version (FR-7.17);
--     a version that stops being accepted (rollback) loses its summaries and search documents in the same
--     transaction, so a later reader cannot find them;
--   * quarantined versions can never be indexed: the FK targets manuscript_versions, from which quarantine
--     removes the row, and quarantine_versions has no incoming references;
--   * indexing is idempotent (one row per (project, kind, ref, key), upserted);
--   * exactly one embedding set may be active per project; embeddings themselves are deferred (ADR-0045).

-- ---------------------------------------------------------------------------------------------------------
-- hierarchical summaries (data architecture §6): L1 per accepted chapter version; L2–L4 per scope
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE summaries (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  tier text NOT NULL CHECK (tier IN ('L1','L2','L3','L4')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('chapter','arc','season','series')),
  scope_id uuid,
  chapter_from integer,
  chapter_to integer,
  manuscript_version_id uuid REFERENCES manuscript_versions(id),
  text text NOT NULL,
  ending_hook text,
  language text NOT NULL DEFAULT 'en' CHECK (language = 'en'),
  canon_version integer NOT NULL CHECK (canon_version >= 0),
  prompt_version_id text,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT summaries_text_is_nfc CHECK (text = normalize(text, NFC)),
  CONSTRAINT summaries_l1_has_version CHECK (tier <> 'L1' OR manuscript_version_id IS NOT NULL)
);
CREATE UNIQUE INDEX summaries_one_l1_per_version ON summaries(manuscript_version_id) WHERE tier = 'L1';
CREATE INDEX summaries_project_idx ON summaries(project_id, tier, chapter_from);

CREATE OR REPLACE FUNCTION canon.summary_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.manuscript_version_id IS NOT NULL THEN
    SELECT status INTO v_status FROM manuscript_versions WHERE id = NEW.manuscript_version_id;
    IF v_status IS NULL THEN
      PERFORM canon.raise_code('SUMMARY_SOURCE_NOT_ACCEPTED', 'manuscript version not found (quarantined versions are never summarized)');
    END IF;
    IF v_status <> 'accepted' THEN
      PERFORM canon.raise_code('SUMMARY_SOURCE_NOT_ACCEPTED', format('summaries are produced only from accepted versions; this one is %s', v_status));
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER summary_source_guard BEFORE INSERT OR UPDATE ON summaries FOR EACH ROW EXECUTE FUNCTION canon.summary_source_guard();

-- ---------------------------------------------------------------------------------------------------------
-- lexical search documents (data architecture §7): accepted paragraphs, L1 summaries, canonical events,
-- non-secret proposition statements, evidence quotes. English full-text (stemming) via the `english` config.
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE search_documents (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('chapter_paragraph','summary_l1','event','proposition','evidence_quote')),
  ref_kind text NOT NULL CHECK (ref_kind IN ('manuscript_version','summary','event','proposition','evidence_span')),
  ref_id uuid NOT NULL,
  ref_key text NOT NULL DEFAULT '',
  chapter_no integer,
  clock_ord bigint,
  timeline_id uuid REFERENCES timelines(id),
  entity_ids uuid[] NOT NULL DEFAULT '{}',
  importance text CHECK (importance IS NULL OR importance IN ('core','major','minor')),
  text text NOT NULL,
  language text NOT NULL DEFAULT 'en' CHECK (language = 'en'),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  manuscript_version_id uuid REFERENCES manuscript_versions(id) ON DELETE CASCADE,
  canon_version_added integer NOT NULL CHECK (canon_version_added >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT search_text_is_nfc CHECK (text = normalize(text, NFC)),
  CONSTRAINT search_manuscript_kinds_cite_version CHECK (kind NOT IN ('chapter_paragraph','summary_l1','evidence_quote') OR manuscript_version_id IS NOT NULL),
  UNIQUE (project_id, kind, ref_id, ref_key)
);
CREATE INDEX search_documents_tsv_idx ON search_documents USING GIN (tsv);
CREATE INDEX search_documents_entities_idx ON search_documents USING GIN (entity_ids);
CREATE INDEX search_documents_clock_idx ON search_documents(project_id, clock_ord);

-- Rule 5 of the data architecture: a search document may cite only an accepted version; canon-derived
-- documents must point at live (non-retracted) canon rows.
CREATE OR REPLACE FUNCTION canon.search_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_exists boolean;
BEGIN
  IF NEW.manuscript_version_id IS NOT NULL THEN
    SELECT status INTO v_status FROM manuscript_versions WHERE id = NEW.manuscript_version_id;
    IF v_status IS NULL THEN
      PERFORM canon.raise_code('SEARCH_SOURCE_NOT_ACCEPTED', 'manuscript version not found (quarantined versions are never indexed)');
    END IF;
    IF v_status <> 'accepted' THEN
      PERFORM canon.raise_code('SEARCH_SOURCE_NOT_ACCEPTED', format('only accepted versions are indexed; this one is %s', v_status));
    END IF;
  END IF;
  IF NEW.kind = 'event' THEN
    SELECT EXISTS (SELECT 1 FROM events WHERE id = NEW.ref_id AND project_id = NEW.project_id AND retracted_at_version IS NULL) INTO v_exists;
    IF NOT v_exists THEN PERFORM canon.raise_code('SEARCH_SOURCE_NOT_CANON', 'event is not live canon'); END IF;
  ELSIF NEW.kind = 'proposition' THEN
    SELECT EXISTS (SELECT 1 FROM propositions WHERE id = NEW.ref_id AND project_id = NEW.project_id AND retracted_at_version IS NULL
                     AND (secret IS NULL OR secret = 'null'::jsonb)) INTO v_exists;
    IF NOT v_exists THEN PERFORM canon.raise_code('SEARCH_SOURCE_NOT_CANON', 'proposition is not live, non-secret canon'); END IF;
  ELSIF NEW.kind = 'evidence_quote' THEN
    SELECT EXISTS (SELECT 1 FROM evidence_spans WHERE id = NEW.ref_id AND manuscript_version_id = NEW.manuscript_version_id) INTO v_exists;
    IF NOT v_exists THEN PERFORM canon.raise_code('SEARCH_SOURCE_NOT_CANON', 'evidence span not found on that version'); END IF;
  ELSIF NEW.kind = 'summary_l1' THEN
    SELECT EXISTS (SELECT 1 FROM summaries WHERE id = NEW.ref_id AND tier = 'L1' AND manuscript_version_id = NEW.manuscript_version_id) INTO v_exists;
    IF NOT v_exists THEN PERFORM canon.raise_code('SEARCH_SOURCE_NOT_CANON', 'L1 summary not found for that version'); END IF;
  ELSIF NEW.kind = 'chapter_paragraph' THEN
    IF NEW.ref_kind <> 'manuscript_version' OR NEW.ref_id <> NEW.manuscript_version_id THEN
      PERFORM canon.raise_code('SEARCH_SOURCE_NOT_CANON', 'a paragraph document references its own accepted version');
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER search_document_guard BEFORE INSERT OR UPDATE ON search_documents FOR EACH ROW EXECUTE FUNCTION canon.search_document_guard();

-- De-acceptance (rollback → approved; supersession) removes derived documents and summaries at once.
CREATE OR REPLACE FUNCTION canon.manuscript_deaccept_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN
    DELETE FROM search_documents WHERE manuscript_version_id = NEW.id;
    DELETE FROM summaries WHERE manuscript_version_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER manuscript_deaccept_cleanup AFTER UPDATE OF status ON manuscript_versions
  FOR EACH ROW EXECUTE FUNCTION canon.manuscript_deaccept_cleanup();

-- Paragraph ids must agree with @yeonjae/prose segmentParagraphs: split on blank lines, ids p1, p2, …;
-- an empty trailing piece is not a paragraph.
CREATE OR REPLACE FUNCTION canon.paragraphs(p_text text) RETURNS TABLE (paragraph_id text, body text) LANGUAGE sql IMMUTABLE AS $$
  SELECT 'p' || row_number() OVER (ORDER BY n), rtrim(part, E'\n')
  FROM regexp_split_to_table(p_text, E'\n[ \t]*\n+') WITH ORDINALITY AS t(part, n)
  WHERE rtrim(part, E'\n') <> ''
$$;

-- Entity tagging for a piece of text: any registry name, short form or alias appearing in it.
CREATE OR REPLACE FUNCTION canon.entities_mentioned(p_project uuid, p_text text) RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT e.id ORDER BY e.id), '{}')
  FROM entities e
  WHERE e.project_id = p_project AND e.status = 'active'
    AND EXISTS (SELECT 1 FROM unnest(ARRAY[e.display_name] || e.short_forms || e.aliases) AS nm
                WHERE length(nm) >= 3 AND position(nm IN p_text) > 0)
$$;

-- Idempotent indexing of one ACCEPTED version: paragraphs, its L1 summary, its evidence quotes, the events
-- and non-secret propositions its acceptance commit created. Called inside the acceptance transaction
-- (synchronous lexical index, data architecture §7) and by canon.reindex_project for repair.
CREATE OR REPLACE FUNCTION canon.index_accepted_version(p_version uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_mv manuscript_versions%ROWTYPE;
  v_chapter_no integer;
  v_main uuid;
  v_canon integer;
  v_commit uuid;
  v_n integer := 0;
  r record;
BEGIN
  SELECT * INTO v_mv FROM manuscript_versions WHERE id = p_version;
  IF v_mv.id IS NULL THEN PERFORM canon.raise_code('SEARCH_SOURCE_NOT_ACCEPTED', 'manuscript version not found'); END IF;
  IF v_mv.status <> 'accepted' THEN
    PERFORM canon.raise_code('SEARCH_SOURCE_NOT_ACCEPTED', format('only accepted versions are indexed; this one is %s', v_mv.status));
  END IF;
  SELECT number INTO v_chapter_no FROM chapters WHERE id = v_mv.chapter_id;
  SELECT id INTO v_main FROM timelines WHERE project_id = v_mv.project_id AND kind = 'main';
  SELECT coalesce(cc.version, p.canon_version), cc.id INTO v_canon, v_commit
    FROM projects p LEFT JOIN canon_commits cc ON cc.id = v_mv.accepted_commit_id WHERE p.id = v_mv.project_id;

  FOR r IN SELECT * FROM canon.paragraphs(v_mv.text) LOOP
    INSERT INTO search_documents (workspace_id, project_id, kind, ref_kind, ref_id, ref_key, chapter_no, clock_ord, timeline_id, entity_ids, text, manuscript_version_id, canon_version_added)
    VALUES (v_mv.workspace_id, v_mv.project_id, 'chapter_paragraph', 'manuscript_version', v_mv.id, r.paragraph_id, v_chapter_no,
            v_chapter_no::bigint * 1000000, v_main, canon.entities_mentioned(v_mv.project_id, r.body), r.body, v_mv.id, v_canon)
    ON CONFLICT (project_id, kind, ref_id, ref_key) DO UPDATE SET text = EXCLUDED.text, entity_ids = EXCLUDED.entity_ids, chapter_no = EXCLUDED.chapter_no;
    v_n := v_n + 1;
  END LOOP;

  FOR r IN SELECT s.id, s.text FROM summaries s WHERE s.manuscript_version_id = v_mv.id AND s.tier = 'L1' LOOP
    INSERT INTO search_documents (workspace_id, project_id, kind, ref_kind, ref_id, ref_key, chapter_no, clock_ord, timeline_id, entity_ids, text, manuscript_version_id, canon_version_added)
    VALUES (v_mv.workspace_id, v_mv.project_id, 'summary_l1', 'summary', r.id, '', v_chapter_no, v_chapter_no::bigint * 1000000, v_main,
            canon.entities_mentioned(v_mv.project_id, r.text), r.text, v_mv.id, v_canon)
    ON CONFLICT (project_id, kind, ref_id, ref_key) DO UPDATE SET text = EXCLUDED.text, entity_ids = EXCLUDED.entity_ids;
    v_n := v_n + 1;
  END LOOP;

  FOR r IN SELECT es.id, es.quote, es.chapter_no FROM evidence_spans es WHERE es.manuscript_version_id = v_mv.id LOOP
    INSERT INTO search_documents (workspace_id, project_id, kind, ref_kind, ref_id, ref_key, chapter_no, clock_ord, timeline_id, entity_ids, text, manuscript_version_id, canon_version_added)
    VALUES (v_mv.workspace_id, v_mv.project_id, 'evidence_quote', 'evidence_span', r.id, '', coalesce(r.chapter_no, v_chapter_no),
            coalesce(r.chapter_no, v_chapter_no)::bigint * 1000000, v_main, canon.entities_mentioned(v_mv.project_id, r.quote), r.quote, v_mv.id, v_canon)
    ON CONFLICT (project_id, kind, ref_id, ref_key) DO UPDATE SET text = EXCLUDED.text, entity_ids = EXCLUDED.entity_ids;
    v_n := v_n + 1;
  END LOOP;

  IF v_commit IS NOT NULL THEN
    FOR r IN SELECT e.id, e.summary, e.clock_ord, e.timeline_id, e.importance,
                    coalesce((SELECT array_agg(DISTINCT ep.entity_id ORDER BY ep.entity_id) FROM event_participants ep WHERE ep.event_id = e.id), '{}') AS ents
             FROM events e WHERE e.commit_id = v_commit AND e.retracted_at_version IS NULL LOOP
      INSERT INTO search_documents (workspace_id, project_id, kind, ref_kind, ref_id, ref_key, chapter_no, clock_ord, timeline_id, entity_ids, importance, text, manuscript_version_id, canon_version_added)
      VALUES (v_mv.workspace_id, v_mv.project_id, 'event', 'event', r.id, '', v_chapter_no, r.clock_ord, r.timeline_id, r.ents, r.importance, r.summary, NULL, v_canon)
      ON CONFLICT (project_id, kind, ref_id, ref_key) DO UPDATE SET text = EXCLUDED.text, entity_ids = EXCLUDED.entity_ids, importance = EXCLUDED.importance;
      v_n := v_n + 1;
    END LOOP;
    FOR r IN SELECT pr.id, pr.statement, pr.entity_ids FROM propositions pr
             WHERE pr.created_commit_id = v_commit AND pr.retracted_at_version IS NULL AND (pr.secret IS NULL OR pr.secret = 'null'::jsonb) LOOP
      INSERT INTO search_documents (workspace_id, project_id, kind, ref_kind, ref_id, ref_key, chapter_no, clock_ord, timeline_id, entity_ids, text, manuscript_version_id, canon_version_added)
      VALUES (v_mv.workspace_id, v_mv.project_id, 'proposition', 'proposition', r.id, '', v_chapter_no, v_chapter_no::bigint * 1000000, v_main, r.entity_ids, r.statement, NULL, v_canon)
      ON CONFLICT (project_id, kind, ref_id, ref_key) DO UPDATE SET text = EXCLUDED.text, entity_ids = EXCLUDED.entity_ids;
      v_n := v_n + 1;
    END LOOP;
  END IF;
  RETURN v_n;
END $$;

-- Repair/async path: (re)index every accepted version of a project and drop documents whose canon row is gone.
CREATE OR REPLACE FUNCTION canon.reindex_project(p_project uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_total integer := 0;
  r record;
BEGIN
  DELETE FROM search_documents d WHERE d.project_id = p_project AND d.manuscript_version_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM manuscript_versions mv WHERE mv.id = d.manuscript_version_id AND mv.status = 'accepted');
  DELETE FROM search_documents d WHERE d.project_id = p_project AND d.kind = 'event'
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = d.ref_id AND e.retracted_at_version IS NULL);
  DELETE FROM search_documents d WHERE d.project_id = p_project AND d.kind = 'proposition'
    AND NOT EXISTS (SELECT 1 FROM propositions p WHERE p.id = d.ref_id AND p.retracted_at_version IS NULL AND (p.secret IS NULL OR p.secret = 'null'::jsonb));
  FOR r IN SELECT id FROM manuscript_versions WHERE project_id = p_project AND status = 'accepted' ORDER BY created_at LOOP
    v_total := v_total + canon.index_accepted_version(r.id);
  END LOOP;
  RETURN v_total;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Active Constraint Sets (ADR-0033): compiled per chapter, content-addressed, immutable
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE active_constraint_sets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  chapter_no integer NOT NULL CHECK (chapter_no >= 1),
  spec_version integer NOT NULL CHECK (spec_version >= 1),
  content_hash text NOT NULL,
  rendered_text text NOT NULL,
  item_ids text[] NOT NULL DEFAULT '{}',
  token_count integer NOT NULL CHECK (token_count >= 0),
  hard_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, chapter_no, spec_version, content_hash)
);
CREATE OR REPLACE FUNCTION canon.acs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canon.raise_code('ACS_IMMUTABLE', 'an Active Constraint Set is content-addressed; compile a new one instead of editing');
  RETURN NULL;
END $$;
CREATE TRIGGER acs_immutable BEFORE UPDATE OR DELETE ON active_constraint_sets FOR EACH ROW EXECUTE FUNCTION canon.acs_immutable();

-- ---------------------------------------------------------------------------------------------------------
-- Context packs (data architecture §8): manifest + hashes only; rendered text lives in the artifact store
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE context_packs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  job_id uuid,
  template text NOT NULL,
  template_version text NOT NULL,
  role text NOT NULL,
  canon_version integer NOT NULL CHECK (canon_version >= 0),
  pack_hash text NOT NULL UNIQUE,
  manifest jsonb NOT NULL,
  token_counts jsonb NOT NULL,
  rendered_system_hash text NOT NULL,
  rendered_user_hash text NOT NULL,
  rendered_ref text,
  degraded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX context_packs_project_idx ON context_packs(project_id, created_at);
CREATE TRIGGER context_packs_append_only BEFORE UPDATE OR DELETE ON context_packs FOR EACH ROW EXECUTE FUNCTION canon.audit_append_only();

-- ---------------------------------------------------------------------------------------------------------
-- Embedding sets (ADR-0035): registry only. Embedding storage needs pgvector and arrives with the first
-- embedder adapter (ADR-0045); retrieval treats the vector source as optional until then.
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE embedding_sets (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  model_id text NOT NULL,
  provider text NOT NULL,
  dimension integer NOT NULL CHECK (dimension > 0),
  status text NOT NULL DEFAULT 'building' CHECK (status IN ('building','active','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX embedding_sets_one_active_per_project ON embedding_sets(project_id) WHERE status = 'active';
