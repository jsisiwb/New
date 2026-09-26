# ADR-0099: Story-spec requirement categories read as the schema knows them, `standard.v26`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0094 (arc-plan stances), ADR-0096 (arc-plan beat types), `docs/08-delivery/13-live-run-gemini.md`
  §13.

## Context

- **G15-1: a category outside the schema fails `novel:start`.** G15a's requirement interpreter typed its third
  requirement `relationship`. That category is not in the story-spec schema (`/items/2/category`, `SPEC_INVALID` at
  `story_spec`, the first model call of a project), and a retry replays the recorded answer. It is the third live instance
  of one class, after G11-1 (a stance) and G13-1 (a beat type).
- **Two categories carry behaviour.** The first `genre` item is read as the primary genre, and hard
  `forbidden_development` items become the contract's must-not guards. Every other category is only rendered.

## Decision

`standard.v26` = `standard.v25` + **`planning.normalize_spec_categories`**: each requirement's category is read as the
schema knows it (`specCategoryOf`). An exact category stays, and an interpreter's word becomes its nearest category
(`relationship` → character, `setting` → world, `taboo` → forbidden_development). Anything else becomes `other`, the
schema's own catch-all. A sub-genre is never mapped to `genre`. The requirement's text, kind and scope are untouched.

No gate threshold moves.

## Alternatives considered

- **Put the enum in the interpreter's output shape, so the gateway's bounded repair re-asks.** Rejected here: the shape is
  rendered into the prompt, and changing it changes every project's prompt bytes. The normalization is data-preserving
  because the schema has a catch-all.

## Consequences

- An interpreter's off-schema category no longer stops a new project at its first step.
- Tests: `planning.test.ts` (`specCategoryOf`), `policy.test.ts` (v26), `commands.test.ts`.
