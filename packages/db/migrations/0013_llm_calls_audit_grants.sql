-- 0013_llm_calls_audit_grants.sql — make the audit's append-only claim true at the GRANT layer too
--
-- WHY. Independent release-gate review of the active-cancellation change found that migration 0012's own
-- comment, and the ADR-0049 text derived from it, assert that `llm_calls` is "INSERT/SELECT only for
-- `yeonjae_app`". That is NOT what the database says. 0007 narrowed the request-scoped role table by
-- table, and `llm_calls` was never in its REVOKE list, so the role still holds UPDATE and DELETE:
--
--   SELECT privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'llm_calls' AND grantee = 'yeonjae_app';
--   -- DELETE, INSERT, SELECT, UPDATE
--
-- Nothing is exploitable today: 0002's `llm_calls_append_only` trigger refuses UPDATE and DELETE for every
-- caller, including a superuser and raw SQL, and the review verified both refusals directly. So this is a
-- TRUTHFULNESS and defence-in-depth defect rather than a live authorization bypass — but "the grant layer
-- says the opposite of the documentation" is exactly the kind of gap that becomes a real hole the day
-- someone adds a legitimate reason to drop or narrow that trigger.
--
-- WHY A NEW MIGRATION. 0012 is already published. Editing an applied migration is refused by the runner
-- (it stores each file's content hash and raises on a modified past migration), and rewriting published
-- history is forbidden. Forward-only is also the honest shape here: the correction is a new fact about
-- privileges, not a retroactive claim that 0012 always said this.
--
-- SCOPE IS DELIBERATELY NARROW. Only `llm_calls` — the table whose documentation this change touched and
-- whose append-only guarantee the cancellation provenance depends on. Several other append-only-by-trigger
-- tables carry the same redundant grants from 0007; that is pre-existing, out of scope for a cancellation
-- review, and recorded in the progress notes rather than silently swept up here. A broad privilege sweep
-- deserves its own change and its own test pass.
--
-- SAFETY. REVOKE only; no new privilege is granted to anyone. The application never issues UPDATE or
-- DELETE against `llm_calls` (the gateway audit store only INSERTs and SELECTs, and the trigger has always
-- refused the rest), so no supported code path loses a capability it was using. Re-running is harmless:
-- REVOKE of an absent privilege is a no-op in PostgreSQL.

REVOKE UPDATE, DELETE ON llm_calls FROM yeonjae_app;

-- Default privileges for FUTURE tables were already narrowed by 0007; this only fixes the table 0007
-- missed, so no ALTER DEFAULT PRIVILEGES change is needed or wanted here.

-- ---------------------------------------------------------------------------------------------------
-- Second review finding: a NON-cancelled row could carry cancellation provenance.
--
-- 0012's trigger validates the provenance object's shape and enum membership, and refuses a `cancelled`
-- row that has none — but it never asked the converse question, so this was accepted:
--
--   INSERT INTO llm_calls (..., status, cancellation)
--   VALUES (..., 'succeeded', '{"reason":"operator_cancelled", ...}');
--
-- a row that simultaneously claims the call succeeded and that an operator cancelled it. No application
-- path can produce it (the gateway only ever writes provenance together with `status = 'cancelled'`), so
-- this is defence in depth rather than a live defect. It is still worth closing HERE, because the trigger
-- is the only guard that applies to raw SQL, a future writer, or a restore from a doctored dump — and a
-- self-contradictory audit row is worse than a missing one: a reader reconciling spend cannot tell which
-- half of it to believe.
--
-- Implemented by REPLACING 0012's trigger function rather than editing 0012 (forward-only: the runner
-- refuses a modified past migration). The replacement keeps every rule 0012 enforced, verbatim, and adds
-- the converse check.
CREATE OR REPLACE FUNCTION canon.assert_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cancellation IS NULL THEN
    -- A row that claims the cancelled status must say why. Silence would be the false claim.
    IF NEW.status = 'cancelled' THEN
      PERFORM canon.raise_code(
        'CANCELLATION_INVALID', 'a cancelled call must carry cancellation provenance');
    END IF;
    RETURN NEW;
  END IF;

  -- ADDED IN 0013: the converse. Provenance is meaningful only for a cancelled call.
  IF NEW.status <> 'cancelled' THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID',
      format('cancellation provenance is only valid on a cancelled call (status is %s)', NEW.status));
  END IF;

  IF jsonb_typeof(NEW.cancellation) <> 'object' THEN
    PERFORM canon.raise_code('CANCELLATION_INVALID', 'cancellation must be a JSON object');
  END IF;

  IF coalesce(NEW.cancellation->>'reason', '') NOT IN
     ('operator_cancelled', 'timeout', 'activity_cancelled', 'worker_shutdown', 'lease_lost') THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID',
      'cancellation.reason must be one of operator_cancelled, timeout, activity_cancelled, '
      'worker_shutdown, lease_lost');
  END IF;

  -- No member of this set means "the remote provider stopped" without an acknowledgement.
  IF coalesce(NEW.cancellation->>'remote_cancellation', '') NOT IN
     ('not_requested', 'acknowledged', 'unsupported', 'unknown') THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID',
      'cancellation.remote_cancellation must be one of not_requested, acknowledged, unsupported, unknown');
  END IF;

  -- `unknown` is a first-class value here, and zero is NOT an allowed substitute for it.
  IF coalesce(NEW.cancellation->>'usage_status', '') NOT IN ('reported', 'unknown') THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID', 'cancellation.usage_status must be reported or unknown');
  END IF;
  IF coalesce(NEW.cancellation->>'billing_status', '') NOT IN ('known', 'unknown') THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID', 'cancellation.billing_status must be known or unknown');
  END IF;

  -- A call that reported no usage cannot claim its billing is known: the false zero 0012 exists to stop.
  IF NEW.cancellation->>'usage_status' = 'unknown'
     AND NEW.cancellation->>'billing_status' = 'known' THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID', 'billing_status cannot be known when usage_status is unknown');
  END IF;

  RETURN NEW;
END $$;

COMMENT ON TABLE llm_calls IS
  'Append-only gateway audit (NFR-A.1/A.4). Enforced in two layers: the llm_calls_append_only trigger '
  '(migration 0002) refuses UPDATE and DELETE for every caller including raw SQL, and the request-scoped '
  'role yeonjae_app holds only INSERT and SELECT (migration 0013). Cancellation provenance (migration '
  '0012) therefore cannot be rewritten after the fact.';
