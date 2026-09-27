# ADR-0131: Review serial architecture before bible assembly

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for causal Korean serial pacing
- **Relates to:** ADR-0127, ADR-0128, ADR-0130

## Context

Contiguous episode ranges do not guarantee a coherent story schedule. A live blueprint assigned recruitment to chapters 1–5 and breakfast/testing to 6–11, but its opening briefs completed recruitment in chapter 3 and testing in chapter 5. The arc planner inherited both schedules. Chapter-level critics cannot reliably repair that upstream contradiction.

## Decision

Publish standard.v45 with a bounded serial-architecture review before bible assembly. A dedicated prompt family, using the existing plan_critic model role, compares the arrival, episodes, opening briefs, season states and reveal/payoff windows. It checks causal transitions, premature later-episode events, missing orientation and repeated rewards disguised as progress. It distinguishes a local reward and aftermath from an episode's final result; it does not demand that every episode climax occur on its final chapter or impose a universal Korean timetable.

Each candidate still passes schema and deterministic coverage validation. Review findings are stored as artifacts keyed by the complete generation activity and review attempt. An explicit regeneration preserves prior rejected review evidence and writes new keys. Blocking and major findings return the full candidate and concrete feedback to the architect for at most the pinned policy's repair count. Each repair is reviewed again. Exhausted serious findings or malformed review output stop blueprint production before bible assembly or prose. Minor notes remain recorded. Existing policies keep their original call graph and immutable prompts.

## Consequences

Bible planning adds model calls and can stop for an unresolved design problem. This is preferable to knowingly feeding incompatible schedules to every chapter planner. Deterministic tests cover repair feedback, re-review, exhausted repairs, malformed review output and old-policy compatibility. A model review is evidence of a check, not a guarantee of literary quality; live outputs remain subject to reading and chapter acceptance gates.
