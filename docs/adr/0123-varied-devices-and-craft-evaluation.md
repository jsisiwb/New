# ADR-0123: Varied devices and craft evaluation

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request; engineering implementation
- **Relates to:** ADR-0041, ADR-0054, ADR-0081, ADR-0118

## Context

The operator's comparative reading identifies rushed openings, interchangeable protagonists, repeated academy plots, thin settings and mechanical comedy. The repository contains unused reader-craft helpers and policy fields, without runtime wiring or released prompts. Passing continuity and language checks alone does not establish engaging fiction.

## Decision

Contracts record devices.comedy and devices.small_risk using the existing schema. Freeze a ledger of previous accepted contracts for planner and critic. Repetition is evidence to consider, not an automatic ban on running jokes or a requirement for comedy. A small risk is motivated by the established character and world. Judges cite actual reader confusion, interchangeable voice, empty setting or repeated mechanisms; unfamiliar choices are not defects by themselves. Korean ending variation follows tense, viewpoint and rhythm, never suffix substitution to game lint.

Release immutable prompt versions at `4.12.0` and `standard.v38`, based on `standard.v37`. Enable the existing opening, distinct_stories, voice_cards, device_ledger and setting_notes policy fields for new Korean projects. Existing policy pins retain their behavior. The CLI default for new novels advances to this policy. There are no new quality thresholds or relaxed canon, reveal, approval or length gates.

## Consequences

Craft intent travels through existing structured design fields and explicit prompt inputs. Regression tests cover policy isolation, context propagation, snapshot scope and rendering. Automated checks establish wiring and invariants; a fresh provider-generated comparative reading is still needed to judge prose improvement.
