-- 0012_cancellation_provenance.sql — truthful provenance for cancelled provider calls (Phase 4)
--
-- WHY. `llm_calls.status` has allowed 'cancelled' since 0002, but nothing ever wrote it: a durable
-- `jobs.control = 'cancel'` was observed only at a step boundary, so a provider call already in flight ran
-- to completion and was recorded as an ordinary success. Now that cancellation reaches an ACTIVE request,
-- a cancelled call is a real audit outcome and needs to say four things that cannot be inferred from the
-- row that existed before:
--
--   * WHY it stopped — an operator's decision, a deadline, a Temporal activity cancellation, a worker
--     shutdown or a lost lease. These demand different operator responses, and only the first two are
--     about the request at all.
--   * WHAT IS KNOWN ABOUT THE REMOTE SIDE — closing a socket is not evidence that a provider stopped
--     generating. `remote_cancellation` records `acknowledged` / `unsupported` / `unknown`, and there is
--     deliberately no value meaning "we are confident it stopped" without an acknowledgement.
--   * WHETHER A LATE RESPONSE WAS DISCARDED — a success that arrived after the abort must never be
--     persisted or reach canon, but the fact that it arrived is real and is recorded.
--   * WHETHER USAGE AND BILLING ARE KNOWN — the honesty rule of this migration. An aborted request is not
--     evidence of zero tokens or zero money. Usage the provider reported is kept; usage it never reported
--     is `unknown`, NEVER coerced to zero, because a missing count and a real zero are different facts and
--     only one of them is safe to sum.
--
-- WHY A COLUMN AND NOT A TABLE. Identical reasoning to 0011's `attempt_records`: a cancellation has no
-- identity of its own, is never queried apart from its call, and is written in the same single INSERT as
-- the call. A child table would add a second append-only surface, RLS policy and grant for data that is
-- always read with its parent.
--
-- FORWARD-ONLY AND DATA-PRESERVING. A nullable column with no default: every existing row keeps its exact
-- bytes and reads as NULL, which is the truthful statement "this call was not cancelled". No existing row
-- is rewritten, no merged migration is edited, and there is deliberately NO destructive down migration —
-- dropping the column would destroy audit history that the append-only trigger exists to protect.
--
-- PRIVILEGES. No new object needs a grant beyond the trigger function below: the column inherits the
-- table's existing FORCE RLS workspace policy and 0007's least-privilege grants (`llm_calls` is
-- INSERT/SELECT only for `yeonjae_app`, and 0002's append-only trigger already refuses UPDATE and DELETE
-- for every caller including raw SQL). Cancellation provenance therefore cannot be rewritten after the
-- fact, by anyone.

ALTER TABLE llm_calls
  ADD COLUMN cancellation jsonb;

-- Fail closed on shape, for the same reason 0011 does: a malformed cancellation record is a gateway
-- defect, and storing it now to render a false claim to an operator later is the outcome worth preventing.
-- Validation lives in a trigger rather than a CHECK because it enumerates enum membership across several
-- keys, and because a trigger runs for every writer including raw SQL.
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

  -- No member of this set means "the remote provider stopped" without an acknowledgement. That is the
  -- point of the constraint: the schema itself refuses to store an unevidenced claim.
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

  -- A call that reported no usage cannot claim its billing is known: that is exactly the false zero this
  -- column exists to prevent.
  IF NEW.cancellation->>'usage_status' = 'unknown'
     AND NEW.cancellation->>'billing_status' = 'known' THEN
    PERFORM canon.raise_code(
      'CANCELLATION_INVALID',
      'billing_status cannot be known when usage_status is unknown');
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER llm_calls_cancellation
  BEFORE INSERT ON llm_calls
  FOR EACH ROW EXECUTE FUNCTION canon.assert_cancellation();

GRANT EXECUTE ON FUNCTION canon.assert_cancellation() TO yeonjae_app;

-- Cancelled calls are read as a set (an operator auditing what a cancellation actually cost), and they are
-- a small minority of rows, so the index is partial.
CREATE INDEX llm_calls_cancelled_idx ON llm_calls(project_id, created_at)
  WHERE status = 'cancelled';

COMMENT ON COLUMN llm_calls.cancellation IS
  'Provenance for a cancelled call (Phase 4): reason, outcome, remote_cancellation, usage_status, '
  'billing_status, requested_at, aborted_at, response_discarded, before_first_attempt. NULL means the '
  'call was not cancelled. usage_status/billing_status record unknown rather than zero: an aborted local '
  'request is not evidence that no tokens were produced or that nothing will be billed. Never contains '
  'prompts, prose, provider payloads or credentials.';
