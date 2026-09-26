# Run report — 01a0da25-dc63-76b3-8312-fc962ab1b279

- Policy: `policy/standard@27`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: failed; next chapter 1 of 200; stop after 1
- Model calls: 75 (122 attempts, 50 failed); tokens in/out 345094/43622; cost 0¢
- Wall clock: 2026-09-25T19:58:34.361Z → 2026-09-25T21:15:48.406Z (4634 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 4 | 5 | rejected | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 88 | 89.3/78 r87.5 l92 | 87.5/78 r75 l100 | 85/72 r81.3 | 65/76 ✗ r50 | 0/7/13 | AIT-KO-09×1, KO-PUNCT-DASH×1 |
| r1 | v2 | rejected | 87 | 89.3/78 r87.5 l92 | 85/78 r70 l100 | 85/72 r81.3 | 69.4/76 ✗ r56.3 | 0/5/14 | AIT-KO-09×1, KO-PUNCT-DASH×1 |
| r2 | v3 | rejected | 90 | 89.3/78 r87.5 l92 | 90/78 r80 l100 | 85/72 r81.3 | 56.3/76 ✗ r37.5 | 2/3/15 | AIT-KO-09×1, KO-PUNCT-DASH×1 |
| r3 | v4 (quarantined) | rejected | 90 | 89.3/78 r87.5 l92 | 90/78 r80 l100 | 70/72 ✗ r62.5 | 60.7/76 ✗ r43.8 | 1/7/10 | AIT-KO-09×1, KO-PUNCT-DASH×1 |
| r4 | v5 (quarantined) | rejected | 80 | 74.3/78 ✗ r62.5 l92 | 85/78 r70 l100 | 100/72 r100 | 60.7/76 ✗ r43.8 | 0/8/9 | AIT-KO-09×1, KO-PUNCT-DASH×1, TRN-KO-14×8 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 49 s | 49 s | 49 s | 12940/2195 |
| chapter_planner | 1 | 1 | 1 | 0 | 42 s | 42 s | 42 s | 19538/1601 |
| character_designer | 3 | 3 | 3 | 0 | 53 s | 123 s | 123 s | 8755/7101 |
| concept_generator | 2 | 2 | 2 | 0 | 32 s | 34 s | 34 s | 3963/947 |
| continuity_checker | 6 | 5 | 11 | 6 | 45 s | 66 s | 66 s | 37340/1226 |
| contract_checker | 6 | 6 | 6 | 0 | 31 s | 40 s | 40 s | 21627/2018 |
| genre_judge | 4 | 4 | 8 | 4 | 25 s | 32 s | 32 s | 13857/1130 |
| knowledge_leak_checker | 6 | 6 | 11 | 5 | 23 s | 44 s | 44 s | 23849/268 |
| plan_critic | 2 | 2 | 2 | 0 | 26 s | 38 s | 38 s | 20215/200 |
| power_system_designer | 1 | 1 | 1 | 0 | 47 s | 47 s | 47 s | 4100/917 |
| promise_checker | 2 | 2 | 2 | 0 | 14 s | 24 s | 24 s | 4808/235 |
| prose_judge | 4 | 4 | 12 | 8 | 24 s | 32 s | 32 s | 16610/1904 |
| repetition_judge | 2 | 2 | 7 | 5 | 16 s | 18 s | 18 s | 4453/171 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 79 s | 79 s | 79 s | 664/657 |
| scene_planner | 2 | 2 | 2 | 0 | 32 s | 54 s | 54 s | 7273/2741 |
| scene_writer | 6 | 5 | 18 | 13 | 108 s | 122 s | 122 s | 50940/4550 |
| story_architect | 1 | 1 | 1 | 0 | 98 s | 98 s | 98 s | 15003/7842 |
| structure_judge | 6 | 6 | 7 | 1 | 18 s | 46 s | 46 s | 24393/2030 |
| targeted_reviser | 12 | 12 | 12 | 0 | 19 s | 30 s | 46 s | 32795/777 |
| voice_judge | 6 | 5 | 13 | 8 | 32 s | 49 s | 49 s | 19695/1696 |
| world_builder | 1 | 1 | 1 | 0 | 77 s | 77 s | 77 s | 2276/3416 |
