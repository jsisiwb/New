# ADR-0091: Unattended runs, part 1 — a project-scoped runner, a lost lease is not a failure, a bounded lease retake

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0072 (status file, stuck runs), `docs/08-delivery/13-live-run-gemini.md` §8 (the G8 incident),
  the operator's plan N4 (chapters 6–15 unattended).

## Context

During G8 the sandbox ran out of memory and the live runs' connections to the permanent database dropped for a few
seconds. Three things went wrong, none of them in the pipeline's writing:

1. The academy runner stopped on its failed heartbeat, and the **regression project's** `novel:run` process claimed the
   academy run and finished it: `NovelRunner.tick()` claims any claimable run in the database
   (`canon.claim_novel_run`), whatever project the command names.
2. The regression runner could not prove its lease on the failed read, failed closed (correctly) and then **recorded the
   run as failed**, with the cancellation reason `operator_cancelled`, although nobody had cancelled it and no other
   runner held it. The run needed a manual `novel:resume`.
3. Nothing took the lease back: an unattended batch (N4) would have stopped at the first blip.

## Decision

1. `canon.claim_novel_run_for_project(runner, ttl, project)` (migration 0025): the same lease and fence semantics as
   `canon.claim_novel_run`, restricted to one project. `NovelRunner` takes an optional `projectId`; the CLI's
   `novel:run <project>` always passes it. A shared worker (API, Temporal) keeps claiming any run.
2. `advanceNovelRun` takes `leaseLost`: a `CANCELLED` error raised while the runner cannot prove its lease stops the
   run's advance **without writing** (outcome `stopped`, reason `lease_lost`). The run stays `planning`/`producing`
   and becomes claimable when the lease expires; completed steps replay from their checkpoints. An operator's pause or
   cancel (the lease still held) keeps its old outcome.
3. `novel:run` takes back a lease **its own process** lost — its runner id still on an in-progress run — after the
   lease expires plus five seconds, at most `--lease-retries` times (3 by default). It never waits on a lease another
   runner holds.

No policy changes; pinned policies replay unchanged.

## Alternatives considered

- **Retry the lease read before failing closed.** Rejected: failing closed on an unprovable lease is what keeps two
  runners from writing one run; the fix is to write nothing, not to guess ownership.
- **Filter by project in the CLI after claiming.** Rejected: the claim itself bumps the fence and takes the lease of
  another project's run.

## Consequences

- `llm_calls.cancellation.reason` still reads `operator_cancelled` for a call aborted by a lost lease (the gateway's
  durable-cancellation reason is fixed per call); the run's outcome and events now say `lease_lost`.
- Tests: `novel.integration.test.ts` (a planning call held open and aborted by the durable check: with a lost lease the
  run stays `planning`, otherwise it fails as before; a runner scoped to one project does not claim another's run, the
  scoped claim takes its own), `novel-lease.test.ts` (when the CLI takes a lease back), the privilege suite (the new
  function is executable by the application role only).
