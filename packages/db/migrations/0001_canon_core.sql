-- 0001_canon_core.sql — Yeonjae Studio canon core (Checkpoint 2)
-- Postgres 16. Forward-only. Implements docs/06-system/02-data-architecture.md §2–§6, §12–§13 for the MVP
-- (single workspace; workspace_id is present on every tenant table so RLS can be added without a rewrite).
-- Invariants enforced here (never only in application code):
--   * manuscript versions are immutable once approved; `accepted` is set only inside canon.commit_delta (ADR-0037)
--   * evidence spans are Unicode code-point offsets into NFC text and must equal the quote (ADR-0030)
--   * canon tables are written only inside canon.commit_delta; rows are never deleted (ADR-0009, ADR-0038)
--   * facts/events carry a frame legal for their timeline's kind (ADR-0039)
--   * story-time validity is half-open on the derived narrative key ord = chapter_no*1e6 + ordinal (ADR-0040)
--   * no two non-retracted facts for one (timeline, entity, attribute, key) overlap in validity;
--     no two non-retracted truth entries for one (proposition, timeline) overlap (ADR-0031, ADR-0038)

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS canon;

-- ---------------------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.uuid_v7() RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  -- RFC 9562 UUIDv7: 48-bit unix ms + version 0111 + random; time-ordered so creation order is a stable tie-break
  RETURN encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              placing substring(int8send((floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint) FROM 3)
              FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid;
END $$;

CREATE OR REPLACE FUNCTION canon.clock_ord(c jsonb) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN c IS NULL OR c = 'null'::jsonb THEN NULL
              ELSE (c->>'chapter_no')::bigint * 1000000 + (c->>'ordinal')::bigint END
$$;

CREATE OR REPLACE FUNCTION canon.in_commit() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('canon.in_commit', true), '') = 'true'
$$;

CREATE OR REPLACE FUNCTION canon.raise_code(code text, detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: %', code, detail USING ERRCODE = 'P0001', HINT = code;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- tenancy / project
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'created',
  operating_mode text NOT NULL DEFAULT 'assisted' CHECK (operating_mode IN ('assisted','semi_auto','autopilot')),
  quality_tier text NOT NULL DEFAULT 'standard' CHECK (quality_tier IN ('economy','standard','premium')),
  production_policy_version text NOT NULL DEFAULT 'policy/standard@1',
  output_language text NOT NULL DEFAULT 'en' CHECK (output_language = 'en'),
  spelling_locale text NOT NULL DEFAULT 'en-US' CHECK (spelling_locale IN ('en-US','en-GB')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  canon_version integer NOT NULL DEFAULT 0 CHECK (canon_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE timelines (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('main','prior_loop','alternate','source_story')),
  parent_timeline_id uuid REFERENCES timelines(id),
  divergence_clock jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- ADR-0039: a source_story timeline is a parallel reference — no parent, no divergence clock
  CONSTRAINT timelines_source_story_no_parent CHECK (kind <> 'source_story' OR (parent_timeline_id IS NULL AND divergence_clock IS NULL)),
  CONSTRAINT timelines_branch_has_parent CHECK (kind NOT IN ('prior_loop','alternate') OR parent_timeline_id IS NOT NULL),
  UNIQUE (project_id, name)
);
CREATE UNIQUE INDEX timelines_one_main_per_project ON timelines(project_id) WHERE kind = 'main';

-- ---------------------------------------------------------------------------------------------------------
-- bible: entities, propositions, promises (authored outside the canon boundary; canon deltas may add to them)
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  type text NOT NULL CHECK (type IN ('character','location','organization','item','ability','term','event_anchor','timeline')),
  display_name text NOT NULL,
  native_script_name text,
  romanization text,
  short_forms text[] NOT NULL DEFAULT '{}',
  aliases text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','merged_into')),
  merged_into_id uuid REFERENCES entities(id),
  created_from text NOT NULL DEFAULT 'bible' CHECK (created_from IN ('bible','extraction','user')),
  provisional boolean NOT NULL DEFAULT false,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entities_project_idx ON entities(project_id, type);

-- ---------------------------------------------------------------------------------------------------------
-- chapters and manuscript versions (ADR-0022, ADR-0037)
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE chapters (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  number integer NOT NULL CHECK (number >= 1),
  title text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned','drafting','drafted','evaluating','revising','review_pending','approved',
    'extracting','reconciling','verifying','committing','accepted','stale','superseded','retconned',
    'needs_attention','rejected')),
  accepted_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE TABLE manuscript_versions (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  chapter_id uuid NOT NULL REFERENCES chapters(id),
  version_no integer NOT NULL CHECK (version_no >= 1),
  origin text NOT NULL CHECK (origin IN ('assembled','revision','candidate','retcon','imported')),
  status text NOT NULL DEFAULT 'working' CHECK (status IN ('working','approved','accepted','superseded','retconned','rejected')),
  language text NOT NULL DEFAULT 'en' CHECK (language = 'en'),
  text text NOT NULL,
  length jsonb NOT NULL,
  content_hash text NOT NULL,
  parent_version_id uuid REFERENCES manuscript_versions(id),
  created_by_job_id uuid,
  approved_at timestamptz,
  approved_by text,
  accepted_commit_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chapter_id, version_no),
  CONSTRAINT manuscript_text_is_nfc CHECK (text = normalize(text, NFC))
);
CREATE UNIQUE INDEX manuscript_versions_one_accepted_per_chapter ON manuscript_versions(chapter_id) WHERE status = 'accepted';
CREATE INDEX manuscript_versions_chapter_idx ON manuscript_versions(chapter_id, status);
ALTER TABLE chapters ADD CONSTRAINT chapters_accepted_version_fk FOREIGN KEY (accepted_version_id) REFERENCES manuscript_versions(id);

CREATE TABLE quarantine_versions (
  LIKE manuscript_versions INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  rejection_reason text NOT NULL,
  PRIMARY KEY (id)
);
ALTER TABLE quarantine_versions ALTER COLUMN status SET DEFAULT 'rejected';
ALTER TABLE quarantine_versions ADD CONSTRAINT quarantine_status_rejected CHECK (status = 'rejected');
-- No canon table may reference quarantine_versions: it deliberately has no incoming foreign keys.

CREATE OR REPLACE FUNCTION canon.manuscript_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  legal boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'working' THEN
      PERFORM canon.raise_code('ILLEGAL_TRANSITION', 'a manuscript version is created as working; approval is a separate transition');
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status <> 'working' AND NEW.text <> OLD.text THEN
    PERFORM canon.raise_code('IMMUTABLE_MANUSCRIPT', format('version %s is %s; text may not change (create a new version)', OLD.id, OLD.status));
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  legal := (OLD.status, NEW.status) IN (
    ('working','approved'), ('working','rejected'),
    ('approved','accepted'), ('approved','rejected'),
    ('accepted','superseded'), ('accepted','retconned'), ('accepted','approved'));
  IF NOT legal THEN
    PERFORM canon.raise_code('ILLEGAL_TRANSITION', format('manuscript %s → %s', OLD.status, NEW.status));
  END IF;
  IF NEW.status IN ('accepted','superseded','retconned') AND NOT canon.in_commit() THEN
    PERFORM canon.raise_code('CANON_WRITE_OUTSIDE_COMMIT', format('status %s may only be set by canon.commit_delta', NEW.status));
  END IF;
  IF OLD.status = 'accepted' AND NEW.status = 'approved'
     AND coalesce(current_setting('canon.rollback', true), '') <> 'true' THEN
    PERFORM canon.raise_code('ILLEGAL_TRANSITION', 'accepted → approved is only reachable through a rollback commit (ADR-0038)');
  END IF;
  IF NEW.status = 'approved' AND OLD.status = 'working' THEN
    NEW.approved_at := coalesce(NEW.approved_at, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER manuscript_version_guard BEFORE INSERT OR UPDATE ON manuscript_versions
  FOR EACH ROW EXECUTE FUNCTION canon.manuscript_version_guard();

CREATE OR REPLACE FUNCTION canon.manuscript_version_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('canon.quarantine', true), '') <> 'true' THEN
    PERFORM canon.raise_code('IMMUTABLE_MANUSCRIPT', 'manuscript versions are never deleted; use canon.quarantine_version');
  END IF;
  IF OLD.status NOT IN ('working','approved') THEN
    PERFORM canon.raise_code('ILLEGAL_TRANSITION', format('a %s version cannot be quarantined', OLD.status));
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER manuscript_version_no_delete BEFORE DELETE ON manuscript_versions
  FOR EACH ROW EXECUTE FUNCTION canon.manuscript_version_no_delete();

-- ---------------------------------------------------------------------------------------------------------
-- evidence spans (ADR-0030): code-point offsets into NFC text, verified on write
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE evidence_spans (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  manuscript_version_id uuid NOT NULL REFERENCES manuscript_versions(id) ON DELETE CASCADE,
  chapter_no integer,
  paragraph_id text,
  start_cp integer NOT NULL CHECK (start_cp >= 0),
  end_cp integer NOT NULL CHECK (end_cp >= start_cp),
  quote text NOT NULL,
  quote_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_spans_version_idx ON evidence_spans(manuscript_version_id);

CREATE OR REPLACE FUNCTION canon.evidence_span_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_text text;
  v_status text;
  v_slice text;
  v_hash text;
BEGIN
  SELECT text, status INTO v_text, v_status FROM manuscript_versions WHERE id = NEW.manuscript_version_id;
  IF v_text IS NULL THEN
    PERFORM canon.raise_code('EVIDENCE_MISMATCH', 'manuscript version not found');
  END IF;
  IF v_status NOT IN ('approved','accepted','superseded','retconned') THEN
    PERFORM canon.raise_code('EVIDENCE_MISMATCH', format('evidence may reference only immutable versions, not %s', v_status));
  END IF;
  IF NEW.quote <> normalize(NEW.quote, NFC) THEN
    PERFORM canon.raise_code('EVIDENCE_MISMATCH', 'quote is not NFC');
  END IF;
  IF length(NEW.quote) <> NEW.end_cp - NEW.start_cp THEN
    PERFORM canon.raise_code('EVIDENCE_MISMATCH', format('quote has %s code points but span is %s', length(NEW.quote), NEW.end_cp - NEW.start_cp));
  END IF;
  -- substring on text is code-point based in PostgreSQL (server encoding UTF8)
  v_slice := substring(v_text FROM NEW.start_cp + 1 FOR NEW.end_cp - NEW.start_cp);
  IF v_slice <> NEW.quote THEN
    PERFORM canon.raise_code('EVIDENCE_MISMATCH', format('text[%s:%s] = %L does not equal quote %L', NEW.start_cp, NEW.end_cp, left(v_slice, 60), left(NEW.quote, 60)));
  END IF;
  v_hash := 'sha256:' || encode(sha256(convert_to(NEW.quote, 'UTF8')), 'hex');
  IF NEW.quote_hash IS NULL OR NEW.quote_hash = '' THEN
    NEW.quote_hash := v_hash;
  ELSIF NEW.quote_hash <> v_hash THEN
    PERFORM canon.raise_code('EVIDENCE_MISMATCH', 'quote_hash does not match sha256(quote)');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_span_guard BEFORE INSERT OR UPDATE ON evidence_spans
  FOR EACH ROW EXECUTE FUNCTION canon.evidence_span_guard();

-- ---------------------------------------------------------------------------------------------------------
-- canon tables (written only inside canon.commit_delta; never deleted)
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.canon_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM canon.raise_code('CANON_DELETE_FORBIDDEN', format('%s rows are never deleted; retract in a commit', TG_TABLE_NAME));
  END IF;
  IF NOT canon.in_commit() THEN
    PERFORM canon.raise_code('CANON_WRITE_OUTSIDE_COMMIT', format('%s may only be written by canon.commit_delta', TG_TABLE_NAME));
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION canon.canon_no_delete_stmt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM canon.raise_code('CANON_DELETE_FORBIDDEN', format('%s rows are never deleted or truncated; retract in a commit', TG_TABLE_NAME));
  RETURN NULL;
END $$;

CREATE TABLE canon_commits (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  version integer NOT NULL CHECK (version >= 1),
  parent_version integer NOT NULL CHECK (parent_version >= 0),
  source text NOT NULL CHECK (source IN ('bible','chapter_acceptance','user_correction','retcon','rollback','merge_entities','regeneration')),
  chapter_id uuid REFERENCES chapters(id),
  manuscript_version_id uuid REFERENCES manuscript_versions(id),
  superseded_manuscript_version_id uuid REFERENCES manuscript_versions(id),
  delta jsonb NOT NULL,
  inverse jsonb NOT NULL,
  actor jsonb NOT NULL DEFAULT '{}'::jsonb,
  justification text,
  touched_item_ids uuid[] NOT NULL DEFAULT '{}',
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  CONSTRAINT commit_version_is_parent_plus_one CHECK (version = parent_version + 1),
  CONSTRAINT user_correction_needs_justification CHECK (source <> 'user_correction' OR justification IS NOT NULL)
);
CREATE TRIGGER canon_commits_guard BEFORE INSERT OR UPDATE OR DELETE ON canon_commits FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER canon_commits_no_delete BEFORE DELETE OR TRUNCATE ON canon_commits FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();
ALTER TABLE manuscript_versions ADD CONSTRAINT manuscript_accepted_commit_fk FOREIGN KEY (accepted_commit_id) REFERENCES canon_commits(id);

CREATE TABLE facts (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  timeline_id uuid NOT NULL REFERENCES timelines(id),
  entity_id uuid NOT NULL REFERENCES entities(id),
  attribute text NOT NULL CHECK (attribute ~ '^[a-z_]+(\.[a-z_*]+)*$'),
  key text,
  value jsonb,
  value_text text,
  valid_from jsonb NOT NULL,
  valid_to jsonb,
  valid_from_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_from)) STORED,
  valid_to_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_to)) STORED,
  asserted_at_version integer NOT NULL,
  retracted_at_version integer,
  source text NOT NULL CHECK (source IN ('bible','extraction','user_correction','retcon')),
  confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  locked boolean NOT NULL DEFAULT false,
  frame text NOT NULL CHECK (frame IN ('canonical','flashback','prior_loop','alternate_timeline','source_story')),
  commit_id uuid NOT NULL REFERENCES canon_commits(id),
  superseded_by_fact_id uuid REFERENCES facts(id),
  justification text,
  CONSTRAINT facts_validity_ordered CHECK (valid_to_ord IS NULL OR valid_to_ord >= valid_from_ord),
  CONSTRAINT facts_retraction_after_assertion CHECK (retracted_at_version IS NULL OR retracted_at_version > asserted_at_version),
  -- ADR-0038: one live value per (timeline, entity, attribute, key) at any story time; a state change must supersede
  CONSTRAINT facts_no_overlapping_validity EXCLUDE USING gist (
    timeline_id WITH =, entity_id WITH =, attribute WITH =, (coalesce(key, '')) WITH =,
    int8range(valid_from_ord, valid_to_ord) WITH &&
  ) WHERE (retracted_at_version IS NULL)
);
CREATE INDEX facts_entity_attr_idx ON facts(project_id, entity_id, attribute, valid_from_ord);
CREATE INDEX facts_live_idx ON facts(project_id, timeline_id) WHERE retracted_at_version IS NULL;
CREATE TRIGGER facts_guard BEFORE INSERT OR UPDATE OR DELETE ON facts FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER facts_no_delete BEFORE DELETE OR TRUNCATE ON facts FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE fact_evidence (
  fact_id uuid NOT NULL REFERENCES facts(id),
  evidence_span_id uuid NOT NULL REFERENCES evidence_spans(id) ON DELETE RESTRICT,
  PRIMARY KEY (fact_id, evidence_span_id)
);
CREATE TRIGGER fact_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON fact_evidence FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER fact_evidence_no_delete BEFORE DELETE OR TRUNCATE ON fact_evidence FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  timeline_id uuid NOT NULL REFERENCES timelines(id),
  clock_start jsonb NOT NULL,
  clock_end jsonb,
  narrated_at jsonb,
  clock_ord bigint GENERATED ALWAYS AS (canon.clock_ord(clock_start)) STORED,
  frame text NOT NULL CHECK (frame IN ('canonical','flashback','dream','hallucination','lie','hypothetical','prediction','prior_loop','alternate_timeline','source_story')),
  type text NOT NULL,
  summary text NOT NULL,
  location_id uuid REFERENCES entities(id),
  importance text CHECK (importance IN ('core','major','minor')),
  asserted_at_version integer NOT NULL,
  retracted_at_version integer,
  commit_id uuid NOT NULL REFERENCES canon_commits(id),
  source_chapter_id uuid REFERENCES chapters(id),
  narrated_in_chapter_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE INDEX events_timeline_clock_idx ON events(project_id, timeline_id, clock_ord);
CREATE TRIGGER events_guard BEFORE INSERT OR UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER events_no_delete BEFORE DELETE OR TRUNCATE ON events FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE event_participants (
  event_id uuid NOT NULL REFERENCES events(id),
  entity_id uuid NOT NULL REFERENCES entities(id),
  role text NOT NULL CHECK (role IN ('agent','patient','witness','speaker','hearer','mentioned')),
  PRIMARY KEY (event_id, entity_id, role)
);
CREATE TRIGGER event_participants_guard BEFORE INSERT OR UPDATE OR DELETE ON event_participants FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER event_participants_no_delete BEFORE DELETE OR TRUNCATE ON event_participants FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE event_evidence (
  event_id uuid NOT NULL REFERENCES events(id),
  evidence_span_id uuid NOT NULL REFERENCES evidence_spans(id) ON DELETE RESTRICT,
  PRIMARY KEY (event_id, evidence_span_id)
);
CREATE TRIGGER event_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON event_evidence FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER event_evidence_no_delete BEFORE DELETE OR TRUNCATE ON event_evidence FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

-- ADR-0039: frame must be legal for the timeline's kind
CREATE OR REPLACE FUNCTION canon.frame_timeline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM timelines WHERE id = NEW.timeline_id;
  IF v_kind IS NULL THEN PERFORM canon.raise_code('FRAME_VIOLATION', 'timeline not found'); END IF;
  IF (NEW.frame = 'prior_loop' AND v_kind <> 'prior_loop')
     OR (NEW.frame = 'alternate_timeline' AND v_kind <> 'alternate')
     OR (NEW.frame = 'source_story' AND v_kind <> 'source_story') THEN
    PERFORM canon.raise_code('FRAME_VIOLATION', format('frame %s is not legal on a %s timeline', NEW.frame, v_kind));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER facts_frame_guard BEFORE INSERT OR UPDATE OF frame, timeline_id ON facts FOR EACH ROW EXECUTE FUNCTION canon.frame_timeline_guard();
CREATE TRIGGER events_frame_guard BEFORE INSERT OR UPDATE OF frame, timeline_id ON events FOR EACH ROW EXECUTE FUNCTION canon.frame_timeline_guard();

CREATE TABLE propositions (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  statement text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('identity','event','location','ability','intent','relationship','world_rule','secret','other')),
  entity_ids uuid[] NOT NULL DEFAULT '{}',
  secret jsonb,
  created_commit_id uuid NOT NULL REFERENCES canon_commits(id),
  created_in_chapter_id uuid REFERENCES chapters(id),
  retracted_at_version integer
);
CREATE TRIGGER propositions_guard BEFORE INSERT OR UPDATE OR DELETE ON propositions FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER propositions_no_delete BEFORE DELETE OR TRUNCATE ON propositions FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE proposition_truths (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  proposition_id uuid NOT NULL REFERENCES propositions(id),
  timeline_id uuid NOT NULL REFERENCES timelines(id),
  value text NOT NULL CHECK (value IN ('true','false','unknown')),
  valid_from jsonb,
  valid_to jsonb,
  valid_from_ord bigint GENERATED ALWAYS AS (coalesce(canon.clock_ord(valid_from), 0)) STORED,
  valid_to_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_to)) STORED,
  asserted_at_version integer NOT NULL,
  retracted_at_version integer,
  commit_id uuid NOT NULL REFERENCES canon_commits(id),
  -- ADR-0031: one truth value per (proposition, timeline) at any story time
  CONSTRAINT truths_no_overlap EXCLUDE USING gist (
    proposition_id WITH =, timeline_id WITH =, int8range(valid_from_ord, valid_to_ord) WITH &&
  ) WHERE (retracted_at_version IS NULL)
);
CREATE TRIGGER proposition_truths_guard BEFORE INSERT OR UPDATE OR DELETE ON proposition_truths FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER proposition_truths_no_delete BEFORE DELETE OR TRUNCATE ON proposition_truths FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE knowledge_states (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  timeline_id uuid NOT NULL REFERENCES timelines(id),
  knower_kind text NOT NULL CHECK (knower_kind IN ('character','narrator','reader')),
  knower_entity_id uuid REFERENCES entities(id),
  proposition_id uuid NOT NULL REFERENCES propositions(id),
  stance text NOT NULL CHECK (stance IN ('knows','suspects','believes_false','pretends','unaware','forgot','doubts')),
  believed_value text,
  pretend_target_ids uuid[] NOT NULL DEFAULT '{}',
  certainty numeric CHECK (certainty IS NULL OR (certainty >= 0 AND certainty <= 1)),
  source jsonb NOT NULL,
  implied boolean NOT NULL DEFAULT false,
  valid_from jsonb NOT NULL,
  valid_to jsonb,
  valid_from_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_from)) STORED,
  valid_to_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_to)) STORED,
  asserted_at_version integer NOT NULL,
  retracted_at_version integer,
  commit_id uuid NOT NULL REFERENCES canon_commits(id),
  superseded_by_id uuid REFERENCES knowledge_states(id),
  CONSTRAINT knower_character_has_entity CHECK (knower_kind <> 'character' OR knower_entity_id IS NOT NULL),
  CONSTRAINT knowledge_source_has_kind CHECK (source ? 'kind'),
  CONSTRAINT knowledge_told_has_informer CHECK (source->>'kind' <> 'told' OR source ? 'informer_id')
);
CREATE INDEX knowledge_states_lookup_idx ON knowledge_states(project_id, proposition_id, knower_kind, knower_entity_id, valid_from_ord);
CREATE TRIGGER knowledge_states_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge_states FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER knowledge_states_no_delete BEFORE DELETE OR TRUNCATE ON knowledge_states FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

-- data-architecture §12 rule 7: a character `knows` a secret only through a channel or a prior-loop/source-story memory
CREATE OR REPLACE FUNCTION canon.knowledge_secret_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_secret jsonb;
BEGIN
  IF NEW.stance = 'knows' AND NEW.knower_kind = 'character' THEN
    SELECT secret INTO v_secret FROM propositions WHERE id = NEW.proposition_id;
    IF v_secret IS NOT NULL AND v_secret <> 'null'::jsonb THEN
      IF NOT (NEW.source ? 'event_id' OR NEW.source->>'kind' IN ('prior_loop_memory','source_story','remembered')) THEN
        PERFORM canon.raise_code('KNOWLEDGE_LEAK', 'a knows-stance on a secret requires a channel event or a prior-loop/source-story memory');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_secret_guard BEFORE INSERT ON knowledge_states FOR EACH ROW EXECUTE FUNCTION canon.knowledge_secret_guard();

CREATE TABLE knowledge_evidence (
  knowledge_state_id uuid NOT NULL REFERENCES knowledge_states(id),
  evidence_span_id uuid NOT NULL REFERENCES evidence_spans(id) ON DELETE RESTRICT,
  PRIMARY KEY (knowledge_state_id, evidence_span_id)
);
CREATE TRIGGER knowledge_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge_evidence FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER knowledge_evidence_no_delete BEFORE DELETE OR TRUNCATE ON knowledge_evidence FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE relationship_states (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  timeline_id uuid NOT NULL REFERENCES timelines(id),
  from_entity_id uuid NOT NULL REFERENCES entities(id),
  to_entity_id uuid NOT NULL REFERENCES entities(id),
  type text NOT NULL,
  axes jsonb,
  power_dynamic text,
  register jsonb,
  note text,
  valid_from jsonb NOT NULL,
  valid_to jsonb,
  valid_from_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_from)) STORED,
  valid_to_ord bigint GENERATED ALWAYS AS (canon.clock_ord(valid_to)) STORED,
  asserted_at_version integer NOT NULL,
  retracted_at_version integer,
  commit_id uuid NOT NULL REFERENCES canon_commits(id),
  superseded_by_id uuid REFERENCES relationship_states(id),
  CONSTRAINT relationship_no_overlap EXCLUDE USING gist (
    timeline_id WITH =, from_entity_id WITH =, to_entity_id WITH =, int8range(valid_from_ord, valid_to_ord) WITH &&
  ) WHERE (retracted_at_version IS NULL)
);
CREATE TRIGGER relationship_states_guard BEFORE INSERT OR UPDATE OR DELETE ON relationship_states FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER relationship_states_no_delete BEFORE DELETE OR TRUNCATE ON relationship_states FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE relationship_evidence (
  relationship_state_id uuid NOT NULL REFERENCES relationship_states(id),
  evidence_span_id uuid NOT NULL REFERENCES evidence_spans(id) ON DELETE RESTRICT,
  PRIMARY KEY (relationship_state_id, evidence_span_id)
);
CREATE TRIGGER relationship_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON relationship_evidence FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER relationship_evidence_no_delete BEFORE DELETE OR TRUNCATE ON relationship_evidence FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE promises (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  type text NOT NULL,
  statement text NOT NULL,
  importance text NOT NULL CHECK (importance IN ('core','major','minor')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','open','advanced','paid','abandoned')),
  due_min_chapter integer,
  due_max_chapter integer,
  related_entity_ids uuid[] NOT NULL DEFAULT '{}',
  related_proposition_ids uuid[] NOT NULL DEFAULT '{}',
  resolution_hint text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promise_events (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  promise_id uuid NOT NULL REFERENCES promises(id),
  kind text NOT NULL CHECK (kind IN ('opened','advanced','paid','abandoned','rescheduled','reverted')),
  chapter_id uuid REFERENCES chapters(id),
  commit_id uuid NOT NULL REFERENCES canon_commits(id),
  note text,
  prev_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER promise_events_guard BEFORE INSERT OR UPDATE OR DELETE ON promise_events FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER promise_events_no_delete BEFORE DELETE OR TRUNCATE ON promise_events FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

CREATE TABLE promise_evidence (
  promise_event_id uuid NOT NULL REFERENCES promise_events(id),
  evidence_span_id uuid NOT NULL REFERENCES evidence_spans(id) ON DELETE RESTRICT,
  PRIMARY KEY (promise_event_id, evidence_span_id)
);
CREATE TRIGGER promise_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON promise_evidence FOR EACH ROW EXECUTE FUNCTION canon.canon_write_guard();
CREATE TRIGGER promise_evidence_no_delete BEFORE DELETE OR TRUNCATE ON promise_evidence FOR EACH STATEMENT EXECUTE FUNCTION canon.canon_no_delete_stmt();

-- ---------------------------------------------------------------------------------------------------------
-- extraction gate, quarantine
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.assert_extractable(p_version uuid) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_status text; v_chapter_status text;
BEGIN
  SELECT mv.status, c.status INTO v_status, v_chapter_status
    FROM manuscript_versions mv JOIN chapters c ON c.id = mv.chapter_id WHERE mv.id = p_version;
  IF v_status IS NULL THEN PERFORM canon.raise_code('NOT_EXTRACTABLE', 'manuscript version not found'); END IF;
  IF v_status <> 'approved' THEN
    PERFORM canon.raise_code('NOT_EXTRACTABLE', format('extraction reads only approval-locked versions; this one is %s', v_status));
  END IF;
  IF v_chapter_status NOT IN ('approved','extracting','reconciling','verifying','committing') THEN
    PERFORM canon.raise_code('NOT_EXTRACTABLE', format('chapter is %s', v_chapter_status));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION canon.quarantine_version(p_version uuid, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_row manuscript_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM manuscript_versions WHERE id = p_version FOR UPDATE;
  IF v_row.id IS NULL THEN PERFORM canon.raise_code('NOT_FOUND', 'manuscript version not found'); END IF;
  IF v_row.status NOT IN ('working','approved') THEN
    PERFORM canon.raise_code('ILLEGAL_TRANSITION', format('a %s version cannot be rejected', v_row.status));
  END IF;
  INSERT INTO quarantine_versions (id, workspace_id, project_id, chapter_id, version_no, origin, status, language, text, length,
    content_hash, parent_version_id, created_by_job_id, approved_at, approved_by, accepted_commit_id, meta, created_at, rejection_reason)
  VALUES (v_row.id, v_row.workspace_id, v_row.project_id, v_row.chapter_id, v_row.version_no, v_row.origin, 'rejected', v_row.language,
    v_row.text, v_row.length, v_row.content_hash, v_row.parent_version_id, v_row.created_by_job_id, v_row.approved_at, v_row.approved_by,
    NULL, v_row.meta, v_row.created_at, p_reason);
  PERFORM set_config('canon.quarantine', 'true', true);
  DELETE FROM manuscript_versions WHERE id = p_version;   -- cascades pre-commit evidence spans; canon links RESTRICT
  PERFORM set_config('canon.quarantine', 'false', true);
  RETURN p_version;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- atomic commit (ADR-0009, ADR-0037, ADR-0038)
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.link_evidence(p_ws uuid, p_target_table text, p_target_id uuid, p_evidence jsonb) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE
  ev jsonb; v_id uuid; v_ids uuid[] := '{}';
BEGIN
  FOR ev IN SELECT * FROM jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) LOOP
    INSERT INTO evidence_spans (workspace_id, manuscript_version_id, chapter_no, paragraph_id, start_cp, end_cp, quote, quote_hash)
    VALUES (p_ws, (ev->>'manuscript_version_id')::uuid, (ev->>'chapter_no')::int, ev->>'paragraph_id',
            (ev->>'start')::int, (ev->>'end')::int, ev->>'quote', coalesce(ev->>'quote_hash', ''))
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
    CASE p_target_table
      WHEN 'facts' THEN INSERT INTO fact_evidence VALUES (p_target_id, v_id);
      WHEN 'events' THEN INSERT INTO event_evidence VALUES (p_target_id, v_id);
      WHEN 'knowledge_states' THEN INSERT INTO knowledge_evidence VALUES (p_target_id, v_id);
      WHEN 'relationship_states' THEN INSERT INTO relationship_evidence VALUES (p_target_id, v_id);
      WHEN 'promise_events' THEN INSERT INTO promise_evidence VALUES (p_target_id, v_id);
      ELSE NULL;
    END CASE;
  END LOOP;
  RETURN v_ids;
END $$;

CREATE OR REPLACE FUNCTION canon.commit_delta(
  p_project uuid,
  p_parent_version integer,
  p_source text,
  p_delta jsonb,
  p_actor jsonb DEFAULT '{}'::jsonb,
  p_chapter uuid DEFAULT NULL,
  p_manuscript_version uuid DEFAULT NULL,
  p_justification text DEFAULT NULL,
  p_clock_max jsonb DEFAULT NULL,
  p_superseded_manuscript_version uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ws uuid;
  v_current integer;
  v_version integer;
  v_commit_id uuid;
  v_main_timeline uuid;
  v_item jsonb;
  v_payload jsonb;
  v_type text; v_op text; v_frame text; v_clock jsonb;
  v_timeline uuid;
  v_ref uuid;
  v_new_id uuid;
  v_local_ids jsonb := '{}'::jsonb;
  v_inverse jsonb := jsonb_build_object('inserted', '[]'::jsonb, 'closed', '[]'::jsonb, 'retracted', '[]'::jsonb,
                                        'promise_status', '[]'::jsonb, 'entity_status', '[]'::jsonb, 'manuscript', NULL, 'chapter', NULL);
  v_counts jsonb := '{}'::jsonb;
  v_touched uuid[] := '{}';
  v_clock_max bigint := canon.clock_ord(p_clock_max);
  v_prev_valid_to jsonb; v_prev_sup uuid; v_prev_status text; v_prev_chapter_status text;
  v_transition_only boolean := p_source IN ('chapter_acceptance', 'bible');
  v_ev_ids uuid[];
BEGIN
  IF p_source NOT IN ('bible','chapter_acceptance','user_correction','retcon','rollback','merge_entities','regeneration') THEN
    PERFORM canon.raise_code('ILLEGAL_OP', 'unknown commit source ' || p_source);
  END IF;
  IF p_source = 'user_correction' AND p_justification IS NULL THEN
    PERFORM canon.raise_code('ILLEGAL_OP', 'user_correction requires a justification');
  END IF;

  -- optimistic version check under a row lock: racing commits serialize here and the loser sees STALE_CANON
  SELECT workspace_id, canon_version INTO v_ws, v_current FROM projects WHERE id = p_project FOR UPDATE;
  IF v_ws IS NULL THEN PERFORM canon.raise_code('NOT_FOUND', 'project not found'); END IF;
  IF v_current <> p_parent_version THEN
    PERFORM canon.raise_code('STALE_CANON', format('canon is at version %s, delta was built against %s', v_current, p_parent_version));
  END IF;
  v_version := v_current + 1;
  SELECT id INTO v_main_timeline FROM timelines WHERE project_id = p_project AND kind = 'main';

  IF p_source = 'chapter_acceptance' THEN
    IF p_chapter IS NULL OR p_manuscript_version IS NULL THEN
      PERFORM canon.raise_code('ILLEGAL_OP', 'chapter_acceptance requires chapter and manuscript version');
    END IF;
    PERFORM canon.assert_extractable(p_manuscript_version);
  END IF;

  PERFORM set_config('canon.in_commit', 'true', true);

  INSERT INTO canon_commits (workspace_id, project_id, version, parent_version, source, chapter_id, manuscript_version_id,
                             superseded_manuscript_version_id, delta, inverse, actor, justification)
  VALUES (v_ws, p_project, v_version, p_parent_version, p_source, p_chapter, p_manuscript_version,
          p_superseded_manuscript_version, p_delta, '{}'::jsonb, coalesce(p_actor, '{}'::jsonb), p_justification)
  RETURNING id INTO v_commit_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_delta->'items', '[]'::jsonb)) LOOP
    v_type := v_item->>'type'; v_op := v_item->>'op'; v_frame := v_item->>'frame';
    v_payload := coalesce(v_item->'payload', '{}'::jsonb);
    v_clock := v_item->'story_clock';
    v_timeline := coalesce((v_payload->>'timeline_id')::uuid, v_main_timeline);
    v_ref := (v_item->>'supersedes_ref')::uuid;
    v_counts := jsonb_set(v_counts, ARRAY[v_type], to_jsonb(coalesce((v_counts->>v_type)::int, 0) + 1));

    IF v_op = 'retract' AND v_transition_only THEN
      PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: retract is not a story transition; %s commits may only assert/close/supersede (ADR-0038)', v_item->>'local_id', p_source));
    END IF;
    IF v_op IN ('close','supersede','retract') AND v_ref IS NULL THEN
      PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: %s requires supersedes_ref', v_item->>'local_id', v_op));
    END IF;
    IF v_clock_max IS NOT NULL AND v_type IN ('fact','knowledge_state','relationship_state') AND v_op IN ('assert','supersede')
       AND canon.clock_ord(v_payload->'valid_from') > v_clock_max THEN
      PERFORM canon.raise_code('FUTURE_VALIDITY', format('item %s starts after the chapter''s story time', v_item->>'local_id'));
    END IF;

    -- ===================================================================================== fact
    IF v_type = 'fact' THEN
      IF v_op IN ('close','supersede') THEN
        SELECT valid_to, superseded_by_fact_id INTO v_prev_valid_to, v_prev_sup FROM facts WHERE id = v_ref AND project_id = p_project FOR UPDATE;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: supersedes_ref fact %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{closed}', (v_inverse->'closed') || jsonb_build_object('table','facts','id',v_ref,'prev_valid_to',v_prev_valid_to,'prev_superseded_by',v_prev_sup));
        UPDATE facts SET valid_to = CASE WHEN v_op = 'close' THEN v_clock ELSE v_payload->'valid_from' END WHERE id = v_ref;
        v_touched := v_touched || v_ref;
      END IF;
      IF v_op IN ('assert','supersede') THEN
        INSERT INTO facts (workspace_id, project_id, timeline_id, entity_id, attribute, key, value, value_text, valid_from, valid_to,
                           asserted_at_version, source, confidence, locked, frame, commit_id, justification)
        VALUES (v_ws, p_project, v_timeline, (v_payload->>'entity_id')::uuid, v_payload->>'attribute', v_payload->>'key',
                v_payload->'value', v_payload->>'value_text', v_payload->'valid_from', v_payload->'valid_to',
                v_version, CASE p_source WHEN 'bible' THEN 'bible' WHEN 'user_correction' THEN 'user_correction' WHEN 'retcon' THEN 'retcon' ELSE 'extraction' END,
                (v_item->>'confidence')::numeric, coalesce((v_payload->>'locked')::boolean, false), v_frame, v_commit_id, v_payload->>'justification')
        RETURNING id INTO v_new_id;
        IF v_op = 'supersede' THEN UPDATE facts SET superseded_by_fact_id = v_new_id WHERE id = v_ref; END IF;
        v_ev_ids := canon.link_evidence(v_ws, 'facts', v_new_id, v_item->'evidence');
        IF p_source IN ('chapter_acceptance','retcon') AND coalesce(array_length(v_ev_ids, 1), 0) = 0 THEN
          PERFORM canon.raise_code('EVIDENCE_REQUIRED', format('item %s: extracted facts need ≥ 1 evidence span', v_item->>'local_id'));
        END IF;
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','facts','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || v_new_id;
      ELSIF v_op = 'retract' THEN
        UPDATE facts SET retracted_at_version = v_version WHERE id = v_ref AND project_id = p_project AND retracted_at_version IS NULL;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: fact %s not found or already retracted', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{retracted}', (v_inverse->'retracted') || jsonb_build_object('table','facts','id',v_ref));
        v_touched := v_touched || v_ref;
      ELSIF v_op <> 'close' THEN
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for fact', v_item->>'local_id', v_op));
      END IF;

    -- ===================================================================================== event
    ELSIF v_type = 'event' THEN
      IF v_op = 'assert' THEN
        INSERT INTO events (workspace_id, project_id, timeline_id, clock_start, clock_end, narrated_at, frame, type, summary, location_id,
                            importance, asserted_at_version, commit_id, source_chapter_id)
        VALUES (v_ws, p_project, v_timeline, coalesce(v_clock, v_payload->'clock_start'), v_payload->'clock_end', v_payload->'narrated_at', v_frame,
                v_payload->>'type', v_payload->>'summary', (v_payload->>'location_id')::uuid,
                coalesce(v_payload->>'importance', v_item->>'importance'), v_version, v_commit_id, p_chapter)
        RETURNING id INTO v_new_id;
        INSERT INTO event_participants (event_id, entity_id, role)
          SELECT v_new_id, (pp->>'entity_id')::uuid, pp->>'role' FROM jsonb_array_elements(coalesce(v_payload->'participants', '[]'::jsonb)) pp;
        PERFORM canon.link_evidence(v_ws, 'events', v_new_id, v_item->'evidence');
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','events','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || v_new_id;
      ELSIF v_op = 'retract' THEN
        UPDATE events SET retracted_at_version = v_version WHERE id = v_ref AND project_id = p_project AND retracted_at_version IS NULL;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: event %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{retracted}', (v_inverse->'retracted') || jsonb_build_object('table','events','id',v_ref));
        v_touched := v_touched || v_ref;
      ELSE
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for event', v_item->>'local_id', v_op));
      END IF;

    -- ===================================================================================== knowledge_state
    ELSIF v_type = 'knowledge_state' THEN
      IF v_op IN ('close','supersede') THEN
        SELECT valid_to, superseded_by_id INTO v_prev_valid_to, v_prev_sup FROM knowledge_states WHERE id = v_ref AND project_id = p_project FOR UPDATE;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: knowledge state %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{closed}', (v_inverse->'closed') || jsonb_build_object('table','knowledge_states','id',v_ref,'prev_valid_to',v_prev_valid_to,'prev_superseded_by',v_prev_sup));
        UPDATE knowledge_states SET valid_to = CASE WHEN v_op = 'close' THEN v_clock ELSE v_payload->'valid_from' END WHERE id = v_ref;
        v_touched := v_touched || v_ref;
      END IF;
      IF v_op IN ('assert','supersede') THEN
        INSERT INTO knowledge_states (workspace_id, project_id, timeline_id, knower_kind, knower_entity_id, proposition_id, stance, believed_value,
                                      pretend_target_ids, certainty, source, implied, valid_from, valid_to, asserted_at_version, commit_id)
        VALUES (v_ws, p_project, v_timeline, v_payload->'knower'->>'kind', (v_payload->'knower'->>'entity_id')::uuid, (v_payload->>'proposition_id')::uuid,
                v_payload->>'stance', v_payload->>'believed_value',
                coalesce(ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(coalesce(v_payload->'pretend_target_ids','[]'::jsonb)) x), '{}'),
                (v_payload->>'certainty')::numeric, v_payload->'source', coalesce((v_payload->>'implied')::boolean, false),
                v_payload->'valid_from', v_payload->'valid_to', v_version, v_commit_id)
        RETURNING id INTO v_new_id;
        IF v_op = 'supersede' THEN UPDATE knowledge_states SET superseded_by_id = v_new_id WHERE id = v_ref; END IF;
        PERFORM canon.link_evidence(v_ws, 'knowledge_states', v_new_id, v_item->'evidence');
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','knowledge_states','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || v_new_id;
      ELSIF v_op = 'retract' THEN
        UPDATE knowledge_states SET retracted_at_version = v_version WHERE id = v_ref AND project_id = p_project AND retracted_at_version IS NULL;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: knowledge state %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{retracted}', (v_inverse->'retracted') || jsonb_build_object('table','knowledge_states','id',v_ref));
        v_touched := v_touched || v_ref;
      ELSIF v_op <> 'close' THEN
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for knowledge_state', v_item->>'local_id', v_op));
      END IF;

    -- ===================================================================================== relationship_state
    ELSIF v_type = 'relationship_state' THEN
      IF v_op IN ('close','supersede') THEN
        SELECT valid_to, superseded_by_id INTO v_prev_valid_to, v_prev_sup FROM relationship_states WHERE id = v_ref AND project_id = p_project FOR UPDATE;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: relationship state %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{closed}', (v_inverse->'closed') || jsonb_build_object('table','relationship_states','id',v_ref,'prev_valid_to',v_prev_valid_to,'prev_superseded_by',v_prev_sup));
        UPDATE relationship_states SET valid_to = CASE WHEN v_op = 'close' THEN v_clock ELSE v_payload->'valid_from' END WHERE id = v_ref;
        v_touched := v_touched || v_ref;
      END IF;
      IF v_op IN ('assert','supersede') THEN
        INSERT INTO relationship_states (workspace_id, project_id, timeline_id, from_entity_id, to_entity_id, type, axes, power_dynamic, register, note,
                                         valid_from, valid_to, asserted_at_version, commit_id)
        VALUES (v_ws, p_project, v_timeline, (v_payload->>'from_entity_id')::uuid, (v_payload->>'to_entity_id')::uuid, v_payload->>'type',
                v_payload->'axes', v_payload->>'power_dynamic', v_payload->'register', v_payload->>'note',
                v_payload->'valid_from', v_payload->'valid_to', v_version, v_commit_id)
        RETURNING id INTO v_new_id;
        IF v_op = 'supersede' THEN UPDATE relationship_states SET superseded_by_id = v_new_id WHERE id = v_ref; END IF;
        PERFORM canon.link_evidence(v_ws, 'relationship_states', v_new_id, v_item->'evidence');
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','relationship_states','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || v_new_id;
      ELSIF v_op = 'retract' THEN
        UPDATE relationship_states SET retracted_at_version = v_version WHERE id = v_ref AND project_id = p_project AND retracted_at_version IS NULL;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: relationship state %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{retracted}', (v_inverse->'retracted') || jsonb_build_object('table','relationship_states','id',v_ref));
        v_touched := v_touched || v_ref;
      ELSIF v_op <> 'close' THEN
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for relationship_state', v_item->>'local_id', v_op));
      END IF;

    -- ===================================================================================== promise_event
    ELSIF v_type = 'promise_event' THEN
      IF v_op NOT IN ('open','advance','pay') THEN
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for promise_event', v_item->>'local_id', v_op));
      END IF;
      SELECT status INTO v_prev_status FROM promises WHERE id = (v_payload->>'promise_id')::uuid AND project_id = p_project FOR UPDATE;
      IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: promise not found', v_item->>'local_id')); END IF;
      INSERT INTO promise_events (promise_id, kind, chapter_id, commit_id, note, prev_status)
      VALUES ((v_payload->>'promise_id')::uuid, CASE v_op WHEN 'open' THEN 'opened' WHEN 'advance' THEN 'advanced' ELSE 'paid' END,
              p_chapter, v_commit_id, v_payload->>'note', v_prev_status)
      RETURNING id INTO v_new_id;
      v_ev_ids := canon.link_evidence(v_ws, 'promise_events', v_new_id, v_item->'evidence');
      IF v_op = 'pay' AND coalesce(array_length(v_ev_ids, 1), 0) = 0 THEN
        PERFORM canon.raise_code('EVIDENCE_REQUIRED', format('item %s: a paid promise needs evidence', v_item->>'local_id'));
      END IF;
      UPDATE promises SET status = CASE v_op WHEN 'open' THEN 'open' WHEN 'advance' THEN 'advanced' ELSE 'paid' END
        WHERE id = (v_payload->>'promise_id')::uuid;
      v_inverse := jsonb_set(v_inverse, '{promise_status}', (v_inverse->'promise_status') || jsonb_build_object('promise_id', v_payload->>'promise_id', 'prev_status', v_prev_status));
      v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','promise_events','id',v_new_id));
      v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
      v_touched := v_touched || (v_payload->>'promise_id')::uuid;

    -- ===================================================================================== proposition
    ELSIF v_type = 'proposition' THEN
      IF v_op = 'create' THEN
        INSERT INTO propositions (workspace_id, project_id, statement, kind, entity_ids, secret, created_commit_id, created_in_chapter_id)
        VALUES (v_ws, p_project, v_payload->>'statement', v_payload->>'kind',
                coalesce(ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(coalesce(v_payload->'entity_ids','[]'::jsonb)) x), '{}'),
                CASE WHEN v_payload->'secret' = 'null'::jsonb THEN NULL ELSE v_payload->'secret' END, v_commit_id, p_chapter)
        RETURNING id INTO v_new_id;
        INSERT INTO proposition_truths (proposition_id, timeline_id, value, valid_from, valid_to, asserted_at_version, commit_id)
          SELECT v_new_id, coalesce((t->>'timeline_id')::uuid, v_main_timeline), t->>'value', t->'valid_from', t->'valid_to', v_version, v_commit_id
          FROM jsonb_array_elements(coalesce(v_payload->'truth', '[]'::jsonb)) t;
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','propositions','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || v_new_id;
      ELSIF v_op = 'retract' THEN
        UPDATE propositions SET retracted_at_version = v_version WHERE id = v_ref AND project_id = p_project AND retracted_at_version IS NULL;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: proposition %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{retracted}', (v_inverse->'retracted') || jsonb_build_object('table','propositions','id',v_ref));
        v_touched := v_touched || v_ref;
      ELSE
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for proposition', v_item->>'local_id', v_op));
      END IF;

    -- ===================================================================================== proposition_truth
    ELSIF v_type = 'proposition_truth' THEN
      IF v_op IN ('close','supersede') THEN
        SELECT valid_to INTO v_prev_valid_to FROM proposition_truths WHERE id = v_ref FOR UPDATE;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: truth entry %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{closed}', (v_inverse->'closed') || jsonb_build_object('table','proposition_truths','id',v_ref,'prev_valid_to',v_prev_valid_to,'prev_superseded_by',NULL));
        UPDATE proposition_truths SET valid_to = CASE WHEN v_op = 'close' THEN v_clock ELSE v_payload->'valid_from' END WHERE id = v_ref;
        v_touched := v_touched || v_ref;
      END IF;
      IF v_op IN ('assert','supersede') THEN
        INSERT INTO proposition_truths (proposition_id, timeline_id, value, valid_from, valid_to, asserted_at_version, commit_id)
        VALUES ((v_payload->>'proposition_id')::uuid, coalesce((v_payload->>'timeline_id')::uuid, v_main_timeline), v_payload->>'value',
                v_payload->'valid_from', v_payload->'valid_to', v_version, v_commit_id)
        RETURNING id INTO v_new_id;
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','proposition_truths','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || (v_payload->>'proposition_id')::uuid;
      ELSIF v_op = 'retract' THEN
        UPDATE proposition_truths SET retracted_at_version = v_version WHERE id = v_ref AND retracted_at_version IS NULL;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: truth entry %s not found', v_item->>'local_id', v_ref)); END IF;
        v_inverse := jsonb_set(v_inverse, '{retracted}', (v_inverse->'retracted') || jsonb_build_object('table','proposition_truths','id',v_ref));
      ELSIF v_op <> 'close' THEN
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for proposition_truth', v_item->>'local_id', v_op));
      END IF;

    -- ===================================================================================== entity / alias
    ELSIF v_type = 'entity' THEN
      IF v_op = 'create' THEN
        INSERT INTO entities (workspace_id, project_id, type, display_name, native_script_name, romanization, short_forms, aliases, created_from, provisional, fields)
        VALUES (v_ws, p_project, v_payload->>'type', v_payload->>'display_name', v_payload->>'native_script_name', v_payload->>'romanization',
                coalesce(ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(v_payload->'short_forms','[]'::jsonb)) x), '{}'),
                coalesce(ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(v_payload->'aliases','[]'::jsonb)) x), '{}'),
                CASE p_source WHEN 'bible' THEN 'bible' WHEN 'user_correction' THEN 'user' ELSE 'extraction' END,
                coalesce((v_payload->>'provisional')::boolean, p_source = 'chapter_acceptance'), coalesce(v_payload->'fields', '{}'::jsonb))
        RETURNING id INTO v_new_id;
        v_inverse := jsonb_set(v_inverse, '{inserted}', (v_inverse->'inserted') || jsonb_build_object('table','entities','id',v_new_id));
        v_local_ids := v_local_ids || jsonb_build_object(v_item->>'local_id', v_new_id);
        v_touched := v_touched || v_new_id;
      ELSIF v_op = 'retract' THEN
        SELECT status INTO v_prev_status FROM entities WHERE id = v_ref AND project_id = p_project FOR UPDATE;
        IF NOT FOUND THEN PERFORM canon.raise_code('NOT_FOUND', format('item %s: entity %s not found', v_item->>'local_id', v_ref)); END IF;
        UPDATE entities SET status = 'retired' WHERE id = v_ref;
        v_inverse := jsonb_set(v_inverse, '{entity_status}', (v_inverse->'entity_status') || jsonb_build_object('id', v_ref, 'prev_status', v_prev_status));
        v_touched := v_touched || v_ref;
      ELSE
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for entity', v_item->>'local_id', v_op));
      END IF;
    ELSIF v_type = 'alias' THEN
      IF v_op = 'create' THEN
        UPDATE entities SET aliases = array_append(aliases, v_payload->>'alias') WHERE id = (v_payload->>'entity_id')::uuid AND project_id = p_project
          AND NOT (aliases @> ARRAY[v_payload->>'alias']);
        v_inverse := jsonb_set(v_inverse, '{entity_status}', (v_inverse->'entity_status') || jsonb_build_object('id', v_payload->>'entity_id', 'removed_alias', v_payload->>'alias'));
        v_touched := v_touched || (v_payload->>'entity_id')::uuid;
      ELSIF v_op = 'retract' THEN
        UPDATE entities SET aliases = array_remove(aliases, v_payload->>'alias') WHERE id = (v_payload->>'entity_id')::uuid AND project_id = p_project;
        v_inverse := jsonb_set(v_inverse, '{entity_status}', (v_inverse->'entity_status') || jsonb_build_object('id', v_payload->>'entity_id', 'restored_alias', v_payload->>'alias'));
      ELSE
        PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: op %s not valid for alias', v_item->>'local_id', v_op));
      END IF;
    ELSE
      PERFORM canon.raise_code('ILLEGAL_OP', format('item %s: unknown item type %s', v_item->>'local_id', v_type));
    END IF;
  END LOOP;

  -- manuscript acceptance happens inside this transaction (ADR-0037)
  IF p_source = 'chapter_acceptance' THEN
    SELECT status INTO v_prev_status FROM manuscript_versions WHERE id = p_manuscript_version FOR UPDATE;
    SELECT status INTO v_prev_chapter_status FROM chapters WHERE id = p_chapter FOR UPDATE;
    UPDATE manuscript_versions SET status = 'accepted', accepted_commit_id = v_commit_id WHERE id = p_manuscript_version;
    UPDATE chapters SET status = 'accepted', accepted_version_id = p_manuscript_version, updated_at = now() WHERE id = p_chapter;
    v_inverse := jsonb_set(v_inverse, '{manuscript}', jsonb_build_object('id', p_manuscript_version, 'prev_status', v_prev_status));
    v_inverse := jsonb_set(v_inverse, '{chapter}', jsonb_build_object('id', p_chapter, 'prev_status', v_prev_chapter_status, 'prev_accepted_version_id', NULL));
  END IF;
  IF p_superseded_manuscript_version IS NOT NULL THEN
    UPDATE manuscript_versions SET status = CASE p_source WHEN 'retcon' THEN 'retconned' ELSE 'superseded' END WHERE id = p_superseded_manuscript_version;
  END IF;

  UPDATE canon_commits SET inverse = v_inverse, item_counts = v_counts, touched_item_ids = v_touched WHERE id = v_commit_id;
  UPDATE projects SET canon_version = v_version, updated_at = now() WHERE id = p_project AND canon_version = p_parent_version;
  IF NOT FOUND THEN PERFORM canon.raise_code('STALE_CANON', 'version changed during commit'); END IF;

  PERFORM set_config('canon.in_commit', 'false', true);
  RETURN jsonb_build_object('commit_id', v_commit_id, 'version', v_version, 'item_ids', v_local_ids, 'item_counts', v_counts);
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- rollback of the latest commit (ADR-0038): apply the stored inverse in a new commit; version bumps once
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.rollback_latest(p_project uuid, p_actor jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ws uuid; v_current integer; v_commit canon_commits%ROWTYPE; v_new_commit uuid; v_inv jsonb; r jsonb; v_version integer;
BEGIN
  SELECT workspace_id, canon_version INTO v_ws, v_current FROM projects WHERE id = p_project FOR UPDATE;
  IF v_ws IS NULL THEN PERFORM canon.raise_code('NOT_FOUND', 'project not found'); END IF;
  SELECT * INTO v_commit FROM canon_commits WHERE project_id = p_project AND version = v_current;
  IF v_commit.id IS NULL THEN PERFORM canon.raise_code('NOT_FOUND', 'nothing to roll back'); END IF;
  IF v_commit.source = 'rollback' THEN PERFORM canon.raise_code('ILLEGAL_OP', 'a rollback cannot be rolled back in MVP'); END IF;
  v_inv := v_commit.inverse;
  v_version := v_current + 1;
  PERFORM set_config('canon.in_commit', 'true', true);
  PERFORM set_config('canon.rollback', 'true', true);

  INSERT INTO canon_commits (workspace_id, project_id, version, parent_version, source, chapter_id, manuscript_version_id, delta, inverse, actor, justification)
  VALUES (v_ws, p_project, v_version, v_current, 'rollback', v_commit.chapter_id, v_commit.manuscript_version_id,
          jsonb_build_object('rolls_back_commit', v_commit.id, 'rolled_back_version', v_current), '{}'::jsonb, coalesce(p_actor, '{}'::jsonb),
          format('rollback of version %s', v_current))
  RETURNING id INTO v_new_commit;

  -- 1. retract everything the commit inserted (never delete)
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(v_inv->'inserted', '[]'::jsonb)) LOOP
    CASE r->>'table'
      WHEN 'facts' THEN UPDATE facts SET retracted_at_version = v_version WHERE id = (r->>'id')::uuid;
      WHEN 'events' THEN UPDATE events SET retracted_at_version = v_version WHERE id = (r->>'id')::uuid;
      WHEN 'knowledge_states' THEN UPDATE knowledge_states SET retracted_at_version = v_version WHERE id = (r->>'id')::uuid;
      WHEN 'relationship_states' THEN UPDATE relationship_states SET retracted_at_version = v_version WHERE id = (r->>'id')::uuid;
      WHEN 'propositions' THEN UPDATE propositions SET retracted_at_version = v_version WHERE id = (r->>'id')::uuid;
                               UPDATE proposition_truths SET retracted_at_version = v_version WHERE proposition_id = (r->>'id')::uuid AND retracted_at_version IS NULL;
      WHEN 'proposition_truths' THEN UPDATE proposition_truths SET retracted_at_version = v_version WHERE id = (r->>'id')::uuid;
      WHEN 'promise_events' THEN INSERT INTO promise_events (promise_id, kind, commit_id, note) SELECT promise_id, 'reverted', v_new_commit, 'rollback' FROM promise_events WHERE id = (r->>'id')::uuid;
      WHEN 'entities' THEN UPDATE entities SET status = 'retired' WHERE id = (r->>'id')::uuid;
      ELSE NULL;
    END CASE;
  END LOOP;
  -- 2. re-open validity the commit closed (exact prior values, no inference)
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(v_inv->'closed', '[]'::jsonb)) LOOP
    CASE r->>'table'
      WHEN 'facts' THEN UPDATE facts SET valid_to = r->'prev_valid_to', superseded_by_fact_id = (r->>'prev_superseded_by')::uuid WHERE id = (r->>'id')::uuid;
      WHEN 'knowledge_states' THEN UPDATE knowledge_states SET valid_to = r->'prev_valid_to', superseded_by_id = (r->>'prev_superseded_by')::uuid WHERE id = (r->>'id')::uuid;
      WHEN 'relationship_states' THEN UPDATE relationship_states SET valid_to = r->'prev_valid_to', superseded_by_id = (r->>'prev_superseded_by')::uuid WHERE id = (r->>'id')::uuid;
      WHEN 'proposition_truths' THEN UPDATE proposition_truths SET valid_to = r->'prev_valid_to' WHERE id = (r->>'id')::uuid;
      ELSE NULL;
    END CASE;
  END LOOP;
  -- 3. restore rows the commit retracted
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(v_inv->'retracted', '[]'::jsonb)) LOOP
    CASE r->>'table'
      WHEN 'facts' THEN UPDATE facts SET retracted_at_version = NULL WHERE id = (r->>'id')::uuid;
      WHEN 'events' THEN UPDATE events SET retracted_at_version = NULL WHERE id = (r->>'id')::uuid;
      WHEN 'knowledge_states' THEN UPDATE knowledge_states SET retracted_at_version = NULL WHERE id = (r->>'id')::uuid;
      WHEN 'relationship_states' THEN UPDATE relationship_states SET retracted_at_version = NULL WHERE id = (r->>'id')::uuid;
      WHEN 'propositions' THEN UPDATE propositions SET retracted_at_version = NULL WHERE id = (r->>'id')::uuid;
      WHEN 'proposition_truths' THEN UPDATE proposition_truths SET retracted_at_version = NULL WHERE id = (r->>'id')::uuid;
      ELSE NULL;
    END CASE;
  END LOOP;
  -- 4. promises / entities
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(v_inv->'promise_status', '[]'::jsonb)) LOOP
    UPDATE promises SET status = r->>'prev_status' WHERE id = (r->>'promise_id')::uuid;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(v_inv->'entity_status', '[]'::jsonb)) LOOP
    IF r ? 'prev_status' THEN UPDATE entities SET status = r->>'prev_status' WHERE id = (r->>'id')::uuid; END IF;
    IF r ? 'removed_alias' THEN UPDATE entities SET aliases = array_remove(aliases, r->>'removed_alias') WHERE id = (r->>'id')::uuid; END IF;
    IF r ? 'restored_alias' THEN UPDATE entities SET aliases = array_append(aliases, r->>'restored_alias') WHERE id = (r->>'id')::uuid; END IF;
  END LOOP;
  -- 5. manuscript and chapter return to approved (not accepted)
  IF v_inv->'manuscript' IS NOT NULL AND v_inv->'manuscript' <> 'null'::jsonb THEN
    UPDATE manuscript_versions SET status = 'approved', accepted_commit_id = NULL WHERE id = (v_inv->'manuscript'->>'id')::uuid;
    UPDATE chapters SET status = 'approved', accepted_version_id = NULL, updated_at = now() WHERE id = (v_inv->'chapter'->>'id')::uuid;
  END IF;
  IF v_commit.superseded_manuscript_version_id IS NOT NULL THEN
    UPDATE manuscript_versions SET status = 'accepted' WHERE id = v_commit.superseded_manuscript_version_id;
  END IF;

  UPDATE canon_commits SET inverse = jsonb_build_object('restores_commit', v_commit.id), item_counts = v_commit.item_counts, touched_item_ids = v_commit.touched_item_ids WHERE id = v_new_commit;
  UPDATE projects SET canon_version = v_version, updated_at = now() WHERE id = p_project AND canon_version = v_current;
  PERFORM set_config('canon.rollback', 'false', true);
  PERFORM set_config('canon.in_commit', 'false', true);
  RETURN jsonb_build_object('commit_id', v_new_commit, 'version', v_version, 'rolled_back_version', v_current);
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- bitemporal query helpers (data architecture §13)
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION canon.state_at(p_project uuid, p_entity uuid, p_attribute text, p_clock jsonb,
                                          p_timeline uuid DEFAULT NULL, p_as_of_version integer DEFAULT NULL, p_key text DEFAULT NULL)
RETURNS SETOF facts LANGUAGE sql STABLE AS $$
  SELECT f.* FROM facts f
  WHERE f.project_id = p_project AND f.entity_id = p_entity
    AND (p_attribute IS NULL OR f.attribute = p_attribute)
    AND (p_key IS NULL OR f.key = p_key)
    AND f.timeline_id = coalesce(p_timeline, (SELECT id FROM timelines WHERE project_id = p_project AND kind = 'main'))
    AND f.valid_from_ord <= canon.clock_ord(p_clock)
    AND (f.valid_to_ord IS NULL OR f.valid_to_ord > canon.clock_ord(p_clock))
    AND f.asserted_at_version <= coalesce(p_as_of_version, 2147483647)
    AND (f.retracted_at_version IS NULL OR f.retracted_at_version > coalesce(p_as_of_version, 2147483647))
  ORDER BY f.attribute, f.key, f.valid_from_ord
$$;

CREATE OR REPLACE FUNCTION canon.knowledge_at(p_project uuid, p_knower_kind text, p_knower_entity uuid, p_proposition uuid, p_clock jsonb,
                                              p_timeline uuid DEFAULT NULL, p_as_of_version integer DEFAULT NULL)
RETURNS SETOF knowledge_states LANGUAGE sql STABLE AS $$
  SELECT k.* FROM knowledge_states k
  WHERE k.project_id = p_project AND k.knower_kind = p_knower_kind
    AND (p_knower_entity IS NULL OR k.knower_entity_id = p_knower_entity)
    AND (p_proposition IS NULL OR k.proposition_id = p_proposition)
    AND k.timeline_id = coalesce(p_timeline, (SELECT id FROM timelines WHERE project_id = p_project AND kind = 'main'))
    AND k.valid_from_ord <= canon.clock_ord(p_clock)
    AND (k.valid_to_ord IS NULL OR k.valid_to_ord > canon.clock_ord(p_clock))
    AND k.asserted_at_version <= coalesce(p_as_of_version, 2147483647)
    AND (k.retracted_at_version IS NULL OR k.retracted_at_version > coalesce(p_as_of_version, 2147483647))
  ORDER BY k.valid_from_ord
$$;

CREATE OR REPLACE FUNCTION canon.relationship_at(p_project uuid, p_from uuid, p_to uuid, p_clock jsonb,
                                                 p_timeline uuid DEFAULT NULL, p_as_of_version integer DEFAULT NULL)
RETURNS SETOF relationship_states LANGUAGE sql STABLE AS $$
  SELECT r.* FROM relationship_states r
  WHERE r.project_id = p_project AND r.from_entity_id = p_from AND r.to_entity_id = p_to
    AND r.timeline_id = coalesce(p_timeline, (SELECT id FROM timelines WHERE project_id = p_project AND kind = 'main'))
    AND r.valid_from_ord <= canon.clock_ord(p_clock)
    AND (r.valid_to_ord IS NULL OR r.valid_to_ord > canon.clock_ord(p_clock))
    AND r.asserted_at_version <= coalesce(p_as_of_version, 2147483647)
    AND (r.retracted_at_version IS NULL OR r.retracted_at_version > coalesce(p_as_of_version, 2147483647))
$$;

-- truth of a proposition on a timeline at a clock, inheriting from the parent timeline before the divergence point (ADR-0031)
CREATE OR REPLACE FUNCTION canon.truth_at(p_proposition uuid, p_timeline uuid, p_clock jsonb, p_as_of_version integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_value text; v_parent uuid; v_div jsonb; v_kind text;
BEGIN
  SELECT t.value INTO v_value FROM proposition_truths t
   WHERE t.proposition_id = p_proposition AND t.timeline_id = p_timeline
     AND t.valid_from_ord <= canon.clock_ord(p_clock) AND (t.valid_to_ord IS NULL OR t.valid_to_ord > canon.clock_ord(p_clock))
     AND t.asserted_at_version <= coalesce(p_as_of_version, 2147483647)
     AND (t.retracted_at_version IS NULL OR t.retracted_at_version > coalesce(p_as_of_version, 2147483647))
   ORDER BY t.valid_from_ord DESC LIMIT 1;
  IF v_value IS NOT NULL THEN RETURN v_value; END IF;
  SELECT parent_timeline_id, divergence_clock, kind INTO v_parent, v_div, v_kind FROM timelines WHERE id = p_timeline;
  IF v_parent IS NOT NULL AND (v_div IS NULL OR canon.clock_ord(p_clock) < canon.clock_ord(v_div)) THEN
    RETURN canon.truth_at(p_proposition, v_parent, p_clock, p_as_of_version);
  END IF;
  RETURN 'unknown';
END $$;
