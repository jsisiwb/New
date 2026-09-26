# ADR-0109: Unattended runs, part 2 — the runner resumes a curable failure itself, a lost lease is recorded as such

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0072 (status file, stuck runs), ADR-0091 (unattended runs, part 1), ADR-0107 (a rejected
  extraction is asked again), `docs/08-delivery/13-live-run-gemini.md` §14 (the bridge outages).

## Context

Run 2's bridge failed every probe from 18:54 to about 19:25 UTC and from 21:15 to about 22:10 UTC, and rate-limited
two of its six workspaces at 23:15. Every call the gateway gave up on left its run `failed` with a retryable
`MODEL_CALL_FAILED` (`PROVIDER_FAILED … [failure_class=retryable_provider]`, recommended action `retry_step`) until an
operator typed `novel:resume`. The unattended batch the operator's plan asks for (chapters 6–15 on both projects) would
stop at the first outage. ADR-0091 also left one wrong label: a provider call aborted because the runner lost its
lease is recorded in `llm_calls.cancellation.reason` as `operator_cancelled`.

## Decision

1. **`novel:run <project> --auto-resume=N`** (with `--resume-base-sec`, default 120, and `--resume-max-sec`, default
   1,800). When the run comes to rest `failed`, `autoResumeDecision` decides whether a resume can cure it: a model call
   the gateway gave up on or a concurrent call (both recommending `retry_step`), and a rejected extraction, which a
   resume asks again (ADR-0107). The runner then waits `base × 2^k` (twice that when the failure names a rate limit or
   a throttled class), capped at the maximum, writes the wait into the status file (`waiting: {reason, resume_at}`),
   and resumes the run with the reason in the `run.resumed` event (`auto-resume: MODEL_CALL_FAILED: resume 2 of 6`).
   At most N resumes per process. A budget stop, a cancellation, a pack that does not fit, an invalid plan, an
   internal fault and every run resting for attention, pause or completion are left to the operator as before.
2. **A lost lease aborts in-flight calls as `lease_lost`.** The runner passes an abort signal labelled `lease_lost` to
   the run (`advanceNovelRun(…, { cancelSignals })`, into planning and chapter production), and aborts it before it
   reports the lease lost, so the gateway's first-wins cancellation records the right reason. An operator's cancel
   still reads `operator_cancelled`.

No policy changes: the runner decides when to resume, never what a step does, and every resumed step replays its
recorded calls as before. Leases, fences and the stuck-run rule (ADR-0072, ADR-0091) are unchanged; a run waiting to
resume is `failed`, so it is never mistaken for a stuck one.

## Alternatives considered

- **Resume every failure.** Rejected: a budget stop, a cancellation or an invalid plan would be retried into the same
  result, spending calls each time.
- **Probe the bridge before resuming.** Deferred: a probe costs four calls and a failed resume costs at most the
  gateway's own retries; the doubling wait already spaces attempts out.
- **Retry inside the gateway for longer.** Rejected: the gateway's retry budget bounds one call's spend; a half-hour
  outage belongs to the run, which can wait without holding a call open.

## Consequences

- An unattended batch survives bridge outages and rate limits up to its resume budget, and the event log and status
  file say why it waited.
- The cancellation audit tells a lost lease from an operator's cancel.
- Tests: `auto-resume.test.ts` (which failures resume, the doubling and throttled waits, the budget),
  `novel.integration.test.ts` (a planning call aborted by the runner's lost lease is recorded as `lease_lost`; without
  the labelled signal it read `operator_cancelled`).
