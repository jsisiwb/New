-- 0025_claim_novel_run_for_project.sql — a runner started for one project claims only that project's run (ADR-0091).
--
-- WHY. `novel:run <project>` drove any claimable run in the database: during G8 the regression project's process
-- claimed the academy project's run after the academy runner stopped. On the operator's permanent database that
-- spends credits on whichever project last had a run in progress.
--
-- SCOPE. One function beside `canon.claim_novel_run` (unchanged), with the same lease and fence semantics and one
-- more predicate. Executable by the application role only.
--
-- ROLLBACK. Forward-only; nothing depends on the function but the runner.

CREATE OR REPLACE FUNCTION canon.claim_novel_run_for_project(p_runner text, p_ttl_seconds integer, p_project uuid)
RETURNS SETOF novel_runs LANGUAGE plpgsql AS $$
DECLARE
  r novel_runs;
BEGIN
  SELECT * INTO r FROM novel_runs
   WHERE project_id = p_project
     AND status IN ('planning', 'producing')
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
REVOKE EXECUTE ON FUNCTION canon.claim_novel_run_for_project(text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canon.claim_novel_run_for_project(text, integer, uuid) TO yeonjae_app;
