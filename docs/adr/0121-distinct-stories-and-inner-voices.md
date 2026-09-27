# ADR-0121: Distinct stories and inner voices

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request; engineering implementation
- **Relates to:** ADR-0041, ADR-0054, ADR-0081, ADR-0118

## Context

The operator's comparative reading identifies rushed openings, interchangeable protagonists, repeated academy plots, thin settings and mechanical comedy. The repository contains unused reader-craft helpers and policy fields, without runtime wiring or released prompts. Passing continuity and language checks alone does not establish engaging fiction.

## Decision

Freeze comparison context from approved concepts and accepted first-chapter contracts of other projects in the same workspace. New candidates also read earlier candidates in their own round. Use these as negative structural references, never canon. Select by workspace, exclude the current project, and reuse stored snapshots on resume. Preserve hard user requirements; differentiate causal sequence, motives, costs and relationships rather than names. Character designs supply an inner_voice card; writer and voice judge both receive it, including pressure response.

Release immutable prompt versions at `4.12.0` and `standard.v38`, based on `standard.v37`. Enable the existing opening, distinct_stories, voice_cards, device_ledger and setting_notes policy fields for new Korean projects. Existing policy pins retain their behavior. The CLI default for new novels advances to this policy. There are no new quality thresholds or relaxed canon, reveal, approval or length gates.

Enabled designer cards are validated before bible persistence. Missing or malformed required craft content follows the existing rejected-design regeneration path; earlier policies accept their legacy shapes.

## Consequences

Craft intent travels through existing structured design fields and explicit prompt inputs. Regression tests cover policy isolation, context propagation, snapshot scope and rendering. Automated checks establish wiring and invariants; a fresh provider-generated comparative reading is still needed to judge prose improvement.
