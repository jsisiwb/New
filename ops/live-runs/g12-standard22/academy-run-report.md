# Run report — 01a0d956-8001-7df3-a2ce-32ee09e3aefe

- Policy: `policy/standard@22`; manuscript language: `ko`; language layer: `lang/ko@9`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 80 (80 attempts, 0 failed); tokens in/out 363743/39851; cost 0¢
- Wall clock: 2026-09-25T16:12:04.111Z → 2026-09-25T16:48:59.105Z (2215 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 5 | 6 | rejected | 1 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 66 | 51.4/78 ✗ r56.3 l44 | 80/78 r60 l100 | 70/72 ✗ r62.5 | 84.1/76 r81.3 | 3/3/26 | drafts-narrowed-eyes×1, KO-CONJ-RATE×1, TRN-KO-01×1, TRN-KO-14×11 |
| r1 | v2 (quarantined) | rejected | 69 | 63.1/78 ✗ r62.5 l64 | 75/78 ✗ r50 l100 | 80/72 r75 | 66.2/76 ✗ r56.3 | 5/6/16 | TRN-KO-14×9 |
| r2 | v3 | rejected | 69 | 54.6/78 ✗ r56.3 l52 | 82.5/78 r65 l100 | 80/72 r75 | 84.1/76 r81.3 | 2/4/26 | drafts-narrowed-eyes×1, TRN-KO-14×11 |
| r3 | v4 | rejected | 71 | 59.9/78 ✗ r62.5 l56 | 82.5/78 r65 l100 | 80/72 r75 | 84.3/76 r81.3 | 1/1/27 | TRN-KO-14×11 |
| r4 | v5 | rejected | 72 | 63.1/78 ✗ r62.5 l64 | 80/78 r60 l100 | 95/72 r93.8 | 75.5/76 ✗ r68.8 | 1/5/18 | TRN-KO-14×9 |
| r5 | v6 | rejected | 78 | 66.9/78 ✗ r68.8 l64 | 90/78 r80 l100 | 95/72 r93.8 | 72/76 ✗ r62.5 | 0/4/17 | TRN-KO-14×9 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 64 s | 64 s | 64 s | 9056/2077 |
| chapter_planner | 2 | 2 | 2 | 0 | 88 s | 115 s | 115 s | 27853/3651 |
| character_designer | 3 | 3 | 3 | 0 | 53 s | 77 s | 77 s | 10481/5988 |
| concept_generator | 2 | 2 | 2 | 0 | 31 s | 34 s | 34 s | 4930/1017 |
| continuity_checker | 6 | 6 | 6 | 0 | 59 s | 79 s | 79 s | 39454/1811 |
| contract_checker | 6 | 6 | 6 | 0 | 28 s | 56 s | 56 s | 23596/2344 |
| genre_judge | 4 | 4 | 4 | 0 | 28 s | 41 s | 41 s | 16712/1216 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 26 s | 42 s | 42 s | 24825/130 |
| plan_critic | 2 | 2 | 2 | 0 | 29 s | 39 s | 39 s | 13493/243 |
| power_system_designer | 1 | 1 | 1 | 0 | 47 s | 47 s | 47 s | 3068/827 |
| promise_checker | 3 | 3 | 3 | 0 | 18 s | 32 s | 32 s | 7583/411 |
| prose_judge | 6 | 6 | 6 | 0 | 28 s | 40 s | 40 s | 26202/2781 |
| repetition_judge | 3 | 3 | 3 | 0 | 22 s | 24 s | 24 s | 6995/233 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 39 s | 39 s | 39 s | 690/1263 |
| scene_planner | 2 | 2 | 2 | 0 | 31 s | 37 s | 37 s | 8984/2315 |
| scene_writer | 4 | 4 | 4 | 0 | 76 s | 102 s | 102 s | 37157/3389 |
| story_architect | 1 | 1 | 1 | 0 | 90 s | 90 s | 90 s | 9955/4390 |
| structure_judge | 6 | 6 | 6 | 0 | 31 s | 35 s | 35 s | 23081/2312 |
| targeted_reviser | 16 | 16 | 16 | 0 | 12 s | 19 s | 21 s | 49373/1037 |
| voice_judge | 4 | 4 | 4 | 0 | 26 s | 53 s | 53 s | 17407/1453 |
| world_builder | 1 | 1 | 1 | 0 | 46 s | 46 s | 46 s | 2848/963 |
