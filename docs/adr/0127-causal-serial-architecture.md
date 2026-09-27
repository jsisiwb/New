# ADR-0127: Causal serial architecture and arrival orientation

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request following the first live draft
- **Relates to:** ADR-0012, ADR-0056, ADR-0120, ADR-0126

## Context

The first academy draft used a generated bible and a 200-chapter blueprint but skipped the protagonist making sense of transmigration. The blueprint only scheduled seasons; the workflow divided them into equal windows and instructed every arc to reach the season exit. General opening guidance did not preserve a causal arrival sequence. Established premise knowledge was available to the narrator but was not necessarily introduced to the reader.

## Decision

Publish standard.v43 and immutable 4.16.0 prompts. A Korean project on this policy requires a structured serial_plan in its blueprint: an arrival/origin brief, authored episodes covering every requested chapter exactly once within their seasons, and one opening-chapter brief per chapter through the configured opening horizon (capped by the project length). Validate coverage, ordering and season containment before prose. Keep the plan in the bible as PLANNED data, never realized canon. Older and English projects retain their scheduling path.

Episode boundaries follow local goals, reversals, payoffs and consequences; they are not fixed ten-chapter slices. Each episode has its own entry and exit; the final season state is reserved for its last episode. The full series retains an ending, promises and character trajectories, while later scene detail is authored on the rolling horizon.

The arrival brief distinguishes last remembered life, the first observed mismatch, the protagonist's initial explanation, a reality test, emotional cost and first practical choice. Transmigration or regression should be experienced before routine optimization. Familiarity with a game is not automatic mastery of a body or a living world. Native-world stories use a change in circumstances rather than an invented transmigration.

Only the current opening chapter's brief reaches the writer/reviser; the first chapter additionally receives the arrival brief. Future episode payoffs remain planner-only. Accepted previous-chapter state, verbatim ending and canon outrank planned entry states. Critics check missing orientation and premature payoffs without imposing a universal Korean-webnovel timetable or demanding combat in chapter one.

## Consequences

The optional schema fields preserve older blueprints; the new policy requires and validates them. Tests cover missing/overlapping/out-of-range episodes, opening coverage, authored scheduling, old-policy compatibility, and propagation to model calls. Live verification generates a fresh 200-chapter bible and attempts five accepted sequential chapters with the original gates intact. Planning and live reading outcomes are recorded in the progress document.
