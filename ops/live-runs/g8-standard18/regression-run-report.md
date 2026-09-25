# Run report — 01a0d7e7-5670-77b9-85fa-cce9e4d09f08

- Policy: `policy/standard@18`; manuscript language: `ko`; language layer: `lang/ko@8`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 79 (79 attempts, 1 failed); tokens in/out 294728/31343; cost 0¢
- Wall clock: 2026-09-25T09:31:02.493Z → 2026-09-25T10:18:56.099Z (2874 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 4 | 6 | rejected | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 76 | 61.5/78 ✗ r62.5 l60 | 90/78 r80 l100 | 80/72 r75 | 81/76 r75 | 2/5/20 | AIT-KO-06×1, KO-END-02×1, TRN-KO-14×8 |
| r1 | v2 | rejected | 78 | 66.9/78 ✗ r68.8 l64 | 90/78 r80 l100 | 90/72 r87.5 | 81/76 r75 | 0/5/18 | AIT-KO-06×1, KO-END-02×1, TRN-KO-14×7 |
| r2 | v3 (quarantined) | rejected | 81 | 72.2/78 ✗ r75 l68 | 90/78 r80 l100 | 95/72 r93.8 | 81/76 r75 | 1/4/20 | AIT-KO-06×1, KO-END-02×1, TRN-KO-14×6 |
| r3 | v4 | rejected | 81 | 72.2/78 ✗ r75 l68 | 90/78 r80 l100 | 85/72 r81.3 | 81/76 r75 | 1/3/18 | AIT-KO-06×1, KO-END-02×1, TRN-KO-14×6 |
| r4 | v5 | rejected | 83 | 75.4/78 ✗ r75 l76 | 90/78 r80 l100 | 80/72 r75 | 76.6/76 r68.8 | 2/2/20 | AIT-KO-06×1, KO-END-02×1, TRN-KO-14×4 |
| r5 | v6 (quarantined) | rejected | 76 | 62/78 ✗ r50 l80 | 90/78 r80 l100 | 90/72 r87.5 | 76.6/76 r68.8 | 3/1/19 | KO-END-02×1, TRN-KO-14×4 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 51 s | 51 s | 51 s | 7134/2002 |
| chapter_planner | 1 | 1 | 1 | 0 | 50 s | 50 s | 50 s | 11688/1577 |
| character_designer | 4 | 3 | 4 | 1 | 49 s | 121 s | 121 s | 8569/4969 |
| concept_generator | 2 | 2 | 2 | 0 | 40 s | 90 s | 90 s | 3916/1037 |
| continuity_checker | 6 | 6 | 6 | 0 | 44 s | 48 s | 48 s | 33006/1531 |
| contract_checker | 6 | 6 | 6 | 0 | 21 s | 39 s | 39 s | 21861/1599 |
| genre_judge | 6 | 6 | 6 | 0 | 22 s | 29 s | 29 s | 21282/1872 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 15 s | 37 s | 37 s | 21267/188 |
| plan_critic | 2 | 2 | 2 | 0 | 24 s | 45 s | 45 s | 11867/277 |
| power_system_designer | 1 | 1 | 1 | 0 | 48 s | 48 s | 48 s | 2388/937 |
| promise_checker | 2 | 2 | 2 | 0 | 13 s | 15 s | 15 s | 4810/104 |
| prose_judge | 6 | 6 | 6 | 0 | 32 s | 52 s | 52 s | 25296/2880 |
| repetition_judge | 3 | 3 | 3 | 0 | 32 s | 35 s | 35 s | 6948/435 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 31 s | 31 s | 31 s | 664/800 |
| scene_planner | 2 | 2 | 2 | 0 | 48 s | 55 s | 55 s | 6698/3094 |
| scene_writer | 3 | 3 | 3 | 0 | 45 s | 47 s | 47 s | 22322/1525 |
| story_architect | 1 | 1 | 1 | 0 | 58 s | 58 s | 58 s | 8526/2812 |
| structure_judge | 2 | 2 | 2 | 0 | 23 s | 26 s | 26 s | 8306/700 |
| targeted_reviser | 20 | 20 | 20 | 0 | 14 s | 31 s | 35 s | 54097/1289 |
| voice_judge | 3 | 3 | 3 | 0 | 34 s | 45 s | 45 s | 11867/955 |
| world_builder | 1 | 1 | 1 | 0 | 31 s | 31 s | 31 s | 2216/760 |

