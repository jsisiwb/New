# ADR-0134: Give architecture review the bible design it must preserve

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for coherent bible setup
- **Relates to:** ADR-0131, ADR-0133

## Context

A live chapter critic found a location conflict: the world design placed confiscated equipment inside the protagonist's starting warehouse, while the blueprint sent him outside to retrieve it. The architect had received the bible design, but the architecture critic received only the story spec, blueprint and promises. It could compare schedules but could not reliably check the design they depended on.

## Decision

Include the same rendered bible design, entity registry and propositions supplied to the architect as explicit `bible_context` alongside the blueprint and promises in every architecture review input. Retain its planned/factual source labels. This is input context, not a new blueprint schema field or a mutation of the stored blueprint. It applies only to the existing architecture-review policy path; old policies still make no such calls.

## Consequences

The reviewer can compare opening and episode assumptions with character, place and power-system constraints. Additional context increases review input size. Boundary integration checks require actual character-voice and world-detail values in both initial and repair review calls. A supplied context is not proof that a model will catch every conflict; accepted-history precedence and downstream checks remain necessary.
