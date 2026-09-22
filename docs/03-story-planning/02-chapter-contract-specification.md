# Chapter Contract Specification

Normative companion to `schemas/chapter-contract.schema.json`. A contract is created by `chapter_planner`,
validated deterministically and by `plan_continuity_checker`, approved per operating mode (status `locked`,
ADR-0037), and then drives
scene planning, drafting, evaluation, and acceptance. **The chapter is accepted only if the contract's
acceptance criteria are satisfied.** All free-text fields in a contract are English working text
(`language: "en"` at the document level); manuscript output realizing the contract is English.

## 1. Identity and lineage

| Field | Meaning |
| --- | --- |
| `id`, `project_id`, `chapter_number` | UUIDv7; chapter numbers are contiguous positive integers within the project (renumbering on deletion is an explicit operation) |
| `version` | Contract version; edits create new versions |
| `arc_id`, `minor_arc_id`, `season_id` | Parents |
| `beat_refs[]` | Arc beats this chapter realizes |
| `pinned` | `spec_version`, `bible_version`, `narrative_identity_version_id`, `canon_version`, `template_version` — inputs pinned when the contract was produced |
| `status` | `draft`, `validated`, `approved`, `stale`, `superseded`, `realized` |
| `stale_reasons[]` | Populated by material-dependency invalidation |

## 2. Purpose

| Field | Meaning |
| --- | --- |
| `purpose` | One or two sentences: why this chapter exists in the series |
| `reader_experience` | The intended felt experience (e.g., "satisfaction, then unease") |
| `arc_objective_contribution` | Which arc objective(s) it advances and how |

## 3. Requirements (inherited + local)

| Field | Meaning |
| --- | --- |
| `active_constraints_ref` | ID + hash of the compiled **Active Constraint Set** for this chapter (ADR-0033): the scope-filtered hard requirements, content restrictions and locked facts rendered once for T0 |
| `must_happen[]` | Events/beats that must occur; each with `kind`, `description`, optional `proposition_ids`, `entity_ids`, and `verifiable_by` (extraction rule, judge criterion, lexical marker, human) |
| `must_not_happen[]` | Inherited forbidden developments (spec/arc) + local (e.g., "no identity reveal yet") with source references |
| `required_scenes[]` | User-mandated scenes bound to this chapter (spec references) |
| `hard_requirement_refs[]` | Spec requirement IDs that apply here (content restrictions always included) |

## 4. Cast, setting, time

| Field | Meaning |
| --- | --- |
| `pov` | `{ character_id, person: first|third_limited|third_omniscient (restricted by tradition profile) }`; multi-POV chapters list segments |
| `participants[]` | `{ character_id, role_in_chapter, on_page }` |
| `mentioned_only[]` | Characters referenced but absent |
| `locations[]` | Location IDs with order; travel legitimacy validated against last known locations |
| `story_time` | `{ start: StoryClock, end: StoryClock, elapsed_since_previous }` on the chapter's timeline |
| `timeline_id` | Default main; regression stories set explicitly |

## 5. Deltas (planned; frame = plan until realized)

| Field | Meaning |
| --- | --- |
| `knowledge_deltas[]` | `{ knower, proposition_id or new_proposition, from_stance, to_stance, how, channel_kind, informer_id }` — validated: the proposition must exist in canon or in `introduces[]`; the knower must be able to learn it in this chapter |
| `state_deltas[]` | `{ entity_id, attribute, from, to, when_in_chapter }` |
| `relationship_deltas[]` | `{ from_id, to_id, axis (trust|affection|respect|hostility|dependency|type), direction, magnitude, address_term_change?, register_change? }` — `register_change` is an abstract register delta (e.g., formality 3→1, "first names in private") rendered in English by the writer |
| `introduces[]` | New entities/propositions this chapter may create (display names pre-registered in the naming registry; terms pre-registered in the terminology policy) |
| `setups[]` / `payoffs[]` | Promise IDs opened/advanced/paid with how |
| `progression` | `{ milestone_id?, magnitude, mechanism }` if a progression beat occurs |

## 6. Shape

| Field | Meaning |
| --- | --- |
| `emotional_movement` | `{ start, peak, end }` |
| `conflict` | `{ type, description, reversal? }` |
| `local_satisfaction[]` | ≥ 1 of `satisfaction` (사이다), `revelation`, `emotional_step`, `growth_confirmed`, `humor_beat` with description |
| `ending_state` | Where things stand at the last line |
| `hook` | `{ type: from tradition.ending_types_allowed, description, question_raised }` |
| `opening` | `{ type: from tradition.opening_types_allowed, description }` |
| `scene_count` | Integer within tradition band |
| `dialogue_density_target`, `monologue_density_target` | Numbers within bands |
| `length_target` | `{ unit: "words", value, tolerance_ratio }` (ADR-0034); derived estimates (code points, tokens, reading time) are computed, not authored |
| `narrative_identity_version_id` | Pinned |
| `tone_notes[]` | Chapter-specific tone directions |

## 7. Risk and validation

| Field | Meaning |
| --- | --- |
| `continuity_risks[]` | `{ description, related_fact_ids[], mitigation }` |
| `continuity_anchors[]` | Facts (IDs + evidence) that must be respected and that the context pack must include at T1 (these become **material** dependency edges) |
| `knowledge_guards[]` | `{ character_id, must_not_know_proposition_ids[] }` |
| `validation` | `{ canon_ok, plan_ok, narrative_ok, issues[], validated_at_canon_version }` |

## 8. Acceptance criteria

`acceptance_criteria[]`: each `{ id, kind: deterministic|judge|human, description, check_ref, threshold? }`.
Auto-populated: all `must_happen` (judge: contract compliance with evidence), all `must_not_happen`
(judge + lexical), **output language matches the manuscript language** (deterministic `EP-LANG-01`, ADR-0054),
language-aware length gate (words for en, characters for ko, deterministic), prose lint fail count = 0, structure lint fail count = 0, register violations (RG-01..03) =
0, `prose_score` ≥ `policy.gates.dimensions.prose.min_score` (Prose Judge), `structure_score` ≥
`policy.gates.dimensions.structure.min_score` (Structure Judge), `genre_score` and `voice_score` ≥ their
own thresholds, continuity blocking = 0 (with evidence), knowledge
leaks = 0, promise handling as planned, hook present (Structure Judge). Plus user-added criteria.

Approval rule (ADR-0041/0042): all `deterministic` criteria pass; all `judge` criteria pass on their own
dimension (prose and structure are separate criteria and are never averaged; thresholds come from the pinned
Production Policy `policy.gates.dimensions`), or are overridden where the override matrix allows it (`never`
and `canon_workflow` classes cannot be waived); `human` criteria satisfied by explicit approval (Assisted) or
the approval policy (Semi-auto/Autopilot). Approval locks the version; acceptance follows from the atomic
canon commit (ADR-0037).

## 9. Example (abridged, fixture story chapter 12)

See `examples/fixture/chapter-contract.ch12.json`.
