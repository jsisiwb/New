# Run report — 01a0da46-85b7-749d-95f7-30968460036c

- Policy: `policy/standard@28`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: producing; next chapter 2 of 200; stop after 5
- Model calls: 85 (102 attempts, 19 failed); tokens in/out 372247/44936; cost 0¢
- Wall clock: 2026-09-25T20:34:14.282Z → 2026-09-25T23:15:31.118Z (9677 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | accepted | 6339 | 5033 | 4 | 7 | approved | 2 | — |
| 2 | planned | — | — | 0 | 0 | — | 0 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 80 | 81.8/78 r75 l92 | 78/78 r60 l96 | 80/72 r75 | 86.9/76 r81.3 | 3/2/16 | KO-OVR-03×1, KO-SIM-RATE×1, TRN-KO-14×7 |
| r1 | v2 | rejected | 85 | 89.3/78 r87.5 l92 | 80.5/78 r65 l96 | 90/72 r87.5 | 95.7/76 r93.8 | 0/3/12 | KO-OVR-03×1, KO-SIM-RATE×1, TRN-KO-14×7 |
| r2 | v3 (quarantined) | rejected | 84 | 88.8/78 r81.3 l100 | 80/78 r75 l85 | 90/72 r87.5 | 95.7/76 r93.8 | 0/3/10 | TRN-KO-14×7 |
| r3 | v4 (quarantined) | rejected | 89 | 92.5/78 r87.5 l100 | 85/78 r70 l100 | 85/72 r81.3 | 81.6/76 r75 | 0/8/10 | TRN-KO-14×4 |
| r4 | v5 | approved | 86 | 87.2/78 r81.3 l96 | 85.5/78 r75 l96 | 90/72 r87.5 | 95.7/76 r93.8 | 0/0/17 | KO-SIM-RATE×1, TRN-KO-14×7 |
| r5 | v5 | approved | 89 | 87.2/78 r81.3 l96 | 90.5/78 r85 l96 | 85/72 r81.3 | 91.3/76 r87.5 | 0/0/14 | KO-SIM-RATE×1, TRN-KO-14×7 |
| r6 | v6 (accepted) | approved | 89 | 87.2/78 r81.3 l96 | 90.5/78 r85 l96 | 85/72 r81.3 | 91.3/76 r87.5 | 0/0/13 | KO-SIM-RATE×1, TRN-KO-14×1 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 48 s | 48 s | 48 s | 6903/2182 |
| canon_extractor | 3 | 3 | 3 | 0 | 47 s | 68 s | 68 s | 15169/5453 |
| chapter_planner | 4 | 4 | 7 | 3 | 52 s | 61 s | 61 s | 46187/6743 |
| character_designer | 3 | 3 | 3 | 0 | 66 s | 67 s | 67 s | 8435/5089 |
| concept_generator | 2 | 2 | 2 | 0 | 37 s | 39 s | 39 s | 3616/1029 |
| continuity_checker | 6 | 6 | 6 | 0 | 51 s | 267 s | 267 s | 33427/1153 |
| contract_checker | 6 | 6 | 6 | 0 | 34 s | 42 s | 42 s | 23137/1794 |
| factual_summarizer | 1 | 1 | 1 | 0 | 27 s | 27 s | 27 s | 2700/305 |
| genre_judge | 4 | 4 | 4 | 0 | 27 s | 36 s | 36 s | 17603/1283 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 13 s | 41 s | 41 s | 22141/113 |
| plan_critic | 3 | 3 | 4 | 1 | 45 s | 55 s | 55 s | 19580/334 |
| power_system_designer | 1 | 1 | 1 | 0 | 49 s | 49 s | 49 s | 2364/830 |
| promise_checker | 2 | 2 | 2 | 0 | 14 s | 16 s | 16 s | 5326/107 |
| prose_judge | 8 | 8 | 8 | 0 | 24 s | 35 s | 35 s | 35720/3457 |
| repetition_judge | 3 | 3 | 3 | 0 | 23 s | 24 s | 24 s | 7462/284 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 690/1299 |
| scene_planner | 4 | 2 | 14 | 12 | 34 s | 43 s | 43 s | 6569/2440 |
| scene_writer | 4 | 4 | 5 | 1 | 77 s | 193 s | 193 s | 32607/3118 |
| story_architect | 1 | 1 | 3 | 2 | 56 s | 56 s | 56 s | 8140/3243 |
| structure_judge | 6 | 6 | 6 | 0 | 23 s | 35 s | 35 s | 24388/2076 |
| targeted_reviser | 11 | 11 | 11 | 0 | 14 s | 22 s | 28 s | 31088/674 |
| voice_judge | 4 | 4 | 4 | 0 | 33 s | 36 s | 36 s | 16824/1171 |
| world_builder | 1 | 1 | 1 | 0 | 30 s | 30 s | 30 s | 2171/759 |
