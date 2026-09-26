# Run report — 01a0d86d-c0b0-7d1f-a924-94a0acbaf7c3

- Policy: `policy/standard@19`; manuscript language: `ko`; language layer: `lang/ko@8`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 83 (85 attempts, 2 failed); tokens in/out 334809/35390; cost 0¢
- Wall clock: 2026-09-25T11:57:50.258Z → 2026-09-25T12:38:29.878Z (2440 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 3 | 6 | rejected | 3 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 74 | 73.3/78 ✗ r68.8 l80 | 75.5/78 ✗ r55 l96 | 80/72 r75 | 90.4/76 r87.5 | 4/8/15 | AIT-KO-05×1, KO-ORDER-01×1, KO-OVR-03×1, TRN-KO-14×2 |
| r1 | v2 | rejected | 80 | 71.7/78 ✗ r68.8 l76 | 87.5/78 r75 l100 | 90/72 r87.5 | 89.5/76 r87.5 | 2/3/19 | KO-OVR-03×1, TRN-KO-14×5 |
| r2 | v3 (quarantined) | rejected | 82 | 79.2/78 r81.3 l76 | 85/78 r70 l100 | 80/72 r75 | 94.9/76 r93.8 | 0/5/17 | AIT-KO-05×1, TRN-KO-01×1, TRN-KO-14×4 |
| r3 | v4 (quarantined) | rejected | 78 | 78.6/78 r75 l84 | 77.5/78 ✗ r55 l100 | 85/72 r81.3 | 89.5/76 r87.5 | 0/4/17 | KO-OVR-03×1, TRN-KO-14×3 |
| r4 | v5 | rejected | 84 | 82.4/78 r81.3 l84 | 85/78 r70 l100 | 80/72 r75 | 93.9/76 r93.8 | 0/5/17 | KO-OVR-03×1, TRN-KO-14×3 |
| r5 | v6 (quarantined) | rejected | 79 | 82.4/78 r81.3 l84 | 75/78 ✗ r50 l100 | 75/72 r68.8 | 89.5/76 r87.5 | 1/3/17 | KO-OVR-03×1, TRN-KO-14×3 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 7251/1840 |
| chapter_planner | 1 | 1 | 1 | 0 | 177 s | 177 s | 177 s | 11318/1514 |
| character_designer | 3 | 3 | 3 | 0 | 61 s | 65 s | 65 s | 10241/4680 |
| concept_generator | 2 | 2 | 2 | 0 | 34 s | 35 s | 35 s | 4935/975 |
| continuity_checker | 6 | 6 | 6 | 0 | 40 s | 175 s | 175 s | 33577/1488 |
| contract_checker | 6 | 6 | 6 | 0 | 25 s | 50 s | 50 s | 21175/1869 |
| genre_judge | 6 | 6 | 6 | 0 | 27 s | 71 s | 71 s | 24485/1984 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 29 s | 56 s | 56 s | 21235/477 |
| plan_critic | 2 | 2 | 2 | 0 | 23 s | 28 s | 28 s | 11065/238 |
| power_system_designer | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 3002/753 |
| promise_checker | 6 | 6 | 6 | 0 | 22 s | 59 s | 59 s | 13387/849 |
| prose_judge | 6 | 6 | 6 | 0 | 27 s | 30 s | 30 s | 24558/2548 |
| repetition_judge | 3 | 3 | 3 | 0 | 23 s | 29 s | 29 s | 6781/244 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 49 s | 49 s | 49 s | 690/1303 |
| scene_planner | 2 | 2 | 2 | 0 | 35 s | 38 s | 38 s | 7950/2356 |
| scene_writer | 5 | 5 | 5 | 0 | 80 s | 102 s | 102 s | 41197/3874 |
| story_architect | 1 | 1 | 1 | 0 | 61 s | 61 s | 61 s | 8304/2858 |
| structure_judge | 6 | 6 | 7 | 1 | 23 s | 35 s | 35 s | 22553/2303 |
| targeted_reviser | 12 | 12 | 12 | 0 | 18 s | 27 s | 32 s | 34723/746 |
| voice_judge | 6 | 6 | 7 | 1 | 28 s | 34 s | 34 s | 23608/1711 |
| world_builder | 1 | 1 | 1 | 0 | 74 s | 74 s | 74 s | 2774/780 |
