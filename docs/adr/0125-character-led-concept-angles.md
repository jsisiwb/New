# ADR-0125: Character-led concept angles

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request; live concept verification
- **Relates to:** ADR-0041, ADR-0120, ADR-0121, ADR-0124

## Context

The original academy intake explicitly requires overwhelming power and heroines who misunderstand the protagonist. Those requirements must survive craft improvements. A second live concept test still escalated immediately. The code supplies only two candidates by default, whose angle seeds privilege faithful genre convention and greater opening stakes. This conflicts with reader orientation and varied protagonist motives. Some inherited writer instructions also forbid brief explanatory narration.

## Decision

Release immutable `standard.v40` with `planning.concept_angles: character_first` and prompt ceiling `4.14.0`; use its behavior for new projects. `standard.v41` is the final shared CLI/API default and differs only in the prompt ceiling (`4.14.1`). Korean concept candidates receive distinct approaches to a personal objective or relationship rather than a mandatory increase in stakes. Explicit intake requirements remain authoritative. The existing angle seeds remain unchanged for earlier policies and English projects.

Publish `concept_generator`, `chapter_planner` and `scene_writer` at `4.14.0`. Remove contradictory narration restrictions and reaction-only payoff framing. The first chapter's hook establishes an immediate understandable situation and leaves escalation room. Do not force a new universal plot or personality.

The schema fixed-point tests also require generated output examples in five newly versioned roles. Publish `arc_planner`, `chapter_comparator`, `concept_comparator`, `requirement_interpreter`, and `targeted_reviser` at `4.14.1`, using the existing schema renderer. This repairs omitted derived notes/labels and the non-canonical example array; output schemas and workflow behavior are unchanged. Preserve all prompts already pinned by live verification projects.

## Consequences

Additional live verification uses a fresh project. Prior candidates and pins remain intact. These qualitative directions cannot guarantee popular or memorable fiction. Integration checks prove propagation and compatibility; actual prose still requires reading.
