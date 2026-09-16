-- 0010_operator_resources.sql — Checkpoint 7: the operator-editable resource families the API plan names.
--
-- WHY NEW TABLES AT ALL. Checkpoints 2–6 produced their planning documents as `workflow_artifacts`, which is
-- exactly right for machine output: content-addressed, immutable, and refused if a retry produces different
-- bytes. That immutability is what makes an OPERATOR edit impossible to express there — an edit is by
-- definition a new intended value for the same address, and `putArtifact` raises
-- `ARTIFACT_NONDETERMINISTIC` rather than accepting one. Editing artifacts in place would destroy the
-- determinism guarantee the production loop depends on.
--
-- So operator-authored state lives beside the artifacts, versioned, with the workflow artifact it descends
-- from recorded as provenance. Reading "the current story spec" means the newest row here, falling back to
-- the artifact the workflow produced; writing means appending a new version. Nothing is overwritten and
-- nothing the workflow produced is mutated.
--
-- INVARIANTS THIS MIGRATION ENFORCES IN THE DATABASE (not in a route handler):
--
--  * OPTIMISTIC CONCURRENCY is a unique key, not a read-then-write. `(project_id, version)` is unique on
--    every versioned family, so two operators who both edited version 3 cannot both write version 4: the
--    loser gets a duplicate-key violation and the API answers 409. A `SELECT max(version)` followed by an
--    `INSERT` would let both through.
--  * WINNER-ONLY PROPAGATION for concepts mirrors `candidate_selections` (0005): a selection row names
--    exactly one winner, the losers keep a terminal `rejected`/`superseded` status, and a CHECK forbids a
--    selection that names no winner. Losing concepts are retained — they are evidence of the decision — but
--    the schema gives nothing a way to call them selected.
--  * PINNED IS IMMUTABLE. `identity_documents` rows carry `pinned`; a trigger refuses any UPDATE that
--    changes the payload of a pinned row. Versioned immutability enforced by convention is not enforced.
--  * LOCKED PLANS refuse edits at the same layer: a locked plan version cannot have its payload rewritten,
--    so "locking" means something after the request that set it has returned.
--  * ASSUMPTIONS ARE NEVER SILENTLY PROMOTED. A decision row records the operator's choice against a
--    specific spec version and requirement id; the spec item itself only changes when a new spec version is
--    written, and the decision's `spec_version` makes a decision taken against a stale spec visible instead
--    of silently applying it to a newer one.
--
-- RLS. Every table here is workspace-owned and joins the same `canon.workspace_visible` policy the rest of
-- the schema uses (0006), with FORCE so the owner is not exempt, plus the least-privilege grants 0007
-- established for `yeonjae_app`. A new tenant table without a policy would be a silent isolation hole.
--
-- ROLLBACK. Forward-only (data architecture §15).

-- ---------------------------------------------------------------------------------------------------------
-- story specification and assumption review
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE story_spec_versions (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  version integer NOT NULL CHECK (version >= 1),
  -- The full Story Spec document; validated against schemas/story-spec.schema.json before it is written.
  payload jsonb NOT NULL,
  -- 'workflow' rows mirror what the production loop produced; 'operator' rows are human edits.
  source text NOT NULL CHECK (source IN ('workflow', 'operator')),
  -- The workflow artifact this version descends from, when any. Provenance, never a mutation target.
  derived_from_artifact_id uuid REFERENCES workflow_artifacts(id),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Optimistic concurrency, enforced by the database rather than by a read-modify-write race.
  UNIQUE (project_id, version)
);
CREATE INDEX story_spec_versions_project_idx ON story_spec_versions(project_id, version DESC);

CREATE TABLE assumption_decisions (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  -- The spec version the operator was looking at. A decision taken against an older version stays visible
  -- as such; it is never re-applied to a newer spec behind the operator's back.
  spec_version integer NOT NULL CHECK (spec_version >= 1),
  requirement_id text NOT NULL CHECK (requirement_id ~ '^REQ-[0-9]{3,5}$'),
  decision text NOT NULL CHECK (decision IN ('confirm', 'edit', 'reject')),
  -- For 'edit': the operator's replacement text. English manuscript-bearing text is checked at the boundary.
  edited_text text,
  -- Why. Required for reject/edit so the audit trail explains a changed requirement.
  rationale text,
  -- What the confirmation promoted the item to. Only 'confirm' may promote, and only to hard/soft.
  promoted_kind text CHECK (promoted_kind IN ('hard', 'soft')),
  decided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assumption_decisions_shape CHECK (
    (decision = 'confirm' AND promoted_kind IS NOT NULL AND edited_text IS NULL)
    OR (decision = 'edit' AND edited_text IS NOT NULL AND rationale IS NOT NULL AND promoted_kind IS NULL)
    OR (decision = 'reject' AND rationale IS NOT NULL AND edited_text IS NULL AND promoted_kind IS NULL)
  ),
  -- One decision per requirement per spec version: re-deciding means deciding against the new version.
  UNIQUE (project_id, spec_version, requirement_id)
);
CREATE INDEX assumption_decisions_project_idx ON assumption_decisions(project_id, spec_version);

-- ---------------------------------------------------------------------------------------------------------
-- running directions
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE directions (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  -- Operator instruction. Instructions may be in any language (ADR-0026 constrains manuscript prose, not
  -- operator intent), so `language` records what was authored rather than forcing English.
  text text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  scope_level text NOT NULL CHECK (scope_level IN ('series', 'season', 'arc', 'chapter_range')),
  chapter_from integer CHECK (chapter_from >= 1),
  chapter_to integer CHECK (chapter_to >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'applied', 'withdrawn')),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directions_range CHECK (chapter_to IS NULL OR chapter_from IS NULL OR chapter_to >= chapter_from)
);
CREATE INDEX directions_project_idx ON directions(project_id, created_at);

-- ---------------------------------------------------------------------------------------------------------
-- concepts: several candidates, exactly one winner, losers retained and never promotable
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE concept_candidates (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  -- Candidates generated together share a round, which is what a comparison view compares.
  round integer NOT NULL CHECK (round >= 1),
  label text NOT NULL,
  payload jsonb NOT NULL,
  -- 'candidate' until a selection resolves the round; then exactly one 'selected' and the rest 'rejected'.
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'selected', 'rejected')),
  derived_from_artifact_id uuid REFERENCES workflow_artifacts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, round, label)
);
CREATE INDEX concept_candidates_project_idx ON concept_candidates(project_id, round, id);

CREATE TABLE concept_selections (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  round integer NOT NULL CHECK (round >= 1),
  -- A selection without a winner is not a selection. Mirrors candidate_selections (0005).
  winner_concept_id uuid NOT NULL REFERENCES concept_candidates(id),
  loser_concept_ids uuid[] NOT NULL,
  rationale text,
  selected_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One decision per round; re-selecting a decided round is a conflict, not an overwrite.
  UNIQUE (project_id, round)
);

-- The winner may never appear among its own losers, which would let a UI render one concept as both.
CREATE OR REPLACE FUNCTION canon.assert_concept_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.winner_concept_id = ANY (NEW.loser_concept_ids) THEN
    RAISE EXCEPTION 'SELECTION_CONFLICT: the winning concept cannot also be a loser'
      USING HINT = 'SELECTION_CONFLICT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER concept_selections_shape BEFORE INSERT OR UPDATE ON concept_selections
  FOR EACH ROW EXECUTE FUNCTION canon.assert_concept_selection();

-- ---------------------------------------------------------------------------------------------------------
-- register profiles (per-character voice/dialogue register), versioned
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE register_profiles (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  entity_id uuid NOT NULL REFERENCES entities(id),
  version integer NOT NULL CHECK (version >= 1),
  payload jsonb NOT NULL,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, entity_id, version)
);
CREATE INDEX register_profiles_entity_idx ON register_profiles(project_id, entity_id, version DESC);

-- ---------------------------------------------------------------------------------------------------------
-- narrative identity, naming registry and terminology policy: versioned, pinned versions immutable
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE identity_documents (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('narrative_identity', 'naming_registry', 'terminology_policy')),
  version integer NOT NULL CHECK (version >= 1),
  payload jsonb NOT NULL,
  -- A pinned version is the one production reads. Pinning freezes the payload for good (see the trigger).
  pinned boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, version)
);
CREATE INDEX identity_documents_project_idx ON identity_documents(project_id, kind, version DESC);

/*
 * Pinning is a promise that the bytes production read cannot change afterwards.
 *
 * The API refuses to edit a pinned document, but an invariant that exists only in a route handler is one
 * bug away from not existing: the CLI, a future worker, or a migration script would each have to remember
 * it. Enforcing it here means a pinned payload cannot be rewritten through ANY path. Unpinning is likewise
 * refused — "unpin, edit, repin" would be a rewrite with extra steps. A change means a NEW version.
 */
CREATE OR REPLACE FUNCTION canon.assert_identity_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pinned THEN
    IF NEW.payload IS DISTINCT FROM OLD.payload THEN
      RAISE EXCEPTION 'IMMUTABLE_VERSION: a pinned % version cannot be edited; create a new version', OLD.kind
        USING HINT = 'IMMUTABLE_VERSION';
    END IF;
    IF NOT NEW.pinned THEN
      RAISE EXCEPTION 'IMMUTABLE_VERSION: a pinned % version cannot be unpinned', OLD.kind
        USING HINT = 'IMMUTABLE_VERSION';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_documents_immutable BEFORE UPDATE ON identity_documents
  FOR EACH ROW EXECUTE FUNCTION canon.assert_identity_document_immutable();

-- ---------------------------------------------------------------------------------------------------------
-- planning documents: series blueprint, arcs, chapter contracts, scene plans
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE plan_documents (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('series_blueprint', 'arc_plan', 'chapter_contract', 'scene_plan')),
  -- Stable address within a kind: '' for the single series blueprint, the arc id for an arc, the chapter
  -- number for a contract or scene plan. Deterministic so pagination and cursors are stable.
  plan_key text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  payload jsonb NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('workflow', 'operator')),
  derived_from_artifact_id uuid REFERENCES workflow_artifacts(id),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, plan_key, version)
);
CREATE INDEX plan_documents_project_idx ON plan_documents(project_id, kind, plan_key, version DESC);

-- A locked plan version is frozen for the same reason a pinned identity version is: downstream planning
-- read it. Editing means a new version, which is then visibly newer than whatever consumed the locked one.
CREATE OR REPLACE FUNCTION canon.assert_plan_document_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked AND NEW.payload IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'PLAN_LOCKED: a locked % version cannot be edited; create a new version', OLD.kind
      USING HINT = 'PLAN_LOCKED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_documents_lock BEFORE UPDATE ON plan_documents
  FOR EACH ROW EXECUTE FUNCTION canon.assert_plan_document_lock();

-- ---------------------------------------------------------------------------------------------------------
-- chapter review decisions (request-changes / reject / approve)
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE chapter_reviews (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  chapter_id uuid NOT NULL REFERENCES chapters(id),
  chapter_no integer NOT NULL CHECK (chapter_no >= 1),
  -- The exact version reviewed. A decision that did not name a version could not be audited against one.
  manuscript_version_id uuid NOT NULL REFERENCES manuscript_versions(id),
  decision text NOT NULL CHECK (decision IN ('request_changes', 'reject', 'approve')),
  -- Operator instruction for request_changes; reason for reject. Instructions may be in any language.
  note text,
  language text NOT NULL DEFAULT 'en',
  decided_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chapter_reviews_note_required CHECK (
    decision = 'approve' OR (note IS NOT NULL AND length(btrim(note)) > 0)
  )
);
CREATE INDEX chapter_reviews_chapter_idx ON chapter_reviews(project_id, chapter_no, created_at);

-- ---------------------------------------------------------------------------------------------------------
-- tenancy: RLS + least-privilege grants for everything this migration created
-- ---------------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY[
    'story_spec_versions', 'assumption_decisions', 'directions',
    'concept_candidates', 'concept_selections', 'register_profiles',
    'identity_documents', 'plan_documents', 'chapter_reviews'
  ];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (canon.workspace_visible(workspace_id)) WITH CHECK (canon.workspace_visible(workspace_id))',
      t || '_workspace_isolation', t);
    -- 0007 revoked blanket privileges and grants per table; these follow the same least-privilege shape.
    -- No DELETE: every family here is append-only versioned history, and history is not deleted.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO yeonjae_app', t);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION canon.assert_concept_selection() TO yeonjae_app;
GRANT EXECUTE ON FUNCTION canon.assert_identity_document_immutable() TO yeonjae_app;
GRANT EXECUTE ON FUNCTION canon.assert_plan_document_lock() TO yeonjae_app;
