# ADR-0113: The voice judge re-reads after any patch that changed dialogue, `standard.v33`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0060 (targeted re-evaluation), ADR-0084 (re-judging open majors), ADR-0086 (the confirmation),
  ADR-0100, `docs/08-delivery/13-live-run-gemini.md` §18.

## Context

**G22-1.** G22a (academy, `standard@32`) was approved twice in chapter 1: v3 at r2 and v5 at r5, the second at overall 91
with every gate passing (voice 80.5). Neither approval read the voice of the text it approved. Targeted re-evaluation
re-runs the targeted dimension's judge, the checkers when claims changed, and judges with open majors; the r3 and r4
patches aimed at structure, so the voice score of v4 and v5 was carried from v3's reading. The confirmation read v5 twice
(with ADR-0100's second reading) and put voice at 71.7 against its gate of 76: the patches had changed dialogue, and a
carried score cannot see that. Two rounds and a confirmation were spent on an approval the carried score gave.

## Decision

`standard.v33` = `standard.v32` + **`evaluation.voice_on_dialogue`**. Under targeted re-evaluation the voice judge
re-runs whenever the patched version differs from its parent in any quoted utterance (`dialogueChanged`: the multisets
of “…” utterances differ; narration and order do not count). Every other rule of `planReevaluation`, the gates and the
confirmation are unchanged.

## Alternatives considered

- **Re-run every judge after every patch.** Rejected: it multiplies the cost of every round, while voice is the one
  gated taste dimension that reads only dialogue, which a structure or prose patch often rewrites.
- **Drop the confirmation's authority.** Rejected: the confirmation was right; the carried score was the error.

## Consequences

- A round whose patch changed dialogue measures the voice of the text it keeps; a voice fall shows in that round, where
  the revision can aim at it, instead of at the confirmation.
- Tests: `evaluation-plan.test.ts` (the voice judge carried after a dialogue-neutral patch and re-run after a dialogue
  change; utterances compared as multisets), `policy.test.ts` (v33), `commands.test.ts`.
