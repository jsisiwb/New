# ADR-0112: A scene drafted far over its planned length is re-drafted once toward the target, `standard.v32`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0075 (scene length calibration), ADR-0093 (length findings rewritten in their scene), ADR-0097 and
  ADR-0111 (per-scene re-drafts), ADR-0106, `docs/08-delivery/13-live-run-gemini.md` §17.

## Context

- **G20-1.** G20a (academy, `standard@29`) planned chapter 1 as two scenes of 2,650자. The writer returned scene 1 at
  2,015자 and scene 2 at 5,421자, 2.05× its target, replaying an exchange the continuity and repetition judges both
  caught. The chapter came to 7,436자 (+40 %), a lint major. Five rounds did not bring it back: the scene rewrites that
  the length rung sends (ADR-0093) were quarantined, and v6 ended at 7,437자.
- **The lint major also held every other finding in place.** ADR-0106's second reading applies only when every blocking
  or major finding is a judge's or checker's reviewer-class finding, so a length major keeps one-reading findings
  blocking.
- **Calibration asks, it does not check.** ADR-0075 adjusts what each scene is asked for after the scenes before it;
  nothing looks at a scene once it is written.

## Decision

`standard.v32` = `standard.v31` + **`drafting.length_redraft: {over_ratio: 1.5}`**. A scene draft longer than
`over_ratio` × its planned length target (the stored plan's target, not the calibrated request) is re-drafted once
(activity `scene_draft:<n>:<scene>:length`). The note (`lengthRedraftNote`) gives the measured and target lengths and
asks the writer to cover every planned beat once within the target, without replaying an exchange, keeping the scene's
events and ending. The re-draft is kept only when it lands closer to the target. Counted as `length_redraft`.

The chapter's length gate and lint, the length rung and every other gate are unchanged.

## Alternatives considered

- **Cut the draft mechanically** (drop trailing paragraphs). Rejected: it would cut the scene's end, which carries the
  beat or the 절단.
- **Also re-draft short scenes.** Deferred: the calibration already asks later scenes to make up a short one, and no live
  chapter failed short.

## Consequences

- An overlong scene costs one writer call before evaluation instead of a chapter's rounds.
- Tests: `register-redraft.test.ts` (the note), `novel-ko.integration.test.ts` (a simulated writer padding every first
  draft to three times its length: kept under `standard.v31`, re-drafted once per scene and replaced under
  `standard.v32`), `policy.test.ts` (v32), `commands.test.ts`.
