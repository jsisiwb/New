# ADR-0133: Reject placeholder serial architecture deterministically

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for a usable novel bible
- **Relates to:** ADR-0127, ADR-0131, ADR-0132

## Context

A live response replaced arrival, episode and opening-chapter fields with repeated administrative filler. The JSON and coverage were valid, and the model critic returned no serious findings. Valid shape and a clean model review did not establish authored story content.

## Decision

Policies enabling architecture review also validate authored serial content before invoking the critic. Reject explicit placeholder-only values and narrative objects that repeat one value across three or more distinct narrative fields. Compare values after case and whitespace normalization. Check arrival, each episode and each opening brief separately; repeating a preceding chapter's exit as the next entry remains legal. Return the exact affected fields through the existing bounded validation-repair path. Do not substitute generated defaults or silently approve filler.

The check does not claim to judge literary quality, prescribe prose length or require Korean script in every field. It detects empty work disguised as completed work. Existing policies without the architecture-review setting retain their behavior.

## Consequences

Model reviewers remain fallible. Deterministic content validation supplements schema, coverage and semantic review; manual reading still matters. A previously assembled placeholder bible is retained as rejected diagnostic evidence and is not used for the final chapter test.
