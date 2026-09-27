# ADR-0137: Repair overlapping relationship proposals before acceptance

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** live sequential chapter test
- **Relates to:** ADR-0038, ADR-0102, ADR-0107

## Context

A chapter-two extractor asserted an ally relationship while the same directed pair still had an open acquaintance relationship. The schema accepted the proposal, but the database correctly rejected its overlapping validity. Retrying acceptance replayed the completed extraction and could never repair it. Relationship context lacked the stored state identifier needed for an explicit transition.

## Decision

Preflight schema-valid relationship assertions against stored active relationship intervals before extraction completes. Give the extractor conflicting record identifiers, validity and the rejected candidate within its existing bounded extraction repair loop. A later clock alone does not prove a transition: the extractor must use manuscript evidence to propose an explicit close/supersede, or omit an unsupported assertion. Never silently convert assertions into transitions, drop evidence, or weaken database constraints.

Check previously completed extraction results too, unless their manuscript is already accepted. Record rejection and use a new extraction checkpoint, provider activity and delta artifact key on resume so the cached invalid proposal is not replayed. Keep raw prior artifacts. Reconciliation does not absorb a stale base canon version; the atomic optimistic check and evidence verification remain authoritative.

## Consequences

The change adds read queries and may consume the existing extraction repair budget. Unresolved overlap still blocks progress. Tests cover directed pairs, timelines, historical intervals, explicit transitions, retries, acceptance history and atomic rollback. No database migration is required.
