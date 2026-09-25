# Run report — 01a0d647-6b07-7c6e-86ab-c9d8323a56f6

- Policy: `policy/standard@14`; manuscript language: `ko`; language layer: `lang/ko@7`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 46 (46 attempts, 0 failed); tokens in/out 183057/23549; cost 0¢
- Wall clock: 2026-09-25T01:56:45.972Z → 2026-09-25T02:20:56.583Z (1451 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 1 | 4 | rejected | 3 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 76 | 75.4/78 ✗ r75 l76 | 77.5/78 ✗ r55 l100 | 100/72 r100 | 91.3/76 r87.5 | 0/7/18 | KO-PARA-LONG×1, TRN-KO-14×5 |
| r1 | v2 (quarantined) | rejected | 79 | 75.4/78 ✗ r75 l76 | 83/78 r70 l96 | 90/72 r87.5 | 91.3/76 r87.5 | 1/3/18 | KO-PARA-LONG×1, TRN-KO-14×5 |
| r2 | v3 (quarantined) | rejected | 78 | 75.4/78 ✗ r75 l76 | 80.5/78 r65 l96 | 90/72 r87.5 | 91.3/76 r87.5 | 0/4/20 | KO-PARA-LONG×1, TRN-KO-14×5 |
| r3 | v4 (quarantined) | rejected | 82 | 75.4/78 ✗ r75 l76 | 88/78 r80 l96 | 90/72 r87.5 | 91.3/76 r87.5 | 1/1/18 | KO-PARA-LONG×1, TRN-KO-14×5 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 72 s | 72 s | 72 s | 7546/1910 |
| chapter_planner | 1 | 1 | 1 | 0 | 73 s | 73 s | 73 s | 11332/1596 |
| character_designer | 3 | 3 | 3 | 0 | 53 s | 77 s | 77 s | 9440/5175 |
| concept_generator | 2 | 2 | 2 | 0 | 47 s | 48 s | 48 s | 4744/995 |
| continuity_checker | 4 | 4 | 4 | 0 | 32 s | 34 s | 34 s | 21043/1320 |
| contract_checker | 2 | 2 | 2 | 0 | 28 s | 34 s | 34 s | 7247/451 |
| genre_judge | 4 | 4 | 4 | 0 | 18 s | 26 s | 26 s | 16383/1106 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 33 s | 83 s | 83 s | 12971/213 |
| power_system_designer | 1 | 1 | 1 | 0 | 50 s | 50 s | 50 s | 2932/665 |
| promise_checker | 4 | 4 | 4 | 0 | 12 s | 24 s | 24 s | 9283/121 |
| prose_judge | 1 | 1 | 1 | 0 | 27 s | 27 s | 27 s | 4051/437 |
| repetition_judge | 1 | 1 | 1 | 0 | 22 s | 22 s | 22 s | 2297/92 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 45 s | 45 s | 45 s | 690/1124 |
| scene_planner | 1 | 1 | 1 | 0 | 44 s | 44 s | 44 s | 3507/1134 |
| scene_writer | 3 | 3 | 3 | 0 | 53 s | 58 s | 58 s | 22747/1554 |
| story_architect | 1 | 1 | 1 | 0 | 61 s | 61 s | 61 s | 9044/2502 |
| structure_judge | 4 | 4 | 4 | 0 | 29 s | 40 s | 40 s | 14923/1504 |
| targeted_reviser | 6 | 6 | 6 | 0 | 23 s | 31 s | 31 s | 16338/420 |
| voice_judge | 1 | 1 | 1 | 0 | 34 s | 34 s | 34 s | 3828/292 |
| world_builder | 1 | 1 | 1 | 0 | 104 s | 104 s | 104 s | 2711/938 |

