# Run report — 01a0da20-e0e9-7a56-bb3a-4e3a9e2db71d

- Policy: `policy/standard@27`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: failed; next chapter 1 of 200; stop after 1
- Model calls: 20 (25 attempts, 6 failed); tokens in/out 159998/35540; cost 0¢
- Wall clock: 2026-09-25T19:53:07.551Z → 2026-09-25T20:29:17.677Z (2170 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | drafted | — | — | 1 | 0 | — | 0 | — |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 59 s | 59 s | 59 s | 13601/2173 |
| chapter_planner | 2 | 2 | 2 | 0 | 62 s | 65 s | 65 s | 39656/5260 |
| character_designer | 3 | 3 | 3 | 0 | 48 s | 93 s | 93 s | 11450/6365 |
| concept_generator | 2 | 2 | 2 | 0 | 43 s | 189 s | 189 s | 3518/2075 |
| plan_critic | 2 | 2 | 2 | 0 | 22 s | 31 s | 31 s | 23153/173 |
| power_system_designer | 1 | 1 | 1 | 0 | 60 s | 60 s | 60 s | 5387/1238 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 690/1146 |
| scene_planner | 2 | 2 | 2 | 0 | 32 s | 40 s | 40 s | 9021/2967 |
| scene_writer | 4 | 3 | 9 | 6 | 54 s | 93 s | 93 s | 33807/2002 |
| story_architect | 1 | 1 | 1 | 0 | 222 s | 222 s | 222 s | 16542/8136 |
| world_builder | 1 | 1 | 1 | 0 | 84 s | 84 s | 84 s | 3173/4005 |
