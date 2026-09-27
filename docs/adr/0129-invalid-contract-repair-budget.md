# ADR-0129: Use the remaining contract repair budget

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** live arrival verification
- **Relates to:** ADR-0117, ADR-0118, ADR-0128

## Context

A live critic correctly requested a missing arrival verification step. Its repair removed the required on-page conversation partner. The recritique loop discarded that attempt and stopped despite having another configured repair attempt available. The valid original remained selected, but the requested correction was never given the remaining chance to succeed.

## Decision

Within the existing policy-gated contract recritique loop, an invalid attempt consumes one attempt and contributes its validation errors to the next attempt's feedback alongside the unresolved critic findings. A missing required partner is such an error. Invalid candidates are never critiqued or selected. Valid candidates continue to compete by the existing serious-finding count, and the original remains the fallback when all repairs fail. Use the pinned maximum; do not add attempts or relax contract validation, dialogue requirements or acceptance gates. The earlier one-repair path is unchanged.

## Consequences

Exercise recovery after an invalid first repair and exhaustion after all invalid repairs through the actual workflow. In-flight runs keep the code loaded when they started; a prior live result does not verify this follow-up.
