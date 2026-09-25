# Run report — 01a0d78c-c62f-75ac-af8a-5e36252285ef

- Policy: `policy/standard@15`; manuscript language: `ko`; language layer: `lang/ko@7`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 53 (53 attempts, 0 failed); tokens in/out 210623/27301; cost 0¢
- Wall clock: 2026-09-25T07:52:08.765Z → 2026-09-25T08:20:59.549Z (1731 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 4 | 4 | rejected | 0 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 81 | 73.8/78 ✗ r75 l72 | 87.5/78 r75 l100 | 85/72 r81.3 | 95.7/76 r93.8 | 1/8/14 | TRN-KO-04×1, TRN-KO-14×6 |
| r1 | v2 | rejected | 83 | 75.4/78 ✗ r75 l76 | 90/78 r80 l100 | 90/72 r87.5 | 95.7/76 r93.8 | 0/2/21 | TRN-KO-04×1, TRN-KO-14×5 |
| r2 | v3 | rejected | 85 | 79.2/78 r81.3 l76 | 90/78 r80 l100 | 90/72 r87.5 | 95.7/76 r93.8 | 0/1/19 | TRN-KO-04×1, TRN-KO-14×5 |
| r3 | v4 | rejected | 85 | 79.2/78 r81.3 l76 | 90/78 r80 l100 | 80/72 r75 | 86.9/76 r81.3 | 0/7/14 | TRN-KO-04×1, TRN-KO-14×5 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 47 s | 47 s | 47 s | 7529/1930 |
| chapter_planner | 1 | 1 | 1 | 0 | 47 s | 47 s | 47 s | 11902/1733 |
| character_designer | 3 | 3 | 3 | 0 | 57 s | 59 s | 59 s | 10068/5277 |
| concept_generator | 2 | 2 | 2 | 0 | 39 s | 53 s | 53 s | 4857/1173 |
| continuity_checker | 4 | 4 | 4 | 0 | 29 s | 47 s | 47 s | 20352/593 |
| contract_checker | 4 | 4 | 4 | 0 | 22 s | 30 s | 30 s | 15199/1212 |
| genre_judge | 3 | 3 | 3 | 0 | 26 s | 30 s | 30 s | 11990/956 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 26 s | 49 s | 49 s | 12724/96 |
| plan_critic | 1 | 1 | 1 | 0 | 32 s | 32 s | 32 s | 3562/153 |
| power_system_designer | 1 | 1 | 1 | 0 | 55 s | 55 s | 55 s | 3040/781 |
| promise_checker | 2 | 2 | 2 | 0 | 12 s | 13 s | 13 s | 4626/124 |
| prose_judge | 4 | 4 | 4 | 0 | 21 s | 30 s | 30 s | 15904/1538 |
| repetition_judge | 3 | 3 | 3 | 0 | 18 s | 23 s | 23 s | 6662/328 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 37 s | 37 s | 37 s | 690/885 |
| scene_planner | 2 | 2 | 2 | 0 | 41 s | 47 s | 47 s | 8003/3144 |
| scene_writer | 3 | 3 | 3 | 0 | 61 s | 77 s | 77 s | 23230/1445 |
| story_architect | 1 | 1 | 1 | 0 | 66 s | 66 s | 66 s | 9031/3117 |
| structure_judge | 3 | 3 | 3 | 0 | 19 s | 28 s | 28 s | 10883/964 |
| targeted_reviser | 7 | 7 | 7 | 0 | 12 s | 23 s | 23 s | 20030/412 |
| voice_judge | 2 | 2 | 2 | 0 | 24 s | 55 s | 55 s | 7524/603 |
| world_builder | 1 | 1 | 1 | 0 | 34 s | 34 s | 34 s | 2817/837 |

