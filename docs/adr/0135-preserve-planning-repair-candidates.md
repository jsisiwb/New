# ADR-0135: Preserve the candidate across chapter and scene repairs

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for permanent causal planning fixes
- **Relates to:** ADR-0117, ADR-0129, ADR-0131

## Context

Live chapter and scene repairs alternated between missing arrival reactions and a weapon-location conflict. Repair calls carried criticism but omitted the candidate that the criticism described. Each attempt reconstructed a plan from the original context and could discard earlier corrections. Contract selection also preferred the original plan when later valid repairs had an equal count of serious findings.

## Decision

For Korean projects on the architecture-review policy path, include the latest valid candidate as explicitly PLANNED repair context alongside findings. Preserve valid updates between contract repair attempts; invalid output never becomes the next baseline or selected contract. Dialogue-partner repair also receives the contract it is repairing. Scene repair receives the current normalized scene plan.

Contract selection still minimizes serious findings. On a tie without an increase in blocking findings, this policy path prefers the latest valid, reviewed candidate so previously corrected details are not discarded merely because a different issue remains. Unresolved findings stay recorded and manuscript acceptance checks still apply. Earlier pins and non-Korean projects retain their previous request bytes and tie behavior. Repair budgets do not change.

## Consequences

Repair calls gain candidate context and may use more input tokens. The preserved plan is not accepted history and cannot override canon or hard requirements. Tests exercise two successive repairs, candidate propagation, tie selection, invalid-candidate exclusion and old-policy behavior.
