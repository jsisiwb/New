# ADR-0101: Larger continuity-checker and extractor pack budgets, `standard.v28`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0041 (the pinned Production Policy), ADR-0092 (the reveal schedule in every canon line), ADR-0094
  (secret owners named in canon lines), `docs/08-delivery/13-live-run-gemini.md` §14.

## Context

- **G16-1: a chapter too large for its checker's pack.** G16a's first draft reached evaluation, and the continuity
  checker's pack failed (`PACK_FAILED`). Its critical context still needed 35,114 tokens after the degradation ladder,
  against the pinned budget of 34,000. That context is critical by design (T1 is never dropped): the chapter, the
  participants' registry and the canon lines. A resume replays the same draft into the same pack, so the project cannot
  pass its first evaluation.
- **The budgets predate the richer canon lines.** `context.input_budget_tokens` has been 34,000 for
  `pack.continuity_checker` and 30,000 for `pack.extractor` since at least `standard@20`. Since then every canon line has
  gained the reveal schedule's two dates (ADR-0092) and its secret's owners (ADR-0094), and the academy designer's
  bibles have grown (G16a: 27 propositions, 14 organizations). The extractor's pack carries the same chapter and
  registry at acceptance and has the smaller budget.

## Decision

`standard.v28` = `standard.v27` with `context.input_budget_tokens` raised: `pack.continuity_checker` 34,000 → 48,000 and
`pack.extractor` 30,000 → 44,000. The budgets stay caps: a pack uses only what its items need. The pooled model takes
inputs well above both.

## Alternatives considered

- **Demote part of the canon lines from T1.** Rejected: the continuity checker's job is to compare the chapter with
  canon, and the dates and owners are what G9-1 and G10-5 needed.
- **Split the participant set.** Rejected for chapter 1: the cast of a first chapter is the premise's.

## Consequences

- A larger bible no longer stops a new project at its first evaluation or at extraction. G16a stays pinned to
  `standard@27`.
- Tests: `policy.test.ts` (v28), `commands.test.ts`.
