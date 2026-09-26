# Run report — 01a0d993-608e-7359-b7e1-c4cb29fcd065

- Policy: `policy/standard@24`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: failed; next chapter 1 of 200; stop after 1
- Model calls: 120 (166 attempts, 51 failed); tokens in/out 475527/43867; cost 0¢
- Wall clock: 2026-09-25T17:18:33.991Z → 2026-09-25T18:56:25.736Z (5872 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 8 | 10 | approved | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 52 | 18/78 ✗ r30 l0 | 85/78 r70 l100 | 85/72 r81.3 | 56.3/76 ✗ r37.5 | 2/11/28 | KO-PRN-RATE-1P×1!, TRN-KO-01×1, TRN-KO-14×22 |
| r1 | v2 | rejected | 65 | 39.1/78 ✗ r43.8 l32 | 90/78 r80 l100 | 80/72 r75 | 82/76 r75 | 0/7/25 | KO-OVR-03×1, KO-PRN-RATE-1P×1, TRN-KO-14×15 |
| r2 | v3 | rejected | 85 | 81.8/78 r75 l92 | 87.5/78 r75 l100 | 80/72 r75 | 82.5/76 r75 | 0/5/15 | drafts-regrip×1, KO-OVR-03×1, TRN-KO-14×12 |
| r3 | v4 (quarantined) | rejected | 82 | 74.3/78 ✗ r62.5 l92 | 90/78 r80 l100 | 75/72 r68.8 | 86.9/76 r81.3 | 1/4/12 | drafts-regrip×1, KO-OVR-03×1, TRN-KO-14×12 |
| r4 | v5 (quarantined) | rejected | 86 | 85/78 r75 l100 | 87.5/78 r75 l100 | 60/72 ✗ r50 | 82.5/76 r75 | 5/4/8 | TRN-KO-14×9 |
| r5 | v6 | rejected | 87 | 81.8/78 r75 l92 | 92.5/78 r85 l100 | 80/72 r75 | 78.2/76 r68.8 | 1/1/14 | drafts-regrip×1, KO-OVR-03×1, TRN-KO-14×12 |
| r6 | v7 | rejected | 85 | 78.1/78 r68.8 l92 | 92.5/78 r85 l100 | 85/72 r81.3 | 78.2/76 r68.8 | 1/6/12 | drafts-regrip×1, KO-OVR-03×1, TRN-KO-14×12 |
| r7 | v8 | rejected | 88 | 85.6/78 r81.3 l92 | 90/78 r80 l100 | 75/72 r68.8 | 73.8/76 ✗ r62.5 | 1/3/16 | drafts-regrip×1, KO-OVR-03×1, TRN-KO-14×11 |
| r8 | v9 | rejected | 87 | 85.6/78 r81.3 l92 | 87.5/78 r75 l100 | 75/72 r68.8 | 91.3/76 r87.5 | 0/1/16 | drafts-regrip×1, KO-OVR-03×1, TRN-KO-14×11 |
| r9 | v10 | approved | 89 | 90.9/78 r87.5 l96 | 87.5/78 r75 l100 | 75/72 r68.8 | 91.3/76 r87.5 | 0/0/15 | KO-OVR-03×1, TRN-KO-14×11 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 42 s | 42 s | 42 s | 7645/1916 |
| chapter_planner | 2 | 2 | 2 | 0 | 43 s | 47 s | 47 s | 24529/3122 |
| character_designer | 3 | 3 | 3 | 0 | 41 s | 67 s | 67 s | 10467/5257 |
| concept_generator | 2 | 2 | 2 | 0 | 35 s | 36 s | 36 s | 5009/1132 |
| continuity_checker | 10 | 10 | 13 | 3 | 35 s | 41 s | 51 s | 53935/2191 |
| contract_checker | 10 | 10 | 15 | 5 | 26 s | 29 s | 32 s | 38885/3207 |
| genre_judge | 8 | 6 | 19 | 13 | 29 s | 34 s | 34 s | 25637/1971 |
| knowledge_leak_checker | 10 | 10 | 12 | 2 | 22 s | 46 s | 68 s | 36183/433 |
| plan_critic | 2 | 2 | 2 | 0 | 24 s | 24 s | 24 s | 11747/247 |
| power_system_designer | 1 | 1 | 1 | 0 | 49 s | 49 s | 49 s | 3084/823 |
| promise_checker | 5 | 4 | 10 | 6 | 17 s | 23 s | 23 s | 9983/382 |
| prose_judge | 10 | 10 | 11 | 1 | 28 s | 33 s | 36 s | 43893/4347 |
| repetition_judge | 5 | 4 | 10 | 6 | 15 s | 19 s | 19 s | 9573/310 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 96 s | 96 s | 96 s | 690/1406 |
| scene_planner | 2 | 2 | 2 | 0 | 30 s | 42 s | 42 s | 8120/2456 |
| scene_writer | 5 | 5 | 5 | 0 | 81 s | 99 s | 99 s | 39899/3690 |
| story_architect | 1 | 1 | 1 | 0 | 57 s | 57 s | 57 s | 9109/2771 |
| structure_judge | 9 | 8 | 15 | 7 | 23 s | 37 s | 37 s | 31558/2582 |
| targeted_reviser | 22 | 22 | 25 | 3 | 12 s | 29 s | 35 s | 61390/1495 |
| voice_judge | 10 | 10 | 15 | 5 | 27 s | 36 s | 37 s | 41345/3182 |
| world_builder | 1 | 1 | 1 | 0 | 35 s | 35 s | 35 s | 2846/947 |
