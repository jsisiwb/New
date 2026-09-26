# ADR-0104: A chapter's own story-present reaches its last paragraph

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0007 (reality frames), ADR-0014 (the canon-delta verifier), ADR-0040 (the story clock),
  `docs/04-memory-canon/02-canon-and-temporal-state.md` §3, `docs/08-delivery/13-live-run-gemini.md` §15.

## Context

Once ADR-0103 let G17a's extraction through, the verifier rejected the delta. Its relationship item was dated
`valid_from 1.2`, and the contract's story time was `1.0 → 1.1`. The rejection was `FUTURE_VALIDITY`, "planned ≠
happened" (G17-4). The item was evidenced in the approved text of chapter 1 and was not a plan.

The two numbers come from different scales. `storyClock.ordinal` is "order within the chapter's story-present,
assigned by the extractor (paragraph order of the anchoring evidence by default)", and the extractor is told how many
paragraphs the chapter has. The planner writes the contract's window before any paragraph exists. Its prompt's example
window is `0 → 999`, and the fixture's is `0 → 99` over a chapter of 59 paragraphs. G17a's planner wrote `0 → 1`, so
any extractor ordinal above 1 read as the future. Any narrow window that the planner writes for its own chapter
rejects evidenced items the same way. A resume replays the same contract and delta.

## Decision

For the future-validity check at chapter acceptance, a window that the contract plans inside its own chapter ends no
earlier than that chapter's last paragraph: `clockMax = storyPresentEnd(story_time.end, chapter, paragraphs)`, with
the paragraph count taken from the approved version as the extractor was given it. A window that ends in another
chapter's story-present is used as written. A window already wider than the text is unchanged. The fixture's
`1.100` against `1.99` over 59 paragraphs is still rejected.

This applies to every project without a policy version. It corrects a comparison between two scales, and it moves no
claim from "planned" to "happened". A `valid_from` after the chapter's last paragraph, or in a later chapter, is still
future. Plan-frame items are still rejected, and extraction still never reads plans. The contract's window, its
rendering in packs, and every other verifier check are unchanged. In G17a, the resumed acceptance replays the contract
and the delta, and it commits with no new call.

## Alternatives considered

- **Widen the planner's window at planning time** to its prompt's `999`. Rejected as the fix: a contract already
  recorded (G17a's) is replayed as written, and the fixture's `0 → 99` window, which T11 relies on, would change.
- **Rescale the extractor's ordinals into the planner's window.** Rejected: five moments squeezed into ordinals 0 and 1
  become simultaneous, and two simultaneous changes to one attribute are a verifier conflict.
- **Compare only chapter numbers.** Rejected: it would drop the in-chapter check that T11 covers, a prediction dated
  after the chapter's last moment.

## Consequences

- An extraction whose in-chapter ordinals follow paragraph order is no longer rejected by a planner's narrow window.
- `docs/04-memory-canon/02-canon-and-temporal-state.md` §3 states the bound.
- Tests: `story-clock.test.ts` (G17a's window widened to the text; the fixture's window kept; a window in another
  chapter kept). `novel-ko.integration.test.ts` has a simulated `standard@28` run whose planner writes `1.0 → 1.1` and
  whose extractor dates a fact `1.2`. The fact is committed and the chapter accepted, and without the change the run
  fails with G17a's `FUTURE_VALIDITY`.
