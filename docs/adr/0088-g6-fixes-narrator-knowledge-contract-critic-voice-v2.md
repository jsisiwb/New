# ADR-0088: The G6 fixes — the narrator's remembered knowledge is the reader's, the contract is critiqued, the operator voice v2 for judges, five revision rounds, `standard.v17`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0083 (the operator voice), ADR-0086 (`standard.v15`), ADR-0087 (`standard.v16`),
  `docs/08-delivery/13-live-run-gemini.md` §6 (G6).

## Context

The `standard@15` checkpoint (G6) moved both projects: no premise-as-secret finding and no talk finding at r0 in
either; the academy chapter converged from 1 blocking / 8 majors to 0 / 1 with all four gates passing (r2, no round
quarantined). Neither chapter was accepted. What stopped them:

- **G6-1 (regression, three blocking reader-secret findings):** the hero thinks about what he remembers from his
  prior life — another character's S-rank elixir, a thug's embezzlement — against bible reader dates of 3, 5 and 8.
  The reveal schedule gave the reader only the narrator's *own* secrets from 화 1; secrets he *knows* from a prior
  life stayed hidden, and for one of them the bible did not list him as a knower at all. The operator's readers hold
  the hero's game and future knowledge (`operator-voice-analysis.md` §3, §7–§8: the heroine's doomed fate is told as
  the hero's knowledge at her entrance; the 착각 runs on what the reader knows).
- **G6-2 (regression):** the contract's hook was built on that remembered fact; the plan critic flagged contract-level
  defects, but ADR-0086 repaired only scene plans.
- **G6-3 (academy, blocking):** one dialogue line written twice in a row and an entrance narrated twice across a scene
  boundary.
- **G6-4 (academy):** `원작 주인공` twice in a game-possession serial (`KO-DEVICE-01`): the cast designer's brief asks
  for each heroine's fate "in the 원작, with the 원작 주인공" whatever the device.
- **G6-5 (academy r3):** after the third patch the full re-evaluation raised seven majors on text earlier rounds had
  judged clean: five for single uses of 그/그녀 (the draft's rate, about one per 1,000자, is inside the operator's
  first-person band: median 1.51, p90 2.57) and one weak ending for a comic-deflection cut the contract had asked for
  (the operator ends about 40 % of book 2's 화 1–25 on comic or irony cuts). The policy's three rounds were spent.

## Decision

`standard.v17` = `standard.v16` +:

1. `planning.reveal_schedule.narrator_knowledge`: a secret in the prior-life or source-work layer that the first-person
   narrator knows is the reader's from 화 1 unless the bible dates it for the reader; other characters keep the bible's
   date (G6-1).
2. `planning.plan_critic.contract`: the contract is critiqued before any scene is planned and sent back to the chapter
   planner once on a blocking or major finding (G6-2).
3. `drafting.dedupe_repeated_lines`: a line of at least ten characters with a space that repeats the line before it
   word for word is dropped at assembly; short sound lines may repeat on purpose (G6-3).
4. Prompt family 4.8.0 (`character_designer` only): the hero is a knower of what he remembers; a heroine's remembered
   fate is written in the device's own words (G6-1, G6-4).
5. `identity.voice_profile: voice/operator@2`: v1 plus two judge lines from the corpus — a few 그/그녀 in a first-person
   화 are the operator's usage (flag only when they stack), and a comic or irony cut that leaves the next-화 question is
   not a weak cut — and the writer line "그/그녀 at most once or twice per 1,000자" (G6-5).
6. `revision.max_rounds` and `rounds_by_language.ko` 5 (from 3): a revision budget, not a gate; under ADR-0086 a
   round keeps only versions that break nothing they touched, so more rounds cannot make the chapter worse (G6-5).

No gate threshold moves.

## Alternatives considered

- **Let the bible's reader dates bind the hero's remembered knowledge.** Rejected: it contradicts the operator's
  practice and makes every 회귀물 chapter that uses the hero's advantage a leak.
- **Second-sample confirmation of new majors on unchanged text.** Considered for G6-5; deferred. The measurable part of
  G6-5 was calibration (the operator's own pronoun band and cut types), which a judge line fixes without extra calls.
- **Raising `gates.major_max` or ignoring pronoun findings deterministically.** Rejected (rule 5): judges still flag
  pronouns that stack.

## Consequences

- A chapter costs one more critic call (the contract) and at most two more revision rounds.
- Tests: `reveal-schedule.test.ts` (narrator knowledge), `plan-prevention.test.ts` (repeated lines),
  `policy.test.ts` (v17 = v16 + the listed changes, gates unchanged), `registry.test.ts` (4.8.0 changes only the cast
  designer), `voice.test.ts` (v2), `novel-ko.integration.test.ts` (a simulated run under v17: one contract critique per
  chapter before the scene critique; the 4.8.0 designer).
