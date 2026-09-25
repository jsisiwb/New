# Run report — 01a0d647-0a8c-763a-bd86-adea06db036c

- Policy: `policy/standard@14`; manuscript language: `ko`; language layer: `lang/ko@7`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 49 (52 attempts, 3 failed); tokens in/out 185354/28166; cost 0¢
- Wall clock: 2026-09-25T01:56:22.016Z → 2026-09-25T02:22:18.358Z (1556 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 1 | 4 | rejected | 3 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 80 | 82.4/78 r81.3 l84 | 77.5/78 ✗ r55 l100 | 85/72 r81.3 | 78.2/76 r68.8 | 2/7/13 | AIT-KO-05×1, KO-TALK-SHARE-1P×1, TRN-KO-08×1, TRN-KO-14×1 |
| r1 | v2 (quarantined) | rejected | 78 | 78.6/78 r75 l84 | 77.5/78 ✗ r55 l100 | 90/72 r87.5 | 78.2/76 r68.8 | 1/9/13 | AIT-KO-05×1, KO-TALK-SHARE-1P×1, TRN-KO-08×1, TRN-KO-14×1 |
| r2 | v3 (quarantined) | rejected | 76 | 82.4/78 r81.3 l84 | 70/78 ✗ r40 l100 | 75/72 r68.8 | 78.2/76 r68.8 | 1/12/11 | AIT-KO-05×1, KO-TALK-SHARE-1P×1, TRN-KO-08×1, TRN-KO-14×1 |
| r3 | v4 (quarantined) | rejected | 77 | 74.9/78 ✗ r68.8 l84 | 80/78 r60 l100 | 90/72 r87.5 | 78.2/76 r68.8 | 3/8/13 | AIT-KO-05×1, KO-TALK-SHARE-1P×1, TRN-KO-08×1, TRN-KO-14×1 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 53 s | 53 s | 53 s | 7906/2061 |
| chapter_planner | 1 | 1 | 3 | 2 | 44 s | 44 s | 44 s | 11722/1257 |
| character_designer | 3 | 3 | 3 | 0 | 56 s | 77 s | 77 s | 8521/5270 |
| concept_generator | 2 | 2 | 2 | 0 | 36 s | 39 s | 39 s | 4096/1043 |
| continuity_checker | 4 | 4 | 4 | 0 | 24 s | 61 s | 61 s | 18972/955 |
| contract_checker | 2 | 2 | 2 | 0 | 29 s | 32 s | 32 s | 6741/677 |
| genre_judge | 4 | 4 | 4 | 0 | 24 s | 29 s | 29 s | 14340/1367 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 26 s | 39 s | 39 s | 12072/255 |
| power_system_designer | 1 | 1 | 1 | 0 | 53 s | 53 s | 53 s | 2648/1018 |
| promise_checker | 1 | 1 | 1 | 0 | 20 s | 20 s | 20 s | 2397/58 |
| prose_judge | 4 | 4 | 4 | 0 | 21 s | 30 s | 30 s | 16212/1866 |
| repetition_judge | 4 | 4 | 4 | 0 | 28 s | 33 s | 33 s | 9301/884 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 50 s | 50 s | 50 s | 664/984 |
| scene_planner | 1 | 1 | 1 | 0 | 54 s | 54 s | 54 s | 2724/1466 |
| scene_writer | 3 | 3 | 3 | 0 | 59 s | 74 s | 74 s | 19271/1551 |
| story_architect | 1 | 1 | 1 | 0 | 81 s | 81 s | 81 s | 9011/4122 |
| structure_judge | 4 | 4 | 4 | 0 | 26 s | 40 s | 40 s | 16576/1806 |
| targeted_reviser | 6 | 6 | 6 | 0 | 20 s | 23 s | 23 s | 15957/318 |
| voice_judge | 1 | 1 | 1 | 0 | 27 s | 27 s | 27 s | 3816/350 |
| world_builder | 1 | 1 | 2 | 1 | 70 s | 70 s | 70 s | 2407/858 |

