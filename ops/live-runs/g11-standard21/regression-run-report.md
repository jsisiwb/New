# Run report — 01a0d944-f1a3-780f-a1dc-178740d17402

- Policy: `policy/standard@21`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 71 (71 attempts, 0 failed); tokens in/out 280072/37349; cost 0¢
- Wall clock: 2026-09-25T15:52:53.945Z → 2026-09-25T16:28:19.444Z (2125 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 1 | 6 | rejected | 5 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 88 | 85.6/78 r81.3 l92 | 90/78 r80 l100 | 100/72 r100 | 86.9/76 r81.3 | 1/1/13 | drafts-regrip×1, KO-CONJ-RATE×1 |
| r1 | v2 (quarantined) | rejected | 86 | 82.4/78 r81.3 l84 | 90/78 r80 l100 | 80/72 r75 | 69.4/76 ✗ r56.3 | 0/6/12 | drafts-as-if-an-earthquake×1, drafts-regrip×1, KO-AIT-COUNT×1, KO-CONJ-RATE×1 |
| r2 | v3 (quarantined) | rejected | 86 | 87.2/78 r81.3 l96 | 85/78 r85 l85 | 95/72 r93.8 | 77.1/76 r68.8 | 0/3/12 | KO-PARA-LONG×1 |
| r3 | v4 (quarantined) | rejected | 88 | 88.8/78 r81.3 l100 | 87.5/78 r90 l85 | 95/72 r93.8 | 86/76 r81.3 | 2/3/8 | — |
| r4 | v5 (quarantined) | rejected | 88 | 90.9/78 r87.5 l96 | 85/78 r85 l85 | 85/72 r81.3 | 91.3/76 r87.5 | 0/3/13 | drafts-regrip×1 |
| r5 | v6 (quarantined) | rejected | 84 | 83.4/78 r75 l96 | 85/78 r85 l85 | 70/72 ✗ r62.5 | 91.3/76 r87.5 | 1/5/11 | drafts-regrip×1 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 54 s | 54 s | 54 s | 6952/1892 |
| chapter_planner | 2 | 2 | 2 | 0 | 47 s | 74 s | 74 s | 22255/2977 |
| character_designer | 3 | 3 | 3 | 0 | 50 s | 106 s | 106 s | 9118/4543 |
| concept_generator | 2 | 2 | 2 | 0 | 26 s | 34 s | 34 s | 3990/1017 |
| continuity_checker | 6 | 6 | 6 | 0 | 41 s | 86 s | 86 s | 28949/1402 |
| contract_checker | 6 | 6 | 6 | 0 | 29 s | 36 s | 36 s | 19115/1862 |
| genre_judge | 6 | 6 | 6 | 0 | 18 s | 24 s | 24 s | 18877/1678 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 20 s | 184 s | 184 s | 17552/34 |
| plan_critic | 2 | 2 | 2 | 0 | 28 s | 28 s | 28 s | 11006/235 |
| power_system_designer | 1 | 1 | 1 | 0 | 46 s | 46 s | 46 s | 2546/899 |
| promise_checker | 1 | 1 | 1 | 0 | 14 s | 14 s | 14 s | 2557/55 |
| prose_judge | 6 | 6 | 6 | 0 | 24 s | 34 s | 34 s | 22870/2215 |
| repetition_judge | 5 | 5 | 5 | 0 | 21 s | 23 s | 23 s | 9158/467 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 34 s | 34 s | 34 s | 664/938 |
| scene_planner | 2 | 2 | 2 | 0 | 31 s | 72 s | 72 s | 6917/2366 |
| scene_writer | 4 | 4 | 4 | 0 | 70 s | 101 s | 101 s | 29394/3589 |
| story_architect | 1 | 1 | 1 | 0 | 52 s | 52 s | 52 s | 8082/2939 |
| structure_judge | 6 | 6 | 6 | 0 | 24 s | 36 s | 36 s | 22581/1816 |
| targeted_reviser | 4 | 4 | 4 | 0 | 53 s | 68 s | 68 s | 16880/4317 |
| voice_judge | 5 | 5 | 5 | 0 | 27 s | 34 s | 34 s | 18209/1433 |
| world_builder | 1 | 1 | 1 | 0 | 38 s | 38 s | 38 s | 2400/675 |
