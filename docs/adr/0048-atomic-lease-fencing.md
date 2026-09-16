# ADR-0048: Lease fencing is asserted inside the transaction it protects, not before it

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** engineering agent (Checkpoint 7 corrective)
- **Relates to:** ADR-0047 (Temporal adapter over checkpointed steps), ADR-0044 (modular monolith first),
  ADR-0038 (bitemporal transition classes), migration `0008_target_leases.sql`, migration
  `0009_lease_fence_assertion.sql`, workflow reliability plan `docs/06-system/04-workflow-reliability-plan.md`

## Context

Migration 0008 introduced target leases with a monotone `fence`, and ADR-0047 §4 recorded the intended
guarantee: "a monotone **fence** so a revived holder cannot act after its lease was stolen". The
implementation delivered at `a3072ae` enforced that claim with a **pre-step ownership read**: `runStep`
called `leaseOwnership` before each unit of work and refused to continue when ownership had been lost.

That guard is real and worth keeping, but on its own it does not support the claim ADR-0047 made. The read
and the durable mutation it is supposed to protect are **separate transactions**, which leaves a
time-of-check/time-of-use gap:

```
t0  worker A: leaseOwnership() -> owned        (its own statement, its own transaction)
t1  worker A's lease expires; worker B steals the target at fence+1
t2  worker A: canon.commit_delta(...)          (its own transaction — nothing in it knows a lease exists)
```

At `t2` nothing refuses A's commit. The database had no knowledge that the commit was conditional on
anything, because the only thing that ever checked the fence was a statement that had already finished. The
pre-step read narrows the window to the duration of one step, but a window is not a guarantee — and the
cases that land in it are exactly the realistic ones: an activity retried after a long backoff, a paused or
descheduled VM, a GC pause, or a lease TTL that lapsed while a slow provider call was in flight.

A second defect had the same root cause. The heartbeat renewed the lease and **discarded a `false`
result**. `false` is returned only when the conditional `UPDATE` matched no row, which is the database
stating that this holder/fence pair is no longer live — a verdict, not an ambiguity. Discarding it meant a
fenced-out worker kept heartbeating until some later step boundary happened to notice.

Existing tests passed throughout, because they revoked the lease *between* steps and then observed the next
boundary refusing to continue. No test attacked the window between a check and its own mutation, so the gap
was invisible to the suite.

## Decision

1. **The fence is asserted inside the transaction that performs the protected write.** Migration 0009 adds
   `canon.assert_lease_fence(lease_id, holder, fence)`, which **raises** `LEASE_LOST` rather than returning
   a boolean. Called as the first statement of a mutation's transaction, it makes the mutation conditional
   on ownership: if the assertion fails the transaction rolls back and the mutation never became visible.
   There is no interval between the check and the use, because they are the same atomic unit.

2. **The assertion takes a `FOR SHARE` lock on the lease row.** `canon.acquire_target_lease` takes
   `FOR UPDATE` on that row when stealing, so a steal that begins while a fenced transaction is open must
   wait for that transaction to finish instead of interleaving with it. Without the lock a steal could
   commit first and the protected write could still land afterwards — the same gap in a different disguise.

3. **`withFencedTransaction(pool, claim, fn)` is the only sanctioned way to perform a lease-protected
   write.** It asserts then runs `fn` in one transaction, so a caller cannot hold a lease and forget the
   check. The following durable mutations now run through it:

   | Mutation | Site |
   | --- | --- |
   | canon acceptance / commit | `commitDelta` (`packages/db/src/repo.ts`) |
   | approval lock + chapter status | `approveVersion` (`packages/workflows/src/acceptance.ts`) |
   | winner enforcement (selection decision + loser transitions) | `commitSelection` (`packages/db/src/selection.ts`) |
   | L1 summary + accepted-only indexing | `summarizeAccepted` (`packages/workflows/src/acceptance.ts`) |
   | dependency-edge writes | `persistDependencyEdges` (`packages/workflows/src/acceptance.ts`) |
   | job step-begin + job running state | `runStep` (`packages/workflows/src/runtime.ts`) |

4. **A `false` renewal is treated immediately as definitive lease loss.** The heartbeat records the verdict
   and the next step boundary fails closed on it without issuing another read that could only confirm the
   same thing. A *thrown* renewal error is treated differently and deliberately: it is usually a transport
   fault and says nothing about ownership, so it is recorded and left to the ownership read rather than
   aborting a healthy run on a blip.

5. **The claim is optional, and its absence is explicit.** The CLI runs the same pipeline as a single local
   operator with no rival to race, so it holds no lease and performs no assertion. A trigger-based design
   was rejected for exactly this reason: it would have to choose between refusing every unleased write
   (breaking the CLI) or allowing writes when no lease is presented (which a zombie reaches by simply not
   presenting one). The caller knows whether it holds a lease; the assertion makes that claim checkable.

6. **A takeover is always reported as `fenced_out`.** A steal both releases the old row and inserts a new one
   at a higher fence, so a superseded holder's own row legitimately reads `released`. Reporting "released"
   would tell an operator the target is free while a rival is actively producing it, so the assertion checks
   for a live rival before consulting its own row's release/expiry state. `released` and `expired` are
   reserved for the cases where nobody else holds the target.

## Consequences

- ADR-0047 §4's sentence is now true as written. Before this change it described an intended property that
  the implementation approximated; the guarantee is now enforced by the database in the same transaction as
  the write, which is the only place it cannot be raced.
- The pre-step ownership read is **kept**, and its role is now correctly scoped: it is an early, cheap stop
  that avoids wasted provider spend, not the mechanism that protects canon. Both layers report the same
  `LEASE_LOST` vocabulary (`fenced_out` / `expired` / `released` / `missing`) so a step boundary and an
  in-transaction refusal never describe one situation with two different words.
- `LEASE_LOST` is non-retryable by classification: another worker owns the target, so a retry would only
  re-attempt the same forbidden mutation.
- Writes that are *not* lease-protected are unchanged. Canon corrections, retcons and rollbacks are
  operator-driven rather than lease-held, and the unleased CLI path keeps working; this ADR does not claim
  those paths are fenced, because they are not.
- Cost: one extra round-trip per protected transaction, and a short row-level lock contended only by a rival
  actually trying to steal the same target. Both are negligible next to a chapter's provider spend.
- Limitation, recorded honestly: the guarantee covers the durable mutations listed in §3. It does **not**
  make an in-flight provider call abortable — a fenced-out worker may already have spent money on a call
  that is in flight when it is fenced out. What is guaranteed is that the *result* of that call cannot
  become approved, accepted or canon, and that the rightful holder's own run is unaffected.
