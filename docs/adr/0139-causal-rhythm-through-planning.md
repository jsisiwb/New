# ADR-0139: Keep causal rhythm consistent across planning and writing

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for natural serial progression
- **Relates to:** ADR-0120, ADR-0136, ADR-0138

## Context

Live chapter3 planning rejected a concrete workshop decision as a forbidden reflective ending and demanded immediate destructive action. The new structure rubric alone cannot correct conflicting instructions in the chapter planner, critic, writer, voice profile and runtime scene guidance.

## Decision

Publish standard@48 with `planning.causal_rhythm`, prompt ceiling4.20 and voice/operator@6. This opt-in makes planning and scene guidance assess an ending by a specific unresolved consequence, decision or relationship question. Quiet discovery and a consequential decision can carry the hook; an empty recap or generic vow cannot. Preserve the contract's final beat and vary chapter rhythm without demanding new violence, arrivals or spectacle. Brief reflection can connect perception to choice; it must not repeat established information.

Version the affected planner, critic, scene planner and writer prompts. Retain earlier policy behavior, budgets, schemas for story artifacts, accepted-history precedence and all acceptance gates. The current policy45 sample continues on its original pin and is diagnostic evidence for this change, not a live validation of48.

## Consequences

Policy/schema and prompt/profile compatibility tests cover the new pins. Runtime guidance tests cover opt-in and legacy behavior; existing chapter production tests cover integration boundaries. This removes contradictory instructions; it does not guarantee the model makes a compelling literary choice.
