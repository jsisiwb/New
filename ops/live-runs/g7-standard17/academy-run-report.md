# Run report — 01a0d7b0-44d4-7016-901a-70dc5fcdbfbb

- Policy: `policy/standard@17`; manuscript language: `ko`; language layer: `lang/ko@7`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 77 (79 attempts, 2 failed); tokens in/out 339799/35531; cost 0¢
- Wall clock: 2026-09-25T08:30:53.519Z → 2026-09-25T09:09:17.837Z (2304 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 2 | 6 | rejected | 4 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 84 | 84/78 r81.3 l88 | 83/78 r70 l96 | 80/72 r75 | 73.8/76 ✗ r62.5 | 0/4/24 | TRN-KO-14×3 |
| r1 | v2 | rejected | 87 | 84/78 r81.3 l88 | 90.5/78 r85 l96 | 80/72 r75 | 95.7/76 r93.8 | 1/3/22 | TRN-KO-14×3 |
| r2 | v3 (quarantined) | rejected | 89 | 87.7/78 r87.5 l88 | 90.5/78 r85 l96 | 60/72 ✗ r50 | 60.7/76 ✗ r43.8 | 2/5/18 | TRN-KO-14×3 |
| r3 | v4 (quarantined) | rejected | 87 | 84/78 r81.3 l88 | 90.5/78 r85 l96 | 85/72 r81.3 | 73.8/76 ✗ r62.5 | 2/4/18 | TRN-KO-14×3 |
| r4 | v5 (quarantined) | rejected | 89 | 87.7/78 r87.5 l88 | 90.5/78 r85 l96 | 75/72 r68.8 | 65/76 ✗ r50 | 1/7/16 | TRN-KO-14×3 |
| r5 | v6 (quarantined) | rejected | 89 | 87.7/78 r87.5 l88 | 90.5/78 r85 l96 | 60/72 ✗ r50 | 69.4/76 ✗ r56.3 | 2/4/17 | TRN-KO-14×3 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 53 s | 53 s | 53 s | 8170/2131 |
| chapter_planner | 2 | 2 | 2 | 0 | 52 s | 56 s | 56 s | 25766/3395 |
| character_designer | 3 | 3 | 3 | 0 | 60 s | 69 s | 69 s | 10280/4706 |
| concept_generator | 2 | 2 | 2 | 0 | 37 s | 49 s | 49 s | 4824/1109 |
| continuity_checker | 6 | 6 | 6 | 0 | 30 s | 57 s | 57 s | 37033/1750 |
| contract_checker | 4 | 4 | 4 | 0 | 23 s | 65 s | 65 s | 15558/1271 |
| genre_judge | 6 | 6 | 6 | 0 | 29 s | 35 s | 35 s | 25383/1886 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 17 s | 19 s | 19 s | 16016/24 |
| plan_critic | 2 | 2 | 2 | 0 | 34 s | 60 s | 60 s | 12473/298 |
| power_system_designer | 1 | 1 | 1 | 0 | 45 s | 45 s | 45 s | 3108/734 |
| promise_checker | 1 | 1 | 1 | 0 | 17 s | 17 s | 17 s | 2424/9 |
| prose_judge | 6 | 6 | 7 | 1 | 24 s | 28 s | 28 s | 25305/2474 |
| repetition_judge | 1 | 1 | 1 | 0 | 26 s | 26 s | 26 s | 2431/79 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 43 s | 43 s | 43 s | 690/1182 |
| scene_planner | 2 | 2 | 2 | 0 | 49 s | 55 s | 55 s | 8535/3426 |
| scene_writer | 4 | 4 | 4 | 0 | 52 s | 70 s | 70 s | 34969/2145 |
| story_architect | 1 | 1 | 1 | 0 | 78 s | 78 s | 78 s | 9263/4025 |
| structure_judge | 2 | 2 | 2 | 0 | 30 s | 42 s | 42 s | 7811/654 |
| targeted_reviser | 21 | 21 | 21 | 0 | 20 s | 35 s | 60 s | 62484/1351 |
| voice_judge | 6 | 6 | 7 | 1 | 30 s | 34 s | 34 s | 24427/1920 |
| world_builder | 1 | 1 | 1 | 0 | 46 s | 46 s | 46 s | 2849/962 |

