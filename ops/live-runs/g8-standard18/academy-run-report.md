# Run report — 01a0d7e7-1c3f-7021-89fe-776814ba0509

- Policy: `policy/standard@18`; manuscript language: `ko`; language layer: `lang/ko@8`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 74 (74 attempts, 0 failed); tokens in/out 313935/32320; cost 0¢
- Wall clock: 2026-09-25T09:30:47.544Z → 2026-09-25T10:11:41.139Z (2454 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 4 | 6 | rejected | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 87 | 79.2/78 r81.3 l76 | 95/78 r90 l100 | 75/72 r68.8 | 88.8/76 r87.5 | 2/7/12 | AIT-KO-05×1, drafts-narrowed-eyes×1, KO-AIT-COUNT×1, TRN-KO-14×3 |
| r1 | v2 | rejected | 88 | 84/78 r81.3 l88 | 92.5/78 r85 l100 | 75/72 r68.8 | 93.2/76 r93.8 | 2/2/12 | TRN-KO-14×3 |
| r2 | v3 | rejected | 87 | 81.8/78 r75 l92 | 92.5/78 r85 l100 | 75/72 r68.8 | 93.2/76 r93.8 | 0/3/12 | TRN-KO-14×2 |
| r3 | v4 (quarantined) | rejected | 93 | 89.3/78 r87.5 l92 | 97.5/78 r95 l100 | 85/72 r81.3 | 75.7/76 ✗ r68.8 | 1/2/11 | TRN-KO-14×2 |
| r4 | v5 (quarantined) | rejected | 83 | 74.3/78 ✗ r62.5 l92 | 92.5/78 r85 l100 | 85/72 r81.3 | 93.2/76 r93.8 | 1/2/14 | TRN-KO-14×2 |
| r5 | v6 | rejected | 91 | 89.3/78 r87.5 l92 | 92.5/78 r85 l100 | 90/72 r87.5 | 93.2/76 r93.8 | 0/3/11 | TRN-KO-14×2 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 58 s | 58 s | 58 s | 8817/2236 |
| chapter_planner | 1 | 1 | 1 | 0 | 58 s | 58 s | 58 s | 13742/1916 |
| character_designer | 3 | 3 | 3 | 0 | 59 s | 128 s | 128 s | 10512/5552 |
| concept_generator | 2 | 2 | 2 | 0 | 41 s | 45 s | 45 s | 4880/1062 |
| continuity_checker | 6 | 6 | 6 | 0 | 35 s | 50 s | 50 s | 38147/899 |
| contract_checker | 6 | 6 | 6 | 0 | 28 s | 43 s | 43 s | 23651/2139 |
| genre_judge | 6 | 6 | 6 | 0 | 24 s | 36 s | 36 s | 24451/1663 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 21 s | 42 s | 42 s | 24629/275 |
| plan_critic | 2 | 2 | 2 | 0 | 14 s | 23 s | 23 s | 13479/99 |
| power_system_designer | 1 | 1 | 1 | 0 | 41 s | 41 s | 41 s | 3096/789 |
| promise_checker | 2 | 2 | 2 | 0 | 14 s | 18 s | 18 s | 4750/118 |
| prose_judge | 6 | 6 | 6 | 0 | 31 s | 50 s | 50 s | 24628/2609 |
| repetition_judge | 2 | 2 | 2 | 0 | 16 s | 20 s | 20 s | 4585/139 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 690/1235 |
| scene_planner | 2 | 2 | 2 | 0 | 31 s | 37 s | 37 s | 8752/2343 |
| scene_writer | 2 | 2 | 2 | 0 | 69 s | 90 s | 90 s | 18501/1517 |
| story_architect | 1 | 1 | 1 | 0 | 88 s | 88 s | 88 s | 9857/3915 |
| structure_judge | 3 | 3 | 3 | 0 | 23 s | 31 s | 31 s | 11272/826 |
| targeted_reviser | 17 | 17 | 17 | 0 | 18 s | 25 s | 31 s | 50074/1108 |
| voice_judge | 3 | 3 | 3 | 0 | 28 s | 41 s | 41 s | 12560/929 |
| world_builder | 1 | 1 | 1 | 0 | 31 s | 31 s | 31 s | 2862/951 |

