# ADR-0111: A scene that mixes 존대 and 반말 inside quotations beyond the operator's band is re-drafted once, `standard.v31`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0060 (the deterministic dialogue register report the voice judge reads), ADR-0090 and ADR-0097
  (per-scene re-drafts), ADR-0106, `docs/08-delivery/13-live-run-gemini.md` §14 (G16-2), §17.

## Context

- **G16-2 again, and now alone.** G20r (regression, `standard@29`) reached 0 blocking / 0 majors in chapter 1 — the
  checker agreement of ADR-0106 left no finding standing — and stopped on the voice gate: 69 at r0, 70.5 at r3, against
  76. G16r (`standard@27`) failed the same gate in every round (56–69).
- **What caps the score.** The voice judge reads the deterministic register report (`checkDialogueRegister`): an
  utterance whose sentences end in both a polite level (합쇼체, 해요체) and 반말 inside one quotation. Its rubric allows
  `register_consistency` no more than 3 when the report's mixed utterances are not deliberate. G20r's versions carried
  6 such utterances in 5,000–6,000자 (0.94 per 1,000자) — e.g. a pawnshop owner's “…원요. 낼 돈은 있고?”. The revision
  loop does not target them: the judge's `register_error` majors were one-reading severities (ADR-0100 recorded them as
  minor), so no round was aimed at the lines that kept the score down, and every patched version was quarantined.
- **The operator's band, measured with the same check** over the 656 Korean main-story chapters: 0 mixed utterances
  at the median (56 % of chapters have none), 4 at p90, **0.725 per 1,000자 at p90**. Mixing is part of the operator's
  voice in small doses; six in a chapter is above it.

## Decision

`standard.v31` = `standard.v30` + **`drafting.register_redraft: {per_1k_max: 0.725}`**. After a Korean scene is drafted
(and after the pronoun re-draft), the register report is run on it. A scene with more mixed utterances than
`max(1, floor(per_1k_max × its 자 / 1,000))` (`registerMixAllowance`) is re-drafted once (activity
`scene_draft:<n>:<scene>:register`) with a note that quotes the mixed utterances (at most eight) and states the rule: each
character keeps the cast card's dialogue register toward each addressee, one level per addressee within a scene, a shift
only after an on-page trigger (provocation, a revealed rank, a changed relationship) and kept afterwards, and no switch
inside one utterance; the scene's events, beats and length stay (`registerRedraftNote`). The re-draft is kept only when
it mixes fewer utterances. Counted as `register_redraft`.

The voice judge, its rubric and the voice gate are unchanged. The report and the band are the ones the judge already
uses and the operator's own chapters set.

## Alternatives considered

- **A lint finding for every mixed utterance.** Rejected: the operator mixes in 44 % of chapters; flagging each one
  would push the prose away from the operator's voice. The re-draft acts only above the operator's p90.
- **Stronger wording in the writer's prompt (a new prompt version).** Deferred: the writer already has the address and
  register summary and a register rule; what it lacks is feedback on the lines it actually wrote.
- **Grant G20r more rounds.** Not chosen as the fix: its patches did not reach the voice gate in five rounds, because
  the loop never aimed at the mixed lines.

## Consequences

- A scene's mixed utterances above the operator's band are rewritten before the chapter is evaluated, at the cost of one
  writer call per such scene.
- Tests: `register-redraft.test.ts` (the allowance scales with length and is at least one; the note quotes the
  utterances and is Korean only), `novel-ko.integration.test.ts` (a simulated writer mixing three utterances per scene:
  kept under `standard.v30`, re-drafted once per scene and replaced under `standard.v31`), `policy.test.ts` (v31),
  `commands.test.ts`.
