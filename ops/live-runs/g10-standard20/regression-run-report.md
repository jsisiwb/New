# Run report — 01a0d91c-1417-7b3a-8d51-14ddb04f34f6

- Policy: `policy/standard@20`; manuscript language: `ko`; language layer: `lang/ko@8`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 49 (49 attempts, 0 failed); tokens in/out 199787/26106; cost 0¢
- Wall clock: 2026-09-25T15:08:16.010Z → 2026-09-25T15:35:35.587Z (1640 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 2 | 4 | rejected | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 85 | 89.3/78 r87.5 l92 | 80.5/78 r65 l96 | 90/72 r87.5 | 87.5/76 r87.5 | 2/3/12 | TRN-KO-14×2 |
| r1 | v2 | rejected | 87 | 90.9/78 r87.5 l96 | 82.5/78 r80 l85 | 95/72 r93.8 | 83.4/76 r81.3 | 1/2/10 | TRN-KO-14×1 |
| r2 | v3 (quarantined) | rejected | 87 | 90.9/78 r87.5 l96 | 82.5/78 r80 l85 | 95/72 r93.8 | 83.4/76 r81.3 | 0/3/10 | TRN-KO-14×1 |
| r3 | v4 (quarantined) | rejected | 84 | 78/78 r81.3 l73 | 90/78 r80 l100 | 95/72 r93.8 | 89.2/76 r87.5 | 1/7/9 | KO-OVR-03×1, KO-OVR-04×1, KO-PUNCT-DASH×1!, TRN-KO-14×1 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 58 s | 58 s | 58 s | 7196/1830 |
| chapter_planner | 2 | 2 | 2 | 0 | 57 s | 65 s | 65 s | 22769/2593 |
| character_designer | 3 | 3 | 3 | 0 | 44 s | 62 s | 62 s | 8845/4683 |
| concept_generator | 2 | 2 | 2 | 0 | 33 s | 52 s | 52 s | 3944/1085 |
| continuity_checker | 4 | 4 | 4 | 0 | 65 s | 81 s | 81 s | 20622/659 |
| contract_checker | 4 | 4 | 4 | 0 | 24 s | 35 s | 35 s | 12662/1405 |
| genre_judge | 2 | 2 | 2 | 0 | 21 s | 25 s | 25 s | 6270/431 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 24 s | 43 s | 43 s | 12430/103 |
| plan_critic | 2 | 2 | 2 | 0 | 22 s | 44 s | 44 s | 11231/248 |
| power_system_designer | 1 | 1 | 1 | 0 | 51 s | 51 s | 51 s | 2519/877 |
| promise_checker | 4 | 4 | 4 | 0 | 16 s | 31 s | 31 s | 7838/232 |
| prose_judge | 3 | 3 | 3 | 0 | 21 s | 27 s | 27 s | 11448/1112 |
| repetition_judge | 2 | 2 | 2 | 0 | 39 s | 45 s | 45 s | 3816/132 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 34 s | 34 s | 34 s | 664/853 |
| scene_planner | 2 | 2 | 2 | 0 | 32 s | 38 s | 38 s | 6569/2241 |
| scene_writer | 4 | 4 | 4 | 0 | 83 s | 108 s | 108 s | 29066/2589 |
| story_architect | 1 | 1 | 1 | 0 | 68 s | 68 s | 68 s | 8406/2503 |
| structure_judge | 2 | 2 | 2 | 0 | 26 s | 26 s | 26 s | 7493/707 |
| targeted_reviser | 1 | 1 | 1 | 0 | 14 s | 14 s | 14 s | 2835/52 |
| voice_judge | 3 | 3 | 3 | 0 | 32 s | 51 s | 51 s | 10856/865 |
| world_builder | 1 | 1 | 1 | 0 | 36 s | 36 s | 36 s | 2308/906 |
