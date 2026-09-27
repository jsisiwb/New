# ADR-0124: Craft identity does not prescribe the protagonist's personality

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request; engineering after live concept validation
- **Relates to:** ADR-0027, ADR-0041, ADR-0081, ADR-0120, ADR-0121, ADR-0122, ADR-0123

## Context

A live Notion run with the original academy intake on `standard.v38` read `concept_generator@4.12.0` and the comparison snapshot. Both candidates still proposed a detached, bored protagonist and exaggerated reactions. The shared academy overlay prescribes ridicule, hidden-power reversals and shock; the regression overlay prescribes cynical or self-deprecating interiority; the operator voice profile prescribes a particular comic personality. Prompt additions conflict with these higher-level defaults.

## Decision

Release `standard.v39`, based on the now-used immutable `standard.v38`, and make it the shared CLI/API default for new projects. Keep the low-level database default for historical fixtures; explicit CLI policy pins and existing project pins remain unchanged. It explicitly selects `tradition/kr-webnovel@4`, `genre/academy@4`, `genre/regression@5`, `genre/harem@3`, and `voice/operator@4`. Add `identity.tradition_layer` to the policy schema and pass it through intake composition. Cap automatic composition at the pre-existing tradition and genre versions so new profiles cannot change old policies. English composition retains its existing tradition.

The new layers retain Korean serialization, existing numeric thresholds, knowledge rules and user requirements while treating power level, temperament, comic role and emotional attachments as independent choices. The opening hook can be an intelligible personal problem; a crisis is not required before orientation. Reaction cuts and misunderstandings are available devices, not obligatory payoffs. The voice profile's revised qualitative guidance is an editorial response to the operator's reading, not a claim of new corpus measurements.

`concept_generator@4.13.0` first commits to a concrete personal motive and distinctive attention before designing the opening. `requirement_interpreter@4.13.0` explicitly distinguishes supplied power/genre requirements from inferred personality and plot events. Other craft roles retain `4.12.0`.

## Consequences

A fresh live project is required to validate the changed identity; the first live test's pins and unsatisfactory candidates remain as evidence. Regression tests cover explicit profile selection, old-policy composition and English isolation. A model can still make weak choices; this change removes contradictory instructions rather than claiming a quality guarantee.
