# ADR-0132: Repair invalid serial schedules within the architecture budget

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for coherent bible pacing
- **Relates to:** ADR-0127, ADR-0131

## Context

A live architecture repair returned an episode crossing a season boundary. Deterministic validation correctly rejected it, but stopped before the remaining architecture repair attempts could use that error. Resume also lacked a semantic review for that generation and discarded its candidate.

## Decision

When the pinned policy enables architecture review, schema and serial-coverage validation failures consume the same bounded attempt budget as semantic findings. Persist the failed validation separately from model reviews, send the full candidate and concrete validation error to the next architect attempt, and run schema, coverage and semantic review again after repair. Invalid candidates never reach bible assembly or the critic. Exhaustion still stops planning.

Resume reads validation rejection artifacts alongside semantic reviews. For earlier runs which stopped before either artifact existed, it may recover a persisted blueprint schema/coverage rejection and the matching architect output. Other errors retain their existing behavior. Earlier policies without the architecture-review setting retain immediate validation failure.

## Consequences

Malformed schedules can be repaired without silently changing their authored ranges. The number of attempts remains policy-controlled, rejected candidates remain auditable, and acceptance invariants are unchanged. Integration coverage checks schema and season-boundary repair, exhaustion and resumption without treating invalid designs as reviewed.
