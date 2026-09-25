# Run report — 01a0d78d-1267-7bd6-8c34-e34e66664266

- Policy: `policy/standard@15`; manuscript language: `ko`; language layer: `lang/ko@7`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 55 (55 attempts, 0 failed); tokens in/out 209172/28686; cost 0¢
- Wall clock: 2026-09-25T07:52:29.824Z → 2026-09-25T08:19:46.515Z (1637 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 2 | 4 | rejected | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 79 | 75.4/78 ✗ r75 l76 | 82.5/78 r65 l100 | 85/72 r81.3 | 84/76 r81.3 | 3/2/22 | TRN-KO-14×6 |
| r1 | v2 (quarantined) | rejected | 73 | 66.3/78 ✗ r62.5 l72 | 80/78 r60 l100 | 90/72 r87.5 | 84/76 r81.3 | 0/6/20 | TRN-KO-14×7 |
| r2 | v3 (quarantined) | rejected | 75 | 67.9/78 ✗ r62.5 l76 | 82.5/78 r65 l100 | 90/72 r87.5 | 84/76 r81.3 | 2/7/14 | TRN-KO-14×6 |
| r3 | v4 | rejected | 78 | 75.4/78 ✗ r75 l76 | 80/78 r60 l100 | 85/72 r81.3 | 84/76 r81.3 | 1/10/14 | TRN-KO-14×6 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 63 s | 63 s | 63 s | 7878/1820 |
| chapter_planner | 1 | 1 | 1 | 0 | 36 s | 36 s | 36 s | 12196/1488 |
| character_designer | 3 | 3 | 3 | 0 | 64 s | 84 s | 84 s | 8815/5436 |
| concept_generator | 2 | 2 | 2 | 0 | 42 s | 42 s | 42 s | 4027/1075 |
| continuity_checker | 4 | 4 | 4 | 0 | 31 s | 63 s | 63 s | 20849/1072 |
| contract_checker | 4 | 4 | 4 | 0 | 21 s | 22 s | 22 s | 14562/1259 |
| genre_judge | 4 | 4 | 4 | 0 | 17 s | 29 s | 29 s | 14139/1085 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 21 s | 27 s | 27 s | 12993/715 |
| plan_critic | 1 | 1 | 1 | 0 | 27 s | 27 s | 27 s | 3415/68 |
| power_system_designer | 1 | 1 | 1 | 0 | 54 s | 54 s | 54 s | 2587/1096 |
| promise_checker | 1 | 1 | 1 | 0 | 19 s | 19 s | 19 s | 2274/9 |
| prose_judge | 4 | 4 | 4 | 0 | 25 s | 31 s | 31 s | 16101/1760 |
| repetition_judge | 1 | 1 | 1 | 0 | 25 s | 25 s | 25 s | 2281/115 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 37 s | 37 s | 37 s | 664/922 |
| scene_planner | 2 | 2 | 2 | 0 | 43 s | 51 s | 51 s | 6932/2240 |
| scene_writer | 2 | 2 | 2 | 0 | 63 s | 64 s | 64 s | 14128/1453 |
| story_architect | 1 | 1 | 1 | 0 | 73 s | 73 s | 73 s | 9272/3615 |
| structure_judge | 4 | 4 | 4 | 0 | 29 s | 34 s | 34 s | 16357/1579 |
| targeted_reviser | 12 | 12 | 12 | 0 | 17 s | 20 s | 23 s | 33414/843 |
| voice_judge | 1 | 1 | 1 | 0 | 22 s | 22 s | 22 s | 3887/260 |
| world_builder | 1 | 1 | 1 | 0 | 35 s | 35 s | 35 s | 2401/776 |

