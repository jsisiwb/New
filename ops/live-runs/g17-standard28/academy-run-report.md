# Run report — 01a0da46-85b7-749d-95f7-30968460036c

- Policy: `policy/standard@28`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: failed; next chapter 1 of 200; stop after 1
- Model calls: 17 (33 attempts, 18 failed); tokens in/out 70242/19223; cost 0¢
- Wall clock: 2026-09-25T20:34:14.282Z → 2026-09-25T21:15:36.956Z (2483 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | planned | — | — | 0 | 0 | — | 0 | — |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 48 s | 48 s | 48 s | 6903/2182 |
| chapter_planner | 2 | 2 | 5 | 3 | 43 s | 52 s | 52 s | 22920/3320 |
| character_designer | 3 | 3 | 3 | 0 | 66 s | 67 s | 67 s | 8435/5089 |
| concept_generator | 2 | 2 | 2 | 0 | 37 s | 39 s | 39 s | 3616/1029 |
| plan_critic | 2 | 2 | 3 | 1 | 25 s | 45 s | 45 s | 11738/163 |
| power_system_designer | 1 | 1 | 1 | 0 | 49 s | 49 s | 49 s | 2364/830 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 690/1299 |
| scene_planner | 3 | 1 | 13 | 12 | 43 s | 43 s | 43 s | 3265/1309 |
| story_architect | 1 | 1 | 3 | 2 | 56 s | 56 s | 56 s | 8140/3243 |
| world_builder | 1 | 1 | 1 | 0 | 30 s | 30 s | 30 s | 2171/759 |
