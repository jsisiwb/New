# Run report — 01a0d91b-c6f5-7f98-8a32-521a60daf33e

- Policy: `policy/standard@20`; manuscript language: `ko`; language layer: `lang/ko@8`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 37 (37 attempts, 0 failed); tokens in/out 181957/28512; cost 0¢
- Wall clock: 2026-09-25T15:07:56.285Z → 2026-09-25T15:31:50.254Z (1434 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 1 | 2 | rejected | 1 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 80 | 74.4/78 ✗ r81.3 l64 | 85/78 r70 l100 | 95/72 r93.8 | 81.7/76 r75 | 1/3/21 | TRN-KO-14×9 |
| r1 | v2 (quarantined) | rejected | 82 | 76/78 ✗ r81.3 l68 | 87.5/78 r75 l100 | 80/72 r75 | 92.7/76 r93.8 | 1/5/19 | TRN-KO-14×8 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 45 s | 45 s | 45 s | 8605/1895 |
| chapter_planner | 2 | 2 | 2 | 0 | 32 s | 51 s | 51 s | 26838/2931 |
| character_designer | 3 | 3 | 3 | 0 | 56 s | 81 s | 81 s | 10339/6395 |
| concept_generator | 2 | 2 | 2 | 0 | 49 s | 58 s | 58 s | 4849/1144 |
| continuity_checker | 2 | 2 | 2 | 0 | 28 s | 36 s | 36 s | 10742/504 |
| contract_checker | 2 | 2 | 2 | 0 | 15 s | 38 s | 38 s | 6966/655 |
| genre_judge | 2 | 2 | 2 | 0 | 23 s | 26 s | 26 s | 8013/645 |
| knowledge_leak_checker | 2 | 2 | 2 | 0 | 35 s | 45 s | 45 s | 7175/261 |
| plan_critic | 2 | 2 | 2 | 0 | 39 s | 54 s | 54 s | 12829/264 |
| power_system_designer | 1 | 1 | 1 | 0 | 34 s | 34 s | 34 s | 3027/854 |
| promise_checker | 2 | 2 | 2 | 0 | 19 s | 26 s | 26 s | 4326/96 |
| prose_judge | 2 | 2 | 2 | 0 | 26 s | 28 s | 28 s | 8154/717 |
| repetition_judge | 1 | 1 | 1 | 0 | 17 s | 17 s | 17 s | 2235/79 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 48 s | 48 s | 48 s | 690/1112 |
| scene_planner | 2 | 2 | 2 | 0 | 33 s | 36 s | 36 s | 7740/2249 |
| scene_writer | 4 | 4 | 4 | 0 | 64 s | 131 s | 131 s | 31513/2859 |
| story_architect | 1 | 1 | 1 | 0 | 71 s | 71 s | 71 s | 10120/3487 |
| structure_judge | 2 | 2 | 2 | 0 | 21 s | 33 s | 33 s | 7372/785 |
| voice_judge | 2 | 2 | 2 | 0 | 27 s | 37 s | 37 s | 7621/678 |
| world_builder | 1 | 1 | 1 | 0 | 50 s | 50 s | 50 s | 2803/902 |
