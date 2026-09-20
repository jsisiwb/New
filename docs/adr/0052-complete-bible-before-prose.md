# ADR-0052: Preserve the complete planned bible and reject incomplete series plans before prose

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** product request and engineering
- **Relates to:** ADR-0012, ADR-0038, ADR-0051

## Context

The operator approves a story direction before automatic production. A registry of names and short
descriptions is not the complete design: character goals, flaws, voices, world terminology and
progression constraints must remain available to downstream planners. A schema-valid blueprint with
generic fallback text or missing chapter windows must not authorize prose generation.

## Decision

Preserve the complete character, world and progression design documents in the immutable full-bible
artifact alongside its normalized registry and seed data. Supply these documents, explicitly labelled
as planned rather than happened, to series, arc and chapter planning. Registry IDs remain authoritative
for references; design prose cannot create realized canon or override accepted chapter facts.

Before pinning a new series plan, require a named cast including the operator's supplied characters,
with authored roles, backgrounds, goals, flaws, voice guidance and arcs; world rules and described
locations; progression rules, capabilities and milestones; a concrete protagonist arc; an ending and endgame
requirements, and authored seasons covering every requested chapter exactly once. Missing sections or
gaps fail planning with an actionable error, not invented generic filler. Existing fixture bibles remain
readable; the new completeness gate applies to automatically generated plans.

Scene-writer entity cards receive only selected voice, motivation and mechanics guidance, not the
complete author-only design or secret arcs. Knowledge guards remain authoritative. Semantically rejected
designer output requires a fresh generation key on explicit retry; replay after a crash without a
recorded rejection reuses the paid response.

The complete series bible is prepared before chapter one. Detailed scene and chapter contracts continue
to use rolling-horizon planning against accepted canon; planning every future sentence upfront would
confuse intended events with events that actually happened.

## Consequences

Planning context is larger, but no designer detail is silently discarded. A provider returning an
incomplete plan stops before manuscript spend. This structural gate is not a claim of literary quality:
the pinned per-dimension production gates and human/live-provider validation remain necessary.
