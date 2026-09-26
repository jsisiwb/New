# Run report — 01a0d996-a923-7751-b57d-04490955efd9

- Policy: `policy/standard@24`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: failed; next chapter 1 of 200; stop after 1
- Model calls: 101 (109 attempts, 10 failed); tokens in/out 387794/39074; cost 0¢
- Wall clock: 2026-09-25T17:22:09.254Z → 2026-09-25T18:38:37.975Z (4589 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 7 | 8 | rejected | 1 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 79 | 72.6/78 ✗ r75 l69 | 85.5/78 r75 l96 | 80/72 r75 | 66.3/76 ✗ r56.3 | 0/8/13 | AIT-KO-06×1, drafts-blood-reek×1, drafts-horrible-pain×1, drafts-regrip×1, KO-AIT-COUNT×1!, TRN-KO-14×5 |
| r1 | v2 (quarantined) | rejected | 80 | 74.8/78 ✗ r81.3 l65 | 85.5/78 r75 l96 | 80/72 r75 | 79.7/76 r75 | 1/11/14 | AIT-KO-05×1, AIT-KO-06×1, drafts-blood-reek×1, drafts-horrible-pain×1, KO-AIT-COUNT×1!, KO-TALK-SHARE-1P×1, TRN-KO-14×6 |
| r2 | v3 | rejected | 83 | 80.2/78 r75 l88 | 85.5/78 r75 l96 | 80/72 r75 | 83.8/76 r81.3 | 0/5/18 | drafts-horrible-pain×1, drafts-regrip×1, KO-AIT-COUNT×1, TRN-KO-14×5 |
| r3 | v4 | rejected | 87 | 88.8/78 r81.3 l100 | 85.5/78 r75 l96 | 95/72 r93.8 | 80.4/76 r75 | 1/5/13 | TRN-KO-14×5 |
| r4 | v5 | rejected | 85 | 81.3/78 r68.8 l100 | 88/78 r80 l96 | 90/72 r87.5 | 81.5/76 r75 | 0/6/10 | TRN-KO-14×5 |
| r5 | v6 | rejected | 88 | 87.2/78 r81.3 l96 | 88/78 r80 l96 | 75/72 r68.8 | 77.1/76 r68.8 | 0/4/13 | KO-END-02×1, TRN-KO-14×5 |
| r6 | v7 | rejected | 86 | 83.4/78 r75 l96 | 88/78 r80 l96 | 90/72 r87.5 | 90.2/76 r87.5 | 0/2/14 | KO-END-02×1, TRN-KO-14×5 |
| r7 | v8 | rejected | 86 | 83.4/78 r75 l96 | 88/78 r80 l96 | 85/72 r81.3 | 85.8/76 r81.3 | 0/3/15 | KO-END-02×1, TRN-KO-14×4 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 59 s | 59 s | 59 s | 7721/2259 |
| chapter_planner | 1 | 1 | 1 | 0 | 96 s | 96 s | 96 s | 12350/1703 |
| character_designer | 3 | 3 | 3 | 0 | 47 s | 55 s | 55 s | 8964/5286 |
| concept_generator | 2 | 2 | 2 | 0 | 37 s | 38 s | 38 s | 3964/1079 |
| continuity_checker | 8 | 8 | 9 | 1 | 50 s | 139 s | 139 s | 44505/1835 |
| contract_checker | 8 | 7 | 8 | 1 | 24 s | 37 s | 37 s | 26679/2038 |
| genre_judge | 8 | 8 | 8 | 0 | 23 s | 31 s | 31 s | 29065/2668 |
| knowledge_leak_checker | 7 | 7 | 11 | 4 | 27 s | 43 s | 43 s | 24754/137 |
| plan_critic | 2 | 2 | 2 | 0 | 37 s | 53 s | 53 s | 12283/319 |
| power_system_designer | 1 | 1 | 1 | 0 | 43 s | 43 s | 43 s | 2544/1069 |
| promise_checker | 3 | 3 | 3 | 0 | 15 s | 18 s | 18 s | 7466/150 |
| prose_judge | 8 | 8 | 9 | 1 | 24 s | 39 s | 39 s | 34695/3654 |
| repetition_judge | 4 | 4 | 4 | 0 | 19 s | 113 s | 113 s | 9671/438 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 30 s | 30 s | 30 s | 664/870 |
| scene_planner | 2 | 2 | 2 | 0 | 41 s | 61 s | 61 s | 6842/2430 |
| scene_writer | 4 | 4 | 4 | 0 | 56 s | 98 s | 98 s | 30405/3142 |
| story_architect | 1 | 1 | 1 | 0 | 66 s | 66 s | 66 s | 9040/3530 |
| structure_judge | 5 | 5 | 5 | 0 | 23 s | 34 s | 34 s | 21288/1740 |
| targeted_reviser | 23 | 22 | 25 | 3 | 20 s | 28 s | 33 s | 59429/1318 |
| voice_judge | 8 | 8 | 8 | 0 | 28 s | 39 s | 39 s | 33117/2572 |
| world_builder | 1 | 1 | 1 | 0 | 38 s | 38 s | 38 s | 2348/837 |
