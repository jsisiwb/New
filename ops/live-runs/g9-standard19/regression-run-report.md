# Run report — 01a0d86d-faaf-7a1a-a7cc-8a1d6de03fc6

- Policy: `policy/standard@19`; manuscript language: `ko`; language layer: `lang/ko@8`
- Run: needs_attention; next chapter 1 of 200; stop after 1
- Model calls: 79 (80 attempts, 1 failed); tokens in/out 332188/36282; cost 0¢
- Wall clock: 2026-09-25T11:58:05.368Z → 2026-09-25T12:35:57.317Z (2272 s)

## Chapters

| 화 | status | 자 | 자 (공백 제외) | versions | rounds | final gate | quarantined | plan check |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | revising | — | — | 1 | 6 | rejected | 5 | — |

### 화 1

| round | version | gate | overall | prose | structure | genre | voice | blocking/major/minor | lint findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r0 | v1 | rejected | 87 | 89.3/78 r87.5 l92 | 85/78 r70 l100 | 90/72 r87.5 | 87.5/76 r87.5 | 0/7/14 | drafts-cold-smile×1, TRN-KO-14×1 |
| r1 | v2 (quarantined) | rejected | 83 | 75.4/78 ✗ r75 l76 | 90/78 r80 l100 | 90/72 r87.5 | 78.9/76 r75 | 4/7/16 | drafts-cold-smile×1, KO-CONJ-RATE×1, TRN-KO-14×4 |
| r2 | v3 (quarantined) | rejected | 88 | 80.8/78 r81.3 l80 | 95/78 r90 l100 | 90/72 r87.5 | 89.5/76 r87.5 | 1/5/16 | drafts-cold-smile×1, drafts-regrip×1, KO-AIT-COUNT×1, TRN-KO-14×2 |
| r3 | v4 (quarantined) | rejected | 89 | 90.9/78 r87.5 l96 | 87.5/78 r75 l100 | 85/72 r81.3 | 83.2/76 r81.3 | 0/2/15 | TRN-KO-14×1 |
| r4 | v5 (quarantined) | rejected | 87 | 90.9/78 r87.5 l96 | 82.5/78 r65 l100 | 85/72 r81.3 | 87.5/76 r87.5 | 0/4/15 | TRN-KO-14×1 |
| r5 | v6 (quarantined) | rejected | 91 | 89.3/78 r87.5 l92 | 92.5/78 r85 l100 | 85/72 r81.3 | 96.3/76 r100 | 0/3/15 | KO-CONJ-RATE×1, TRN-KO-14×1 |

## Model calls by role

| role | calls | ok | attempts | failed attempts | p50 | p90 | max | tokens in/out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc_planner | 1 | 1 | 1 | 0 | 60 s | 60 s | 60 s | 7171/2043 |
| chapter_planner | 3 | 3 | 3 | 0 | 47 s | 54 s | 54 s | 35123/3961 |
| character_designer | 3 | 3 | 3 | 0 | 56 s | 57 s | 57 s | 8937/4995 |
| concept_generator | 2 | 2 | 2 | 0 | 37 s | 42 s | 42 s | 3934/968 |
| continuity_checker | 6 | 6 | 6 | 0 | 47 s | 71 s | 71 s | 33956/1350 |
| contract_checker | 6 | 6 | 6 | 0 | 35 s | 46 s | 46 s | 20894/2244 |
| genre_judge | 6 | 6 | 6 | 0 | 27 s | 36 s | 36 s | 21262/1864 |
| knowledge_leak_checker | 6 | 6 | 6 | 0 | 22 s | 83 s | 83 s | 21472/174 |
| plan_critic | 2 | 2 | 2 | 0 | 32 s | 37 s | 37 s | 11718/261 |
| power_system_designer | 1 | 1 | 1 | 0 | 42 s | 42 s | 42 s | 2513/911 |
| promise_checker | 1 | 1 | 1 | 0 | 19 s | 19 s | 19 s | 2307/9 |
| prose_judge | 6 | 6 | 6 | 0 | 24 s | 31 s | 31 s | 24790/2335 |
| repetition_judge | 3 | 3 | 3 | 0 | 28 s | 29 s | 29 s | 6987/568 |
| requirement_interpreter | 1 | 1 | 1 | 0 | 40 s | 40 s | 40 s | 664/909 |
| scene_planner | 2 | 2 | 2 | 0 | 30 s | 34 s | 34 s | 6694/2358 |
| scene_writer | 4 | 4 | 5 | 1 | 88 s | 118 s | 118 s | 31173/2892 |
| story_architect | 1 | 1 | 1 | 0 | 65 s | 65 s | 65 s | 8570/2795 |
| structure_judge | 6 | 6 | 6 | 0 | 22 s | 27 s | 27 s | 24962/2131 |
| targeted_reviser | 12 | 12 | 12 | 0 | 17 s | 28 s | 32 s | 32865/798 |
| voice_judge | 6 | 6 | 6 | 0 | 31 s | 35 s | 35 s | 23857/1799 |
| world_builder | 1 | 1 | 1 | 0 | 49 s | 49 s | 49 s | 2339/917 |
