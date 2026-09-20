-- 0019_novel_runs.sql — the durable "make my novel" run: one row per project, driven by a queue.
--
-- WHY A TABLE. The product promise is "enter details → pick a suggestion → approve → the studio writes
-- the whole novel". That is a long-running, resumable state machine over MANY chapter jobs, and its
-- state must survive a restart of the API, the worker and the browser. The chapter-production and story
-- planning jobs remain the units of work (they keep their own `jobs` / `job_steps` checkpoints); this
-- table records the OPERATOR'S intent for the project as a whole: what stage the novel is in, which
-- chapter is next, whether production should keep going without a human between chapters, and why it
-- stopped when it did.
--
-- THE QUEUE. A run in `planning` or `producing` is claimable work. `canon.claim_novel_run` hands one row
-- to exactly one runner (FOR UPDATE SKIP LOCKED + a lease with a fence), so several worker processes can
-- poll the same table without racing a chapter. The chapter-level `target_leases` (0008) remain the
-- authoritative guard on the chapter itself; this lease only decides who *drives* the run.
--
-- STATES. intake → suggesting → awaiting_approval → planning → producing → completed, with `paused` and
-- `failed` as resting states an operator resumes from, and `needs_attention` when a chapter's quality
-- gate needs a human decision. Transitions are recorded in `novel_run_events` (append-only) so the UI can
-- show what happened and when. Nothing here retracts canon or chapter history (ADR-0038).
--
-- ROLLBACK. Forward-only (data architecture §15): this migration only ADDs objects.

CREATE TABLE novel_runs (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id),
  status text NOT NULL DEFAULT 'intake' CHECK (status IN (
    'intake', 'suggesting', 'awaiting_approval', 'planning', 'producing',
    'paused', 'needs_attention', 'completed', 'failed', 'cancelled')),
  -- The intake document (validated against story-intake.schema.json) as a content-addressed artifact.
  intake_artifact_id uuid REFERENCES workflow_artifacts(id),
  spec_version integer NOT NULL DEFAULT 1 CHECK (spec_version >= 1),
  -- Concept the operator approved; NULL until approval.
  approved_concept_id uuid,
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  -- Production plan: how many chapters, which is next, and whether to continue without a human.
  target_chapters integer NOT NULL DEFAULT 1 CHECK (target_chapters >= 1),
  next_chapter integer NOT NULL DEFAULT 1 CHECK (next_chapter >= 1),
  auto_continue boolean NOT NULL DEFAULT true,
  -- Optional stop point for a batch ("write the first 10 then wait").
  stop_after_chapter integer CHECK (stop_after_chapter IS NULL OR stop_after_chapter >= 1),
  -- Runner lease: who is driving this run right now, and until when.
  runner_id text,
  runner_fence bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  -- Why the run rests where it does. A closed code plus an operator-safe message; never provider text.
  last_error jsonb,
  attempts integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX novel_runs_claimable_idx ON novel_runs(status, lease_expires_at)
  WHERE status IN ('planning', 'producing');

CREATE TABLE novel_run_events (
  id uuid PRIMARY KEY DEFAULT canon.uuid_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  run_id uuid NOT NULL REFERENCES novel_runs(id),
  seq integer NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE OR REPLACE FUNCTION canon.novel_run_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: novel_run_events rows are never updated or deleted' USING HINT = 'APPEND_ONLY';
END $$;
CREATE TRIGGER novel_run_events_append_only BEFORE UPDATE OR DELETE ON novel_run_events
  FOR EACH ROW EXECUTE FUNCTION canon.novel_run_events_append_only();

-- Claim one claimable run for a runner. Returns the row, or nothing when none is available.
-- A run whose lease has expired is claimable again (its previous runner is presumed dead); the fence
-- increments so a late write from that runner is refused by canon.novel_run_touch.
CREATE OR REPLACE FUNCTION canon.claim_novel_run(p_runner text, p_ttl_seconds integer)
RETURNS SETOF novel_runs LANGUAGE plpgsql AS $$
DECLARE
  r novel_runs;
BEGIN
  SELECT * INTO r FROM novel_runs
   WHERE status IN ('planning', 'producing')
     AND (lease_expires_at IS NULL OR lease_expires_at < now())
   ORDER BY updated_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF r.id IS NULL THEN RETURN; END IF;
  UPDATE novel_runs
     SET runner_id = p_runner,
         runner_fence = runner_fence + 1,
         lease_expires_at = now() + make_interval(secs => p_ttl_seconds),
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = r.id
   RETURNING * INTO r;
  RETURN NEXT r;
END $$;

-- Renew the runner lease; false when the runner has been fenced out.
CREATE OR REPLACE FUNCTION canon.renew_novel_run(p_run_id uuid, p_runner text, p_fence bigint, p_ttl_seconds integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  UPDATE novel_runs
     SET lease_expires_at = now() + make_interval(secs => p_ttl_seconds), updated_at = now()
   WHERE id = p_run_id AND runner_id = p_runner AND runner_fence = p_fence
     AND status IN ('planning', 'producing');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['novel_runs', 'novel_run_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (canon.workspace_visible(workspace_id)) WITH CHECK (canon.workspace_visible(workspace_id))',
      t || '_workspace_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON novel_runs TO yeonjae_app;
GRANT SELECT, INSERT ON novel_run_events TO yeonjae_app;
GRANT EXECUTE ON FUNCTION canon.novel_run_events_append_only() TO yeonjae_app;
GRANT EXECUTE ON FUNCTION canon.claim_novel_run(text, integer) TO yeonjae_app;
GRANT EXECUTE ON FUNCTION canon.renew_novel_run(uuid, text, bigint, integer) TO yeonjae_app;

-- Every canon.* function is least-privilege: explicit grants above, nothing PUBLIC-executable.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA canon FROM PUBLIC;
