# ADR-0074: Phase A live-run defects — a location for location-less contracts, calibrated name lint, POV-owned secrets

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0065 (lang/ko@5 lint), ADR-0070 (Phase A decisions), ADR-0072 (provider readiness),
  `docs/08-delivery/12-live-run-ws1-7.md` §7. Decisions 2 and 3 ship with the opt-in Korean-prose layer and
  policy (`lang/ko@6`, `standard.v7`) of the change that follows this one.

## Context

The first live Korean run on `standard.v6` (Notion bridge) went from intake to chapter 1's evaluation in
under an hour and stopped twice:

- **A-1.** The chapter planner returned `locations: []` — chapter 1 opens in a place the bible never
  registered — so every scene plan failed `SCENE_PLAN_INVALID` (each scene must stand in one of the
  contract's locations). The run failed.
- **A-2.** After three revision rounds the chapter ended `needs_attention: APPROVAL_BLOCKED` with prose
  38.3/78. Six of its ten majors were `KO-NAME-02` false positives: the rule compares every word with every
  registered name including aliases and short forms, and a jamo or two of distance matched ordinary words —
  독식해/독식자, 차가운/차강진, 수하/수아, 쓰기/쓰레기, 지구/지수, 곰탱/곰탱이. Their penalty collapsed the prose
  lint composite to 2 and every patch round started from it.
- **A-3.** Two blockings came from the knowledge-leak checker: the protagonist's own secret — that he is a
  regressor, the premise of a regression serial narrated in the first person — was listed as a reader
  secret not to be revealed before chapter 150.
- **A-4.** The same checker flagged the regressor using his future knowledge of a side character's secret
  (reveal chapter 15) in chapter 1, a scene the approved concept's chapter-one hook itself plans. The bible's
  secret schedule and the plan disagree.

## Decision

1. **A-1: a contract that names no location gets a registered one.** Only when the validated contract has
   `locations: []` — a case that always failed — the workflow picks the registered location the contract's
   own text mentions most (display name, alias, short form or first word), else the first registered
   location, adds a continuity risk that says so, and counts `contract_location_fallback`. Scene planning
   applies the same fallback to a contract locked before the fix, so the stuck run resumed from its
   checkpoints. A contract that names a location keeps its bytes.
2. **A-2: `KO-NAME-04` replaces `KO-NAME-02` in `lang/ko@6`.** Targets are full display names of three or
   four syllables only; a word's first syllables are compared (백도헌이었다 → 백도헌); one jamo of distance may
   span syllables (서지누 for 서진우), two only within a single syllable (차강친 for 차강진). All six live false
   positives pass; the lint receives display names separately. `lang/ko@5` is pinned and unchanged — its
   projects keep `KO-NAME-02`; new projects reach `lang/ko@6` through `standard.v7`.
3. **A-3: POV-owned secrets are the reader's** under `evaluation.pov_secrets_reader_visible`
   (`standard.v7`): the knowledge-leak checker's reader-secret list leaves out the chapter POV character's own
   secrets. Other secrets and every character-knowledge guard are unchanged.
4. **A-4 is recorded, not auto-fixed.** A regressor's future knowledge is a genre device the knowledge model
   has no notion of; the fix needs a design (who may know the future, and when the reader may learn what the
   regressor knows) and is left open with the live evidence.

## Alternatives considered

- **Editing `KO-NAME-02` in place** — rejected: `lang/ko@5` is pinned by live projects; moved rules ship as a
  new layer (ADR-0070 §3).
- **Failing the contract on `locations: []` and regenerating it** — rejected: the same prompt returns the
  same empty list, and the model cannot name a place the registry lacks.
- **Dropping reader-secret checks for regression projects** — rejected: other characters' secrets still
  need the guard.

## Consequences

- The v6 Phase A project stays blocked on its pinned `lang/ko@5` and is kept as the defect record; the
  continuation run uses a fresh project on `standard.v7`.
- A5 (Korean lint thresholds) now has live evidence: `KO-NAME-02` produced 6 false majors in one chapter.
