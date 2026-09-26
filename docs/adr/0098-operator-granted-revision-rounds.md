# ADR-0098: Operator-granted revision rounds for a chapter that needs attention

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (regression check), ADR-0041 (the pinned Production Policy), ADR-0042 (the override matrix),
  ADR-0056 (Korean rounds), ADR-0072 (the novel run), ADR-0073 (the polish round), ADR-0086 (converging revision),
  `docs/08-delivery/13-live-run-gemini.md` §13.

## Context

- **Chapters stop one step short.** G14a ended its five rounds at overall 87 with all four dimension gates passing and
  one blocking and one major finding left, each on a single line (a status-window number against the bible's rule, one
  line of the heroine's in the wrong register). G14r ended at 88, all gates passing, with four majors. G11r's r0 (88, all
  gates, one blocking and one major) and G9r's r3 (0 blocking, 2 majors) had the same shape.
- **No path forward but an edit, an override or a new project.** The chapter job's id is deterministic
  (`chapter:<project>:<chapter>`), so `novel:resume` replays every recorded round and stops at the same
  `APPROVAL_BLOCKED`. The remaining actions are a manual edit, a reviewer override (recorded as
  `approved_with_overrides`, and not for a fact-bearing finding), or starting over with a new bible and plan. Policies are
  pinned per project, so a later policy's round budget never reaches the chapter either.
- **A latent stop in the polish round.** ADR-0073's polish round runs as round `n + 1` after the round `n` that first
  passes the gates, and the revision functions refused any round above `max_rounds`. A chapter first approvable in
  round 5 would have ended with `REVISION_LIMIT` instead of being polished and accepted.

## Decision

1. **`novel:extend <project> [--rounds=N] [--reason=<text>]`** (`extendChapterRevision`). For a run in
   `needs_attention`, the chapter it stopped on is granted N more revision rounds, by default the rest of the budget.
   The rounds granted to one chapter add up to at most the pinned policy's own `revision.max_rounds`, so no new number is
   introduced. The grant is recorded in the project's settings (`revision_extensions`, with each grant's time and
   reason) and as a `chapter.revision_extended` event, and the run is queued.
2. **The runner reads the grant** (`grantedRounds`) and passes it to the chapter job. The loop's bound and the revision
   functions' round limit grow by the granted rounds. The job replays its recorded rounds from their checkpoints and runs
   the new ones live; every round is evaluated, regression-checked and gated exactly as before.
3. **The polish round may follow the last round** (`roundLimit + 1`), with or without a grant.

Gates, the override matrix and the pinned policy are unchanged: an extended chapter is accepted only by passing them.

## Alternatives considered

- **Override the remaining findings.** Rejected for the run: overrides are a reviewer's judgment and leave the finding in
  the text; a fact-bearing one goes to the canon workflow anyway.
- **A policy knob that adds rounds automatically when the chapter is close.** Deferred: it reaches only projects created
  on a later policy, and "close" needs its own numbers; the operator action covers every project now.
- **Regenerate the chapter.** Rejected as the default: it discards a version that passes every gate, and the variance of
  a first draft is large (G14a r0 52, r5 87).

## Consequences

- A near-accepted chapter can be finished under its own policy for the cost of the extra rounds.
- Tests: `revision-extension.integration.test.ts` (the round limit and the polish round's allowance; grants refused on a
  producing run, recorded up to the budget and refused past it, with their events).
