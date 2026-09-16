-- 0009_lease_fence_assertion.sql — Checkpoint 7 corrective: make fencing ATOMIC with the write it protects.
--
-- WHAT WAS WRONG. Migration 0008 gave every lease a monotone fence and `leaseOwnership` reported whether a
-- holder still owned its target. `runStep` consulted that read before each unit of work, which is a real
-- and useful guard — but it is a guard on the WRONG SIDE of a time-of-check/time-of-use gap. The sequence
--
--     t0  worker A: leaseOwnership() -> owned          (separate statement, separate transaction)
--     t1  worker A's lease expires; worker B steals it at fence+1
--     t2  worker A: canon.commit_delta(...)            (its own transaction, no fence involved)
--
-- leaves A's commit perfectly legal at the database level. Nothing in the commit's own transaction knows a
-- lease exists. The pre-step read narrows the window to microseconds but cannot close it, and a window that
-- small is exactly the one a retry after a long activity backoff or a paused VM lands in. For a pipeline
-- whose whole purpose is that accepted canon is never produced twice, "narrow" is not a guarantee.
--
-- WHAT THIS DOES. `canon.assert_lease_fence` re-validates the (lease id, holder, fence) triple and RAISES
-- `LEASE_LOST` when the caller has been superseded. Because it raises rather than returns, calling it as the
-- first statement inside the SAME transaction as a durable mutation makes the mutation conditional on
-- ownership: if the assertion fails, the transaction rolls back and the mutation never became visible. There
-- is no interval between the check and the use, because they are the same atomic unit.
--
-- `FOR SHARE` on the lease row is the second half of the guarantee. It makes the assertion a LOCKING read,
-- so a rival's steal (which takes `FOR UPDATE` on the same row in `canon.acquire_target_lease`) cannot
-- interleave between this assertion and the commit of the enclosing transaction: the stealer blocks until
-- this transaction ends. A plain read would be MVCC-consistent yet still allow the steal to commit first
-- and the protected write to land afterwards.
--
-- WHY A FUNCTION AND NOT A TRIGGER. Only some writes are lease-protected: the CLI runs the same pipeline
-- with no lease at all (one local operator, no rival), and canon corrections are operator-driven rather
-- than lease-held. A trigger would have to invent a policy for the unleased case, and the only safe
-- inventions are "refuse every unleased write" (breaks the CLI) or "allow when no lease is present" (which
-- a zombie reaches by simply not presenting one). The caller knows whether it holds a lease; the assertion
-- makes that claim checkable.
--
-- ROLLBACK. Forward-only (data architecture §15). Reverting means a new migration that drops the function;
-- no data is written by it, so dropping it loses no history — it only removes the guarantee.

-- ---------------------------------------------------------------------------------------------------------
-- canon.assert_lease_fence(lease_id, holder_workflow_id, fence)
-- ---------------------------------------------------------------------------------------------------------
-- Raises when the caller no longer owns the target. The HINT carries the stable code `LEASE_LOST` so the
-- TypeScript boundary (`asCanonError`) turns it into a typed error, and the message names the reason so an
-- operator learns whether the lease expired, was released, or was stolen at a higher fence.
--
-- The reason vocabulary matches `leaseOwnership`'s so a pre-step read and an in-transaction assertion never
-- describe the same situation with different words: missing / released / expired / fenced_out.
CREATE OR REPLACE FUNCTION canon.assert_lease_fence(
  p_lease_id uuid,
  p_holder_workflow_id text,
  p_fence bigint
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  own target_leases;
  rival_holder text;
  rival_fence bigint;
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'LEASE_LOST: no lease was presented for a lease-protected write'
      USING HINT = 'LEASE_LOST';
  END IF;

  -- FOR SHARE, not a plain SELECT: this is what serializes the assertion against a concurrent steal.
  -- `canon.acquire_target_lease` takes FOR UPDATE on this row, so once this transaction holds the share
  -- lock a stealer must wait for this transaction to end. The protected mutation therefore cannot commit
  -- after a steal that was already decided.
  SELECT * INTO own FROM target_leases WHERE id = p_lease_id FOR SHARE;

  IF own.id IS NULL THEN
    RAISE EXCEPTION 'LEASE_LOST: lease % does not exist (missing)', p_lease_id
      USING HINT = 'LEASE_LOST';
  END IF;

  IF own.holder_workflow_id <> p_holder_workflow_id OR own.fence <> p_fence THEN
    RAISE EXCEPTION 'LEASE_LOST: lease % is held at fence % by %, not fence % by % (fenced_out)',
      p_lease_id, own.fence, own.holder_workflow_id, p_fence, p_holder_workflow_id
      USING HINT = 'LEASE_LOST';
  END IF;

  -- RIVAL FIRST. A takeover both releases the old row and inserts a new one at a higher fence, so a
  -- superseded holder's own row legitimately reads `released` — but reporting "released" would tell an
  -- operator the target is free when in fact a rival is actively producing it. Checking for a live rival
  -- before the holder's own release/expiry state means a takeover is always reported as `fenced_out`, and
  -- `released`/`expired` are reserved for the cases where nobody else holds the target.
  SELECT holder_workflow_id, fence INTO rival_holder, rival_fence
    FROM target_leases
   WHERE project_id = own.project_id
     AND target_kind = own.target_kind
     AND target_id = own.target_id
     AND released_at IS NULL
     AND expires_at > now()
     AND id <> own.id
   ORDER BY fence DESC
   LIMIT 1;

  IF rival_holder IS NOT NULL THEN
    RAISE EXCEPTION 'LEASE_LOST: target %/% is now held by % at fence % (fenced_out)',
      own.target_kind, own.target_id, rival_holder, rival_fence
      USING HINT = 'LEASE_LOST';
  END IF;

  IF own.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'LEASE_LOST: lease % was already released (released)', p_lease_id
      USING HINT = 'LEASE_LOST';
  END IF;

  IF own.expires_at <= now() THEN
    RAISE EXCEPTION 'LEASE_LOST: lease % expired at % (expired)', p_lease_id, own.expires_at
      USING HINT = 'LEASE_LOST';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION canon.assert_lease_fence(uuid, text, bigint) TO yeonjae_app;
