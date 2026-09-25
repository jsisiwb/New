# ADR-0105: An asserted fact without `valid_from` takes its item's clock

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (the canon-delta verifier), ADR-0038 (validity semantics), ADR-0040 (the story clock),
  `docs/04-memory-canon/02-canon-and-temporal-state.md` §1, `docs/08-delivery/13-live-run-gemini.md` §15.

## Context

With ADR-0104 in place, G17a's delta passed the verifier. The commit then failed inside `canon.commit_delta` with
`null value in column "valid_from" of relation "facts"` (G17-5). Two asserted facts, the hero's class and his measured
mana, carried `attribute`, `value_text` and an item `story_clock`, but no `valid_from` in their payloads.
`factProposal` requires only `entity_id` and `attribute`, because a `close` needs no more and "the closing clock is
the item's story_clock". A stored fact requires `valid_from`. The verifier did not check the difference, so the
failure surfaced as a database error (`ACCEPTANCE_FAILED`, recommended `retry_step`), and a retry replays the same
delta.

## Decision

1. **At chapter acceptance, an asserted or superseding fact without its own `valid_from` is valid from its item's
   `story_clock`,** the same clock a `close` uses. The filled delta is what the verifier checks, including future
   validity, and what the commit records.
2. **The verifier rejects an asserted or superseding fact that has neither clock** with `SCHEMA_INVALID` and the
   item's id, so the commit never meets it as a database error.

This applies to every project without a policy version. The clock filled in is the extractor's own date for the item,
so no claim is invented. A fact that has its own `valid_from` is unchanged, and so are events, relationships and
knowledge (whose proposals already require `valid_from`) and every other check. In G17a, the resumed acceptance replays
the delta and commits both facts at ordinal 4, the moment of the measurement their items name.

## Alternatives considered

- **Require `valid_from` in `factProposal` for `assert`.** Rejected: the schema is a published contract, and the
  extractor's answer would fail validation for a clock it has already given on the item.
- **Fill the clock in `canon.commit_delta`.** Rejected: that needs a migration that redefines the whole commit function,
  and the verifier would still check an unfilled delta.
- **Drop facts without a clock.** Rejected: they are evidenced claims, and a chapter's canon would silently lose them.

## Consequences

- Chapter acceptance no longer fails at the database on a fact dated only by its item.
- `docs/04-memory-canon/02-canon-and-temporal-state.md` §1 states the default.
- Tests: `verify.test.ts` (an undated fact filled from its item's clock and accepted; the same object back when there
  is nothing to fill; a fact with neither clock rejected with its id). `novel-ko.integration.test.ts` has a simulated
  `standard@28` run whose extractor gives a fact only its item's clock 1.3. The fact is committed at 1.3, and without
  change 1 the run is rejected with `SCHEMA_INVALID` for that item.
