# ADR-0120: Reader-oriented openings

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request; engineering implementation
- **Relates to:** ADR-0041, ADR-0054, ADR-0081, ADR-0118

## Context

The operator's comparative reading identifies rushed openings, interchangeable protagonists, repeated academy plots, thin settings and mechanical comedy. The repository contains unused reader-craft helpers and policy fields, without runtime wiring or released prompts. Passing continuity and language checks alone does not establish engaging fiction.

## Decision

Opening chapters must establish the POV character, current place and circumstances, immediate desire, stakes and the rule needed to understand the first choice. An early hook may be a concrete uncertainty or relationship tension. It does not require the main crisis or a power reveal in the first sentences. The policy opening window is guidance, not a fixed chapter-by-chapter plot. Wire the existing opening helpers into the arc, contract, scene, writer and critic calls, including rewrites.

Release immutable prompt versions at `4.12.0` and `standard.v38`, based on `standard.v37`. Enable the existing opening, distinct_stories, voice_cards, device_ledger and setting_notes policy fields for new Korean projects. Existing policy pins retain their behavior. The CLI default for new novels advances to this policy. There are no new quality thresholds or relaxed canon, reveal, approval or length gates.

## Consequences

Craft intent travels through existing structured design fields and explicit prompt inputs. Regression tests cover policy isolation, context propagation, snapshot scope and rendering. Automated checks establish wiring and invariants; a fresh provider-generated comparative reading is still needed to judge prose improvement.
