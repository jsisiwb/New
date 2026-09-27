# ADR-0138: Route structural repetition to scene rewriting

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for distinct scenes and story patterns
- **Relates to:** ADR-0087, ADR-0120, ADR-0136

## Context

The live serial sample's second chapter cleared a repetitive-arc finding after mostly lexical patches. Replacing words did not change the recurring equipment-rage scene pattern. The revision ladder already supports scene rewriting, but its immediate rewrite kinds omitted repeated scenes and repetitive arcs.

## Decision

Publish standard@47, inheriting standard@46 and adding `repeated_scene` and `repetitive_arc` to `revision.ladder.scene_rewrite_kinds`. New projects use this policy. Structural repetition findings therefore first request a rewrite of the implicated scene through the existing ladder, with the original finding and chapter constraints. Preserve rewrite budgets, regression quarantine, full rechecks, canon gates and every earlier policy pin. Local phrase duplication continues through ordinary patch selection.

## Consequences

A rewrite is a repair opportunity, not proof of originality. Scene attribution and the model's assessment can still fail; editorial reading remains necessary. The ongoing standard@45 sample retains its pinned repair behavior and cannot establish a live result for standard@47. Policy tests verify the exact change; the existing scene-rewrite integration exercises the shared routing and approval path.
