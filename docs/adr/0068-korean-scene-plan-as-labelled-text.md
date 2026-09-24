# ADR-0068: A Korean writer reads its scene plan as labelled text

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0041 (pinned Production Policy), ADR-0055 (fully Korean prompt surface), ADR-0056
  (Korean craft engine), ADR-0063 (the policy `planning` block), the Step 0 improvement audit (§6.10)

## Context

The chapter contract reaches a Korean `scene_writer` as labelled Korean text (`renderContractKo`), but the
scene plan it writes from was `JSON.stringify(scene)`: English keys (`objective`, `beats`,
`speaker_pairs`…), enum values (`revelation`, `cliffhanger`), and participants, the POV character and the
location as bare ids the writer has to look up in the registry section of its pack. The plan is the most
specific instruction a scene gets; a writer that reads it as data has to translate keys, enums and ids
before it can write, and nothing in the rest of a Korean prompt is JSON.

## Decision

1. `renderScenePlanKo(scene, nameOf)` renders every field of a scene plan as labelled Korean text under a
   PLANNED header: objective, POV and person, participants and location by registry name, story time, the
   opening and closing approach, entry state, numbered beats with Korean beat labels (정보 공개, 절단…),
   emotional targets, effect tags (사이다, 긴장…) and proposition ids to reveal, exit state, planned state
   changes, dialogue share, continuity anchors, what not to do, speaker pairs with their 말높이 and allowed
   shift, and the length target in 자.
2. It is opt-in through the pinned policy: `planning.scene_plan_format: labelled` (schema: optional,
   `json` | `labelled`; absent means `json`). Projects pinned to an earlier policy keep receiving JSON byte
   for byte, and English writers always receive JSON.
3. `standard.v5` = `standard.v4` + `planning.scene_plan_format: labelled`. New projects keep their default
   policy; the Phase A live evidence decides the default (A4).

## Alternatives considered

- **A new `scene_writer` version with slots per plan field.** Rejected for now: the plan's shape is a schema
  the planner already fills; one rendered slot keeps the writer template unchanged and every earlier pin
  replayable.
- **Rendering for every Korean project unconditionally.** Rejected: it would change the writer input of
  projects pinned to `standard.v1`–`v4` mid-run.

## Consequences

- A Korean writer under `standard.v5` sees no JSON and no bare ids in its scene plan; the Latin-script scan
  of the Korean end-to-end run covers the rendered plan.
- Speaker-pair registers render as `registerLabelKo` already renders them in Korean packs: Korean axis
  names with the schema's 0–4 levels (`격식 1; 존대 3`) and the registered address terms.
- The live effect on prose is unmeasured until a live run pins `standard.v5`.
