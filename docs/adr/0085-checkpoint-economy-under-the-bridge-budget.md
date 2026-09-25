# ADR-0085: Checkpoint economy under the bridge budget — the recorded G5 run is the `standard@14` checkpoint

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0080 (bridge credits), ADR-0084 (`standard.v14`), `docs/08-delivery/13-live-run-gemini.md` §5.

## Context

The operator's plan for this run starts with a live checkpoint of `standard@14`: chapter 1 of the academy and the
regression project, recorded in the §8 format, before any new code. The handoff said that checkpoint was never run.

The permanent database says otherwise. Two projects, `G5a-acad-f14` and `G5r-regr-f14`, were created on
`policy/standard@14` at 01:56 UTC on 2026-09-25, 45 seconds after the Phase U + V2 commit (`c0f3b0e`, 01:55:30 UTC),
and ran chapter 1 to rest (`needs_attention`, four scorecards each, 95 calls together). The tree of that commit is
identical to the merged default branch (`git diff c0f3b0e e3eea3d` is empty): the later commits on the chain were
CI fixes already contained in it. The previous session ran out of credits before it recorded the runs.

The bridge budget binds this run. At its start the two workspaces read 76.50 % and 86.49 % of the billing period
that ends 2026-10-09, about 37 points together; a chapter-1 run from a fresh project costs 3.2–4.1 points (§1, §3,
§4), a pair about 8. Every prose-changing step of the plan asks for a pair on both projects.

## Decision

1. **G5 is the `standard@14` checkpoint (STEP 1).** Its scorecards, regression reports, scene plans, drafts and
   likeness are read from the database and recorded in `13-live-run-gemini.md` §5; its run reports and findings are
   exported to `ops/live-runs/g5-standard14/`. The nine defects it shows (G5-1 … G5-9) are the work list of the next
   policies.
2. **A policy is checked live once, on the run that would come next anyway.** When a step changes prose behaviour,
   its checkpoint is chapter 1 of both projects on the new policy; when two steps land before any credit is spent,
   they share one policy and one checkpoint. Phase N runs (chapters 2 onward) are the checkpoints of the policy they
   run on, and each is recorded in the same format.
3. **Spend is recorded per phase** (`bridge:credits` before and after), and a phase that would take the budget
   below what one accepted-chapter attempt needs (about 4 points) stops spending and records BLOCKED.

## Alternatives considered

- **Run the `standard@14` pair again.** Rejected: it would spend about 8 points (a fifth of what is left) to measure a
  tree that has already been measured, and one more sample of the same pipeline tells less than one sample of the
  next one. G5's two runs differ from G4's in exactly the ADR-0084 changes, which is what the checkpoint is for.
- **Checkpoint every step separately.** Rejected while the budget binds: two pairs of fresh projects per step would
  exhaust the billing period before Phase N produced an accepted chapter, which is the run's goal.
- **Skip live checkpoints and rely on simulated runs.** Rejected: the defects that block acceptance (G5-1 … G5-3) are
  properties of the model's answers; only live runs show them.

## Consequences

- STEP 1 costs no credits; its evidence is the recorded G5 pair.
- Fewer live samples per policy: a checkpoint is one chapter per project, so a single run's variance is not
  measured. Every recorded run names its policy, so later comparisons stay per policy.
- `ops/live-runs/` holds exported run output; `.prettierignore` excludes it (pipeline prose is never reflowed,
  AGENTS.md rule 4).
