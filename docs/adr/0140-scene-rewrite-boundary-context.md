# ADR-0140: Give scene rewrites the current text and continuation

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for permanent continuity and repetition fixes
- **Relates to:** ADR-0087, ADR-0092, ADR-0138

## Context

A live chapter4 scene rewrite restarted actions already completed in the preceding scene. The rewrite received its original plan, findings and preceding prose, but omitted the current scene being replaced and the unchanged continuation. Repairing from the original plan alone can undo earlier repairs or conflict with the actual draft boundaries.

## Decision

When the existing `revision.ladder.rewrite_checks` capability is enabled, supply the current replacement text and the unchanged following prose as explicitly labelled unaccepted draft context. The existing preceding-text variable remains authoritative for the physical entry state. Tell the writer to change only the requested scene, preserve established repairs and join both boundaries without replaying actions. The original plan remains a plan, not evidence that its entry state is still current. Accepted canon and reveal requirements retain priority.

Keep replacement ranges, immutable versions, regression checks, budgets and all acceptance gates unchanged. Older policies without rewrite checks keep their input shape. The extra text is local draft context and never enters accepted-history retrieval.

## Consequences

The writer has enough information to make a bounded repair, but can still generate a bad one; regression review remains necessary. Prompt size increases by the replaced scene and following draft text, subject to the existing gateway budget. Unit tests cover boundary labels and verbatim preservation; integration checks cover the rewrite call path.
