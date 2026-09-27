# ADR-0119: A rejected arc plan is asked again on resume

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0094 / ADR-0096 (arc-plan normalizers), ADR-0102 (the no-policy class of fixes), ADR-0107 (a
  rejected extraction asks again), ADR-0109 (auto-resume); `docs/08-delivery/13-live-run-gemini.md` §20.

## Context

**G25-1.** G25r's first arc plan (`standard@37`, 20:54 UTC) started its story time window at ordinal −1, and the arc-plan
schema requires at least 0: `ARC_PLAN_INVALID`, the run failed. The design steps before it (world, cast, blueprint) already
record a rejected answer (`planning_rejection`) and ask again under a new key on the next attempt (`runDesignStep`). The arc
plan did not: its step replays the recorded answer, so every resume fails the same way, and `ARC_PLAN_INVALID` was not a
code auto-resume would try. No project gets past a rejected arc plan.

## Decision

- The arc plan's rejection is recorded as a `planning_rejection` keyed by its activity id, and the next attempt asks the
  arc planner again as `arc_plan:<arc>:regeneration:<n>`, as the design steps do. The request itself is unchanged.
- That error carries `retry_step`, and auto-resume treats `ARC_PLAN_INVALID` with `retry_step` like a rejected extraction:
  asked again within the resume budget. `ARC_PLAN_INVALID` without it (no arc scheduled for the chapter, an incomplete
  plan) is still left to the operator.

No policy version (ADR-0102 class): a valid arc plan is stored and read exactly as before, so only runs that ended on a
rejected arc plan change, from a permanent stop to a new answer.

## Consequences

- G25r resumes on `standard@37`; its first arc plan stays recorded with its rejection.
- Tests: `novel-ko.integration.test.ts` (a `standard@37` run fails on the rejected plan, asks again on resume and accepts
  chapter 1; without this change the resume replays the rejection), `auto-resume.test.ts`.
