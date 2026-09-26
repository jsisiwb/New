# ADR-0116: A finding that survives its patches is escalated, `standard.v35`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0087 (the scene-rewrite rung), ADR-0092 / ADR-0093 (`no_repeat`, `switch_rung`), ADR-0114,
  ADR-0115 (the finding ledger), `docs/08-delivery/13-live-run-gemini.md` §18–§19.

## Context

**G21-1.** G21r's confirmation found a real slip that a second reading kept: the money goes into the coat pocket and
comes out of a plastic bag. The stored patches (`13-live-run-gemini.md` §19.2) show each round rewriting the quoted
sentence while the contradiction moved to the next place — r8 made it “the bag stuffed in the pocket”, r9 fixed that
sentence while the next still opened the bag, r10 removed it — and the chapter ended at the cap on a new slip. The rounds
were kept, since other findings improved. The ladder escalates only a *quarantined* attempt
(`no_repeat`, `switch_rung`: a round on the same parent and targets takes the untried rung). A kept round that leaves one
finding in place is not an attempt that failed, so the same patch rung comes back every round. Under ADR-0115 the ledger
keeps such a finding open for as long as its text stands, which makes the repetition certain rather than likely.

## Decision

`standard.v35` = `standard.v34` + **`revision.ladder.escalate_after_patches: 2`** (starting value, `standard.v35`).

- A finding's identity across versions is its evaluator and the text of the paragraphs it quotes (its kind when it
  quotes nothing); a finding whose paragraph a patch edited but whose quote remains is the same finding.
- After a kept round, each finding that round targeted and that is still open has survived one more patch round.
- The next round's reviser note for a survivor says so: change the quoted sentence itself, and both places of a
  contradiction.
- A finding that survived `escalate_after_patches` kept rounds is answered by drafting the scene holding it again, while
  `max_scene_rewrites` allows.
- A quarantined attempt is still never repeated (ADR-0092 / ADR-0093); the regression check, gates and cap are unchanged.

## Alternatives considered

- **Escalate inside one round (patch, verified patch, scene re-draft before the round counts).** Deferred: it needs
  intermediate versions and readings that no round accounts for, and the ledger's re-reading after every round already
  verifies a patch against the evaluator that raised the finding.
- **Drop a patch whose text repeats an earlier ineffective one.** Not needed on top of the note and the scene rung; the
  simulated reviser shows the note reaching the second attempt.

## Consequences

- A real slip that the reviser keeps missing reaches the scene rung by the third round instead of lasting to the cap.
- Tests: `escalation.test.ts` (identity across versions, including a paragraph edited around the quote; survival tally;
  the stuck targets; the note), `novel-ko.integration.test.ts` (a slip that survives a kept round: the reviser is told so
  in round 2 under `standard.v35`, not under `standard.v34`), `policy.test.ts` (v35), `commands.test.ts`. In the simulated
  run the second attempt is quarantined and the existing `switch_rung` re-drafts the scene under both policies, so the
  scene rung after two *kept* surviving rounds is covered by the unit tests only; the live A/B is **BLOCKED** in run 4.
