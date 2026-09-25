# Run report — 01a0d7b0-8029-7e0b-9ffa-c47da2a65ce0

- Policy: `policy/standard@17`; manuscript language: `ko`; language layer: `lang/ko@7`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 61 (61 attempts, 0 failed); tokens in/out 269711/30448; cost 0¢
- Wall clock: 2026-09-25T08:31:09.475Z → 2026-09-25T09:06:38.889Z (2129 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 4 | 6 | rejected | 2 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 83 | 85.6/78 r81.3 l92 | 80/78 r60 l100 | 70/72 ✗ r62.5 | 91.3/76 r87.5 | 1/7/11 | KO-PARA-LONG×1, KO-TALK-SHARE-1P×1 |
| r1 | v2 | rejected | 85 | 85.6/78 r81.3 l92 | 85/78 r70 l100 | 90/72 r87.5 | 91.3/76 r87.5 | 0/2/14 | KO-PARA-LONG×1, KO-TALK-SHARE-1P×1 |
| r2 | v3 | rejected | 83 | 85.6/78 r81.3 l92 | 80/78 r60 l100 | 90/72 r87.5 | 91.3/76 r87.5 | 1/1/16 | KO-PARA-LONG×1, KO-TALK-SHARE-1P×1 |
| r3 | v4 (quarantined) | rejected | 83 | 85.6/78 r81.3 l92 | 80/78 r60 l100 | 100/72 r100 | 65/76 ✗ r50 | 1/7/11 | KO-PARA-LONG×1, KO-TALK-SHARE-1P×1 |
| r4 | v5 (quarantined) | rejected | 83 | 85.6/78 r81.3 l92 | 80/78 r60 l100 | 90/72 r87.5 | 91.3/76 r87.5 | 0/2/17 | KO-PARA-LONG×1, KO-TALK-SHARE-1P×1 |
| r5 | v6 | rejected | 83 | 85.6/78 r81.3 l92 | 80/78 r60 l100 | 90/72 r87.5 | 91.3/76 r87.5 | 1/0/16 | KO-PARA-LONG×1, KO-TALK-SHARE-1P×1 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 68 s | 68 s | 68 s | 8341/1633 |
| chapter_planner | 2 | 2 | 2 | 0 | 49 s | 102 s | 102 s | 25666/3056 |
| character_designer | 3 | 3 | 3 | 0 | 58 s | 69 s | 69 s | 9114/5467 |
| concept_generator | 2 | 2 | 2 | 0 | 42 s | 48 s | 48 s | 4047/1155 |
| continuity_checker | 6 | 6 | 6 | 0 | 50 s | 66 s | 66 s | 35840/1790 |
| contract_checker | 4 | 4 | 4 | 0 | 21 s | 31 s | 31 s | 15624/1336 |
| genre_judge | 3 | 3 | 3 | 0 | 26 s | 27 s | 27 s | 10955/833 |
| knowledge_leak_checker | 4 | 4 | 4 | 0 | 41 s | 51 s | 51 s | 14432/204 |
| plan_critic | 2 | 2 | 2 | 0 | 25 s | 32 s | 32 s | 13323/251 |
| power_system_designer | 1 | 1 | 1 | 0 | 46 s | 46 s | 46 s | 2704/1183 |
| promise_checker | 2 | 2 | 2 | 0 | 15 s | 32 s | 32 s | 4935/108 |
| prose_judge | 2 | 2 | 2 | 0 | 25 s | 33 s | 33 s | 8250/903 |
| repetition_judge | 2 | 2 | 2 | 0 | 21 s | 31 s | 31 s | 4746/169 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 35 s | 35 s | 35 s | 664/896 |
| scene_planner | 2 | 2 | 2 | 0 | 41 s | 52 s | 52 s | 7282/3033 |
| scene_writer | 4 | 4 | 4 | 0 | 45 s | 62 s | 62 s | 32650/2043 |
| story_architect | 1 | 1 | 1 | 0 | 60 s | 60 s | 60 s | 9833/2707 |
| structure_judge | 4 | 4 | 4 | 0 | 25 s | 151 s | 151 s | 17019/1403 |
| targeted_reviser | 12 | 12 | 12 | 0 | 17 s | 31 s | 41 s | 33840/776 |
| voice_judge | 2 | 2 | 2 | 0 | 25 s | 31 s | 31 s | 7985/642 |
| world_builder | 1 | 1 | 1 | 0 | 32 s | 32 s | 32 s | 2461/860 |

