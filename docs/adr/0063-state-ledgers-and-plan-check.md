# ADR-0063: State ledgers from accepted canon, draft checks against them, and a pre-draft plan check

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0010 (tiered packs), ADR-0040 (story clock), ADR-0056 (Korean style lint), ADR-0060
  (evaluation v2, register report), ADR-0061 (long-story memory, first meetings), the Step 0 improvement audit
  (§4.3, §4.4)

## Context

At 200 화 the continuity errors readers catch first are small and checkable: a countdown that jumps
(`D-7` one chapter, `열흘 남았다` the next), a status window whose fields change names, a junior who calls a
senior `선배님` in 반말, a character the canon records as dead walking on page, story time running backwards.
Canon already holds the underlying truth (bitemporal facts committed atomically at acceptance, events with
story clocks, relationships with register axes and address terms), but the writer read it only as long fact
lines, nothing compared a draft with it, and the only guard against a plan that contradicts canon was the
v4.2.0 writer's precedence rule (audit §4.4).

## Decision

1. **Ledgers are projections, not a second store.** `loadLedgers` (`@yeonjae/context`) derives four ledgers at
   the chapter's start from the pinned canon version and accepted text only:
   - **character state cards** for the on-page characters: location, condition, rank/level/stats,
     skills/titles, possessions, affiliation, goal, emotion (the `status.*`, `power.*`, `inventory.*`,
     `resource.*`, `affiliation.*`/`role.*` facts valid at the clock), dead or alive, last canonical appearance;
   - **story clock and countdowns**: the chapter's start and the previous chapter's last canonical event; the
     latest accepted countdown per target (`D-N`, `…까지 N일/열흘 남았다`; `N일 뒤` is a time skip, not a
     countdown), with the story days elapsed since when both clocks share a calendar;
   - **호칭/말높이 matrix** per directed pair of on-page speakers: registered address terms and the expected
     말높이 from the register axes (존댓말 at formality or deference ≥ 3; 반말 at ≤ 1 with familiarity ≥ 2);
   - **status-window format**: bracket style and field labels of the first accepted window.

   Because facts are committed in the acceptance transaction and read at a pinned version, the ledgers are
   "updated in the acceptance commit" and reproducible without new tables. A new `state_ledger` T1 section in
   `pack.scene_writer`, `pack.chapter_planner` and `pack.continuity_checker` renders them as compact Korean (or
   English) tables; those templates move to `1.2.0`. Checkpointed packs replay as stored.
2. **Draft checks (`evaluation.ledger_checks`).** A draft is compared with the ledgers deterministically:
   `CLOCK-COUNT-01` (major, continuity) a first mention of a countdown that disagrees with the ledger once the
   elapsed days are known; `CLOCK-COUNT-02` (minor) a countdown that grows; `FMT-WINDOW-01` (minor, genre) a
   window in another bracket style or with fewer than half of the ledger's labels; `FMT-WINDOW-02` (minor) more
   than one field on a line; `REG-ADDR-01` (minor, voice) an utterance that uses a registered address term but
   closes in the other 말높이 (존댓말 vs 반말). Findings become ordinary scorecard issues anchored to paragraphs, so the
   judges, the gates and the targeted reviser receive them.
3. **Pre-draft plan check (`planning.plan_check`).** Between the scene plan and the first draft, a checkpointed
   `plan_check` step compares the contract and scene plans with the ledgers, first meetings and the clock and
   records its findings as an artifact. `PLAN-DEAD-01` (an on-page character the ledger records as dead) and
   `PLAN-CLOCK-01` (story time running backwards from the previous chapter) are blocking: the chapter stops as
   `PLAN_INCONSISTENT`, an attention state like `APPROVAL_BLOCKED`, before any draft is written.
   `PLAN-COUNT-01` (a planned countdown that disagrees) and `PLAN-MEET-01` (a planned reunion of two characters
   who never met) are recorded, not blocking. The planner already reads the ledger in its pack, so most plans
   agree with it at the source.
4. **Opt-in by policy.** `standard.v3` is `standard.v2` plus `evaluation.ledger_checks: true` and
   `planning: { plan_check: true }` (starting values). A policy without them runs no ledger check and no plan
   check, byte-for-byte as before; the pack section applies to every new job through the template version.
X

## Alternatives considered

- **Ledger tables written in the acceptance transaction.** Rejected for now: they would duplicate facts that
  are already committed atomically and bitemporally, and need their own retraction and rollback paths.
- **Model-extracted countdowns and address terms.** Rejected: a countdown or a status-window label is exact
  text, and the check must be deterministic and replayable.
- **Re-planning automatically on a blocking finding.** Deferred: returning the findings to the planner needs a
  scene-planner version with a feedback slot. Until then a blocking finding stops the chapter for the operator
  instead of drafting a plan that contradicts canon.
- **Speaker attribution for every utterance.** Rejected: guessing speakers produces false findings. The
  address check reads only utterances that carry a registered term, which names the addressee.

## Consequences

- The writer, planner and checker see a character's state, the clock and the address terms as one short table
  instead of scattered fact lines; the Korean run's Latin-script scan covers the new section.
- Countdown and address-term regressions become scorecard issues with paragraph anchors; plan contradictions
  stop a chapter before any spend on drafting.
- Not built: re-planning with feedback, goal/emotion extraction (the cards show them only when canon carries
  `status.goal`/`status.emotion`), a place/direction ledger (canon has no structured directions), and model
  checks of possessions against actions. Countdown labels are the 어절 before `까지`; a countdown named two ways
  is two countdowns.
