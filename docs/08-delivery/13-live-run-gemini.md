# Live runs on Gemini through the Notion bridge

From 2026-09-24 every role runs on one model, which the operator names as Gemini 3.1 Pro, served through the
Notion bridge (`YEONJAE_PROVIDER_MODE=notion`). The model id comes from `YEONJAE_NOTION_MODEL` (also set as
`YEONJAE_MODEL_NOTION`, ADR-0080); no value is recorded here. Novel data lives in the operator's permanent
PostgreSQL 16. Every manuscript sentence quoted in this file was written by the pipeline; this file's author
wrote only intakes (configuration) and analysis. Spend is recorded as the bridge's billing-period points per
workspace (`bridge:credits`), because the bridge prices no call.

Sections follow the order of the run's phases. Each chapter run records what `12-live-run-ws1-7.md` §8
records: length, rounds, gate per dimension, blocking/major counts, lint, calls, tokens, credits and a
three-line excerpt copied from the output.

## 0. Provider readiness (Phase 0, ADR-0080)

Raw wire probes and `provider:check --probe --deep` against the bridge, 22:38–23:02 UTC.

| Probe | Result |
| --- | --- |
| One-word reply | `확인`, 6.9 s, usage reported (87 in / 1 out) |
| Identity (Korean question) | the reply names **Google Gemini** (no version); 7.6 s. `provider:check --deep` on the P route: `gemini` |
| JSON-only answer | clean JSON, **no code fence**; the bridge also returns a parsed `json` field; 10.2 s. Gateway recovery that would fire: none |
| Long structured answer | a 1,500-integer array, 7,894 characters, **complete**, `finishReason: stop`, 59.3 s; no truncation |
| Reply fields | `text`, `json`, `finishReason`, `usage{input,output,cached}`, `modelId` (echoes the request), `providerRequestId`, `latencyMs`, `workspaceIndex`, `workspaceId` |
| Contention | probes sent while a live run held the pool failed in 1.5–1.9 s as empty completions (`retryable_provider`); the bridge's failed-request counters rose with them. In the gateway these are retried with backoff (ADR-0072); the direct probes are not |
| Cost of a tiny call | 0.05–0.08 billing-period points (readings lag a few seconds) |

Credits at the start of this run: workspace 1 at 66.07 %, workspace 2 at 76.68 % of the billing period (the
same readings as the end of the previous session). The period ends 2026-10-09.

Normalizers for Gemini: the probes needed none. Chapter runs record the workflow normalizers
(`novel:run --metrics-log`) and, per attempt, the gateway's JSON recoveries (`json_fence_stripped`,
`json_object_extracted`).

## 1. G1 — Gemini baseline on `standard.v11` (22:45–23:17 UTC)

A fresh project on the Phase A intake (`ops/live-runs/phase-a-v7-intake.json`: regression + hunter-gate,
first person, 200화 × 5,300자), pinned to `policy/standard@11` with no code change that affects v11. The first
of the two concepts was approved (as in every earlier run), `--stop-after=1`.

| Measure | Value |
| --- | --- |
| Start → concepts | 2 min 20 s; approval → chapter 1 stop 29 min |
| Length | **3,965자** against 5,300 (−25 %): scene 1 1,545자 for a 1,440 request (target 1,800), scene 2 2,580자 for a ~3,000 request (target 3,500) |
| Scenes | 2 (the scene planner planned 10 % dialogue for scene 1, 50 % for scene 2) |
| Rounds | r0 + three; every patched round quarantined |
| Gate (r0) | prose **34.2**/78 ✗ (rubric 56.3, lint composite 1), structure 93.5/78 (rubric 90), genre 90/72, voice 86.9/76 |
| Blocking/major by round | r0 3/12, r1 3/3, r2 4/2, r3 2/2 |
| r0 blockings | continuity ×2 (the bible gives the narrator a permanently blocked sense of pain, yet the opening is the pain of his death; the premise's "ten days before the first gate" against the bible's gate-to-break timing); knowledge leak: a secret due at 22화 stated in chapter 1 (A-4) |
| r0 majors | `KO-PARA-CHARS` ×3 and `KO-PARA-LONG` (see §2: a line-layout artifact), `KO-DLG-SHARE` 14 %, `LEN-01` −25 %, knowledge (the narrator knows another character's hidden ledger), prose judge (paragraphs; "뱀 같은 눈" twice and "입꼬리가 비릿하게 말려 올라갔다"), genre and voice judges (속마음 in 존댓말, three findings) |
| Korean lint (r0) | `KO-PARA-CHARS`×3!, `KO-PARA-LONG`×1!, `KO-DLG-SHARE`×1!, `TRN-KO-14`×6 |
| Normalizers | `judge_quote_anchor` 52, `contract_location_fallback` 1, `contract_output` 1, `quote_marks_folded` 1; gateway JSON recoveries 0 (JSON came back unfenced) |
| Calls | 47 calls, 75 attempts (28 failed attempts: empty completions and 5xx from the bridge while calls ran in parallel; all retried) |
| Tokens | 150,428 in / 24,748 out |
| Per role p50 | scene writer 37 s (p90 91 s), chapter planner 42 s, prose judge 30 s, continuity checker 32 s, reviser 35 s |
| Credits | workspace 1 66.20 % → 68.12 %, workspace 2 76.76 % → 78.13 %: **3.29 points** |

Excerpt (the first three lines of the pipeline's chapter 1, unedited):

> 살점이 뜯겨 나가는 감각이 생생했다.
> 목줄기를 파고들던 몬스터의 톱니 같은 이빨. 뼈가 으스러지는 소리. 사방으로 튀던 질척한 핏물.
> 분명히 내장이 파헤쳐지며 죽었는데, 온몸을 짓누르던 끔찍한 고통이 거짓말처럼 썰물 빠지듯 사라졌다.

## 2. G2 — Gemini against the previous model on the same policy

| | §8.4 (`standard.v11`, previous model) | G1 (`standard.v11`, Gemini) | Driven by |
| --- | --- | --- | --- |
| Length | 5,331자 (+0.6 %) | 3,965자 (−25 %) | **model**: Gemini returns 0.86–1.07 of a request that was calibrated for a +27 % overshoot |
| Scenes | 3 | 2 | planner (model-dependent) |
| r0 blocking/major | 3/6 | 3/12 | — |
| Paragraph majors | 0 | 4 | **model**: line breaks inside blank-line blocks; re-linted with one paragraph per line, the longest paragraph is 77자 and both rules pass |
| Dialogue + 속마음 share | 14 % | 14 % | **pipeline**: the opening scene is planned at 10 % dialogue; the floor question is A5 (Phase C4/U6) |
| 속마음 register | — | 존댓말 in the inner voice (3 majors) | **model** |
| Reveal ahead of schedule | yes (A-4) | yes (A-4) | **pipeline**: the chapter planner does not see reveal chapters (Phase U1) |
| Genre vocabulary | possession terms in a regression serial | none this time | pipeline (G-1, Phase U2) |
| Continuity vs the bible | — | trait and world-rule timing | **pipeline**: no time frames or trait constraints in the contract (Phase U3/U7) |
| Gate at r0 | structure 77.3 ✗ | prose 34.2 ✗ | both |
| Calls / tokens | 39 / 141K in | 47 (75 attempts) / 150K in | — |
| Credits | 3.71 points | 3.29 points | — |

Gemini-specific adjustments (ADR-0081, `standard.v12`): request 1.1 × the scene target; one paragraph per
line, in the writer's instructions and deterministically at the draft; 속마음 in 반말 only. Same-model judging:
the structure judge rated this −25 %, two-scene chapter 90, so the length finding now counts against the
structure composite and the structure judge's weight moves from 0.65 to 0.5; every judge quotes its three
weakest passages before scoring against an anchored rubric; any rubric more than 30 points above its
deterministic composite is capped there.

## 3. G3b — the `standard.v12` checkpoint (00:17–00:36 UTC, 2026-09-25)

Chapter 1 of a fresh regression project (`ops/live-runs/phase-a-v7-intake.json`, first person) on
`standard@12`, driven by `novel:start` → approve concept 1 of 2 → `novel:run --stop-after=1`. (The first
attempt, G3, could not start: the bridge answered 502 on both workspaces from 23:50 UTC; it recovered by 00:17.)

| | G3b |
| --- | --- |
| Length | **6,008자** against 5,300 (+13 %): `request_ratio` 1.1 now overshoots where 0.8 undershot by 25 % |
| Rounds | r0 to r3, every revision round the policy allows; r2 and r3 quarantined; run stopped `needs_attention` (not accepted) |
| r0 gate | overall 60: prose 51.9 ✗ (rubric 62.5, lint 36), structure 68 ✗ (rubric 40, lint 96), genre 85, voice 91.3 |
| Best round | r1: overall 74, prose 79.6 ✓, structure 68 ✗ |
| Blocking / major | r0 1 / 11; r1–r3 1 / 7 |
| The blocking | structure judge: dialogue share 2 %, the only lines are monologue beats, no exchange between characters |
| Lint (r0) | `KO-DLG-SHARE` (5 % against a 25 % floor), `KO-IDIOM-01` ×3 ("빌어먹을"), `TRN-KO-03` |
| Other majors | future knowledge and hidden-skill conditions recited for 14 paragraphs (19–32); ending on the hero's own summary; a skill working before the system opens (promise checker); `에러` inside a system message (continuity checker, world rule) |
| Calls / tokens | 34 (34 attempts, 0 failed) / 124,783 in, 21,587 out; 1,123 s |
| Credits | ws1 68.16 → 68.96 %, ws2 78.13 → 80.50 % (3.17 points) |
| Likeness (C8) | 50 (operator p10 65 / p50 85); G1 75 — `docs/10-corpus/voice-calibration.md` §3 |

Excerpt (the pipeline's first three lines):

> 역겨운 곰팡내가 훅 끼쳤다.
> 심연의 제1군주. 그 빌어먹을 놈의 심장에 창을 박아넣으며 내 몸도 갈가리 찢겨 나갔을 터였다.
> 그런데 뼈가 숯검정으로 녹아내리는 고통 대신, 등허리에 축축하고 미적지근한 장판의 감각이 닿았다.

**What it shows.**

- **G3-1 (revision loop):** the structure dimension was scored once. `evaluation.reevaluation: targeted` re-runs
  the judges whose findings a patch touched; the patches were prose patches, so structure stayed 68 with the same
  blocking in every round. A structural defect cannot be cleared by patching prose — Phase V2.
- **G3-2 (plan):** the chapter was planned with the hero alone; no revision can add a scene partner. The planner
  must carry dialogue beats and an on-stage counterpart (U6; the operator's first-person 화 1–25 median is 25 %).
- **G3-3 (plan):** future knowledge is recited as a block (A-4) — the reveal schedule does not reach the chapter
  plan (U1).
- **G3-4 (judges):** the prose judge called "빌어먹을" a translated Western curse; it is one of book 1's tics.
  `standard@13` gives judges the operator's conventions (ADR-0083).

## 4. G4 — the `standard.v13` checkpoint on both projects (01:21–01:48 UTC)

Chapter 1 of two fresh projects on `standard@13` (the operator's voice, ADR-0083), run in parallel: the regression
project (`phase-a-v7-intake.json`, G4r) and the academy/harem/possession/먼치킨 project
(`phase-c-academy-intake.json`, G4a). Both identities composed `lang/ko@7`, copied `voice/operator@1` and pinned four of
the operator's passages (hook, banter, status window, cliffhanger; one from book 2 for the status window).

| | G4r (regression) | G4a (academy) |
| --- | --- | --- |
| Length | 5,407자 (+2 %) | 5,784자 (+9 %) |
| First line | `서걱.` (a sound, as the voice profile asks) | `[모든 히든 스탯 한계 돌파가 완료되었습니다.]` (a status window) |
| r0 gate | overall 74: prose 74.9 ✗, structure 72.5 ✗, genre 70 ✗, voice 100 | overall 81: prose 87.7, structure 75 ✗, genre 85, voice 100 |
| Rounds | r0 to r3; r1 and r2 quarantined; best r3 overall 75 | r0 to r3; every patched round quarantined |
| Blocking / major | r0 2 / 7 → r3 1 / 7 | r0 2 / 7 → r2 1 / 5 |
| Result | not accepted (`needs_attention`) | not accepted (`needs_attention`) |
| Likeness (C8) | 55 | — |
| Calls / tokens | 39 / 147,577 in, 22,915 out; 1,347 s | 42 |

Credits for both runs together: ws1 68.96 → 71.57 %, ws2 80.50 → 86.16 % (8.27 points, about 4.1 per run).

**What blocked acceptance (r0 findings, both projects):**

- **Dialogue (structure blocking in both):** 6 % (G4r) and 7 % (G4a) dialogue and 속마음. G4r's plan put the hero alone
  in two of three scenes at 5–10 %; G4a's plan had scenes 2–3 at 30–40 % with three characters on stage and the
  writer still returned 7 %. The writer does not follow the plan's talk target (G3b: 5 %).
- **Reader secrets (G4r blocking, G4a three majors):** a secret scheduled for 화 50 stated in the hero's inner
  narration (G4r); in G4a a doom scheduled for 화 10, the hero's destiny (화 50) and an instructor's lost arm (화 8).
  The writer never sees the reveal schedule the knowledge-leak checker judges against (A-4 again).
- **Device vocabulary (G4r genre major):** the regression hero calls his past life the 원작 (G-1).
- Also: a contract criterion wanting the status alert within three sentences while the chapter opened on sound
  lines (G4r); an F-rank body kicking down a steel door (G4r); a monster's state reversing within one scene (G4a
  blocking, continuity); a stock figure and a 번역투 construction (G4r); world exposition (both).

**What the voice layer changed.** Openings on a sound and on a status window instead of a death flashback (G1, G3b);
talk share, paragraph rhythm and endings still outside the operator's band (likeness 55: dialogue 6 %, no present
endings, no 그/그녀, conjunctions high, too few long sentences).

These are the inputs to Phase U and V2 (ADR-0084, `standard@14`).

## 5. G5 — the `standard.v14` checkpoint on both projects (STEP 1 of the operator-voice run; 01:56–02:22 UTC)

Chapter 1 of two fresh projects on `standard@14` (ADR-0084): the academy project (`phase-c-academy-intake.json`,
G5a, primary) and the regression project (`phase-a-v7-intake.json`, G5r), run in parallel by the previous session
45 seconds after the Phase U + V2 commit. That commit's tree is identical to the merged default branch
(`git diff c0f3b0e e3eea3d` is empty), so these runs are the `standard@14` checkpoint; the session ran out of credits
before recording them. ADR-0085 records why they are used instead of a second pair of runs. The run reports and
every blocking/major finding are exported to `ops/live-runs/g5-standard14/`.

| | G5a (academy) | G5r (regression) |
| --- | --- | --- |
| Length (v1) | 5,922자 (+11.7 %), 4,579 without spaces | 5,899자 (+11.3 %), 4,580 without spaces |
| Scenes (planned talk → measured talk + 속마음) | 3: 25 % → 18.7 %, 30 % → 19.2 %, 45 % → 25.6 % | 3: 20 % → 4.9 %, 40 % → 9.5 %, 20 % → 7.0 % |
| Dialogue share (lint, whole 화) | 14 % dialogue + 7.3 % 속마음 | 6 % (`KO-TALK-SHARE-1P` major) |
| Plan floor | no repair needed; partner on page in scenes 2–3 | `PLAN-DLG-01` raised scenes 1 and 3; `PLAN-PARTNER-01` **unrepaired**: the contract put no one but the hero on page |
| Scene redraft | none (every scene above 12 %) | none (no partner, so no redraft) |
| First line | `[마력 : 0]` (a status window) | `시야에 가장 먼저 박힌 것은 벽에 걸린 낡은 달력이었다.` |
| r0 gate | overall 76: prose 75.4 ✗ (rubric 75, lint 76), structure 77.5 ✗ (rubric 55), genre 100, voice 91.3 | overall 80: prose 82.4, structure 77.5 ✗ (rubric 55), genre 85, voice 78.2 |
| Rounds | r0 to r3; all three patched rounds quarantined | r0 to r3; all three patched rounds quarantined |
| Blocking / major | r0 0 / 7 → r1 1 / 3 → r2 0 / 4 → r3 1 / 1 | r0 2 / 7 → r1 1 / 9 → r2 1 / 12 → r3 3 / 8 |
| Best round (quarantined) | r3: overall 82, structure 88 ✓, prose 75.4 ✗, one blocking (continuity) | r0 |
| Reader-secret findings | 1 major: the hero *is a possessor* scheduled for 화 200 | 1 blocking (r0), 1 major (r2): the hero *is a regressor* scheduled for 화 150 |
| `KO-DEVICE-01` | 0 | 0 (G4r's 원작 in a regression serial did not recur) |
| Likeness (C8) | 65 (first-person bands 60) | 70 (first-person bands 70) |
| Result | not accepted (`needs_attention`) | not accepted (`needs_attention`) |
| Calls / tokens / time | 46 (46 attempts) / 183,057 in, 23,549 out / 1,451 s | 49 (52 attempts, 3 failed) / 185,354 in, 28,166 out / 1,556 s |

Credits: 5.26 points between the reading after G4 (ws1 71.57 %, ws2 86.16 %) and this session's first reading (ws1
76.50 %, ws2 86.49 %, 2026-09-25 06:5x UTC); nothing else is recorded against the workspaces in between.

Excerpts (the first three lines of each chapter, unedited pipeline output):

> [마력 : 0]
> 허공에 둥둥 떠오른 반투명한 시스템 창을 보며 나는 하품을 쩍 뱉어냈다.
> “하아암.”

> 시야에 가장 먼저 박힌 것은 벽에 걸린 낡은 달력이었다.
> 거칠게 그어진 붉은색 마커 자국. 마치 핏자국처럼 선명한 그 동그라미가 시신경을 날카롭게 찔렀다.
> [D-10]

**Defects (each is fixed in this run; the ADR that fixes it is named when it lands).**

- **G5-1 — the premise is judged a reader secret (blocking in G5r, major in G5a).** Both bibles schedule the hero's own
  device as a late secret ("인류가 전멸한 미래에서 돌아온 유일한 회귀자다", owner and only knower 강태산, not before 150).
  ADR-0074's POV rule removes it from the `reader_secrets` list, but the knowledge-leak checker also reads the canon
  state, which lists every secret with its reveal chapter, and flags the premise from there. The bible has one reveal
  chapter per secret, so "hidden from the other characters until 150" and "hidden from the reader until 150" are the
  same field. (U1)
- **G5-2 — talk below the floor at the plan's source (blocking in G5r, major in G5a).** G5r's contract put no one but
  the hero on page, so no plan repair could add a partner; its scene 2 carries a dialogue beat for unregistered
  thugs and a `must_not` against talking in the fight. G5a planned 25–45 % with a partner and the writer returned
  19–26 % per scene: a percentage is not an instruction the writer follows. (U6)
- **G5-3 — every patched round quarantined (6 of 6).** (a) A passing dimension that stayed far above its threshold
  counted as regressed (G5a r3: genre 100 → 90 against 72, while structure rose 77.5 → 88 and passed); (b) findings
  that the re-run judges newly raised in paragraphs the patch never touched counted as introduced by the patch
  (`new_blocking_or_major_issue` in five of six); (c) one continuity finding on an unchanged sentence moved between
  major and blocking from call to call; (d) continuity and knowledge findings are never a round's target while a
  gated dimension fails (the "30퍼센트 정도만 힘을 빼고" contradiction survived all four G5a rounds); (e) a dimension
  that fails by score with no major finding is never targeted and never re-judged (G5a prose 75.4 in every round,
  one prose-judge call). (V2)
- **G5-4 — one explanation told three times (four majors in G5r).** The awakening stone's reward is explained in all
  three scenes; each scene plan restates it and the writer re-explains it. (U8)
- **G5-5 — the cut lands on a trailing beat (structure major in G5a).** The contract's hook was the professor's
  misreading; the final scene went on to a small worry ("‘내 1인실 기숙사는 무사한 거 맞겠지?’"). The contract names the
  hook but not where the last scene must stop. (U5)
- **G5-6 — character state against the bible (majors in both).** Stat 999 against the bible's 99; an unawakened
  hero kicking a steel door to paper; a professor who, in the bible, "already" practises the hero's fighting style —
  a future state written as present. Planned states have no time frame and the contract states no physical
  limits. (U3, U7)
- **G5-7 — AI stock figures despite the writer's list (two prose majors in G5r).** "정적이 내려앉았다", "공기가 얼어붙었다";
  no deterministic rule catches them, so only a judge does, after drafting. (C7 → the next language layer)
- **G5-8 — voice metrics outside the operator's band (likeness 65 / 70).** Paragraph mean 37.7자 (operator 25–34.6),
  속마음 7.3 % (≤ 2.3 %), past endings 65 % (≤ 57.5 %), almost no present or connective endings (G5a); talk 7.6 %,
  few ellipses and pronouns (G5r). (Q, C)
- **G5-9 — scene-internal slips.** Two "boss" steel doors in one scene (G5r); a swapped wand called the old one
  (G5a). Patch territory once rounds converge (V2).

## 6. G6 — the `standard.v15` checkpoint on both projects (STEP 2; 07:52–08:21 UTC)

Chapter 1 of two fresh projects on `standard@15` (ADR-0086: reveal schedule, talk partner and countable talk targets,
the cut as the last beat, time frames, the plan critic, findings attributed to the patch), run in parallel from the
live worktree at `3c8d084`. Run reports and findings: `ops/live-runs/g6-standard15/`.

| | G6a (academy) | G6r (regression) |
| --- | --- | --- |
| Length (v1) | 5,463자 (+3.1 %) | 5,449자 (+2.8 %) |
| Scenes (planned talk → measured talk + 속마음) | 3: 40 % → 23.1 %, 20 % → 20.8 %, 40 % → 30.6 % | 2: 20 % → 16.2 %, 45 % → 32.8 % |
| Quoted dialogue lines | 42 (7.7 per 1,000자; G5a 29, 4.9) | 49 (9.0 per 1,000자, the operator's median is 9.2; G5r 23, 3.9) |
| Quoted 속마음 lines | 7 (G5a 13) | 7 |
| Plan critic / repairs | 2 findings; the scene plan re-asked once (`PLAN-REPAIR`) | 1 finding; `PLAN-DLG-03` (a scene with a partner and no dialogue beat) repaired by one re-plan |
| First line | `“다음, 아델.”` (a dialogue line) | `2026년 4월 10일.` (a date line) |
| r0 gate | overall 81: prose 73.8 ✗, structure 87.5, genre 85, voice 95.7 | overall 79: prose 75.4 ✗, structure 82.5, genre 85, voice 84 |
| Rounds | r0 to r3, **no round quarantined** | r0 to r3; r1 and r2 quarantined (`targeted_worsened`), r3 kept |
| Blocking / major | r0 1 / 8 → r1 0 / 2 → r2 **0 / 1 (all four gates passing)** → r3 0 / 7 | r0 3 / 2 → r3 1 / 10 |
| Talk findings | none at any round (G5a: a weak-pacing major) | none at any round (G5r: a blocking talk finding) |
| Reader-secret findings | none (G5a: the premise judged a 200화 secret) | 3 blocking at r0: the hero's prior-life knowledge (an elixir, a thug's embezzlement) against bible reader dates 3–8 |
| `KO-DEVICE-01` | 2 at r0 (`원작 주인공` in a game-possession serial) | 0 |
| Likeness (C8) | 70 (first-person bands 65); G5a 65 | 70 (first-person bands 75); G5r 70 |
| Result | not accepted (`needs_attention`) | not accepted (`needs_attention`) |
| Calls / tokens / time | 53 (53 attempts) / 210,623 in, 27,301 out / 1,731 s | 55 (55 attempts) / 209,172 in, 28,686 out / 1,637 s |

Credits for the pair: ws1 76.74 → 78.34 %, ws2 86.84 → 89.90 %, ws3 0.07 → 3.30 %, ws4 0.02 → 1.04 % (8.91 points; the
operator added workspaces 3 and 4 before this run).

Excerpts (the first three lines of each chapter, unedited):

> “다음, 아델.”
> 무미건조한 호명 소리가 일루전 연무장을 울렸다.
> 나는 허공에 둥둥 떠 있는 반투명한 창을 멍하니 노려보았다.

> 2026년 4월 10일.
> 스마트폰 액정에 뜬 날짜.
> 그 무기질적인 숫자를 눈에 담자마자, 나는 조금의 망설임도 없이 통화 버튼을 눌렀다.

**What changed against G5.** The premise is no longer a reader secret (G5-1 fixed); talk is inside the operator's band at
r0 in both chapters and no judge raised a talk finding (G5-2 fixed); the academy chapter's rounds converged — every
round kept, 9 blocking/major findings down to 1 with all four gates passing at r2 (G5-3 fixed for the academy chapter).

**Defects (fixed by ADR-0088, `standard@17`).**

- **G6-1:** the hero's prior-life knowledge was hidden from the reader by the bible's dates (three blocking findings in
  G6r). The schedule gave the reader only the narrator's own secrets; the operator's readers hold the hero's game and
  future knowledge. For one secret the bible did not list the hero as a knower at all.
- **G6-2:** G6r's hook was built on that knowledge; the plan critic raised contract-level findings that no scene-plan
  repair could reach.
- **G6-3:** a dialogue line written twice in a row and an entrance narrated twice across a scene boundary (G6a, the
  blocking at r0).
- **G6-4:** `원작 주인공` in the academy chapter, copied from the cast bible, whose designer brief asks for each heroine's
  fate "in the 원작, with the 원작 주인공" whatever the device.
- **G6-5:** after the third patch the full re-evaluation raised seven majors on text earlier rounds had judged clean —
  five single uses of 그/그녀 (the draft's rate is inside the operator's first-person band) and a weak ending for the
  comic-deflection cut the contract asked for — and the three rounds were spent.

## 7. G7 — the `standard.v17` checkpoint on both projects (STEP 2; 08:30–09:09 UTC)

Chapter 1 of two fresh projects on `standard@17` (ADR-0088: the narrator's remembered knowledge is the reader's, the
contract critic, repeated lines dropped, cast designer 4.8.0, `voice/operator@2`, five Korean rounds), run in parallel
from the live worktree at `a9028e4`. Run reports and findings: `ops/live-runs/g7-standard17/`.

| | G7a (academy) | G7r (regression) |
| --- | --- | --- |
| Length (v1) | 6,390자 (+20.6 %) | 6,211자 (+17.2 %) |
| Scenes (planned talk → measured talk + 속마음) | 3: 30 % → 25.2 %, 40 % → 21.3 %, 20 % → 14.2 % | 3: 20 % → 6.3 %, 30 % → 4.2 %, 30 % → 27.2 % |
| Quoted dialogue lines | 50 (7.8 per 1,000자; G6a 42, 7.7) | 34 (5.5 per 1,000자; G6r 49, 9.0) |
| Quoted 속마음 lines | 8 | 4 |
| Plan critic / repairs | the contract sent back once, the scene plan once; one scene redrafted for talk | the same |
| First line | `[근력: 999(MAX)]` (a status-window line) | `우드득.` (a sound line) |
| r0 gate | overall 84: prose 84, structure 83, genre 80, voice 73.8 ✗ | overall 83: prose 85.6, structure 80, genre 70 ✗, voice 91.3 |
| Rounds | r0 to r5; r2–r5 quarantined | r0 to r5; r3 and r4 quarantined |
| Blocking / major | r0 0 / 4 → r1 **1 / 3 (all four gates passing)** → r2 2 / 5 → r3 2 / 4 → r4 1 / 7 → r5 2 / 4 | r0 1 / 7 → r1 0 / 2 → r2 1 / 1 → r3 1 / 7 → r4 0 / 2 → r5 **1 / 0 (all four gates passing)** |
| The last blocker | r1: the continuity checker demands the bible's `사부님` register from the first line; r2–r5: `사부님` before the heroine has seen anything (genre and voice, blocking) | r4 and r5: the bible's `형님` register from the first line (continuity), and the thug knowing the hero's name (knowledge) once the reviser complied |
| Talk findings | none | structure majors at r0, r1 and r3 (10–11 %) |
| Reader-secret findings | none (G6r: 3 blocking) | none |
| `KO-DEVICE-01` | 0 (G6a 2) | 2 at r0, with a blocking genre finding for `원작` |
| Provenance tags in locked bible facts | 3 | 8 |
| Likeness (C8) | 80 (first-person bands 80); G6a 70 | 65 at v1, 75 at v2 (first-person bands 65); G6r 70 |
| Result | not accepted (`needs_attention`) | not accepted (`needs_attention`) |
| Calls / tokens / time | 77 (79 attempts) / 339,799 in, 35,531 out / 2,304 s | 61 (61 attempts) / 269,711 in, 30,448 out / 2,129 s |

Credits for the pair: ws1 78.34 → 80.93 %, ws2 89.90 → 94.08 %, ws3 3.30 → 6.75 %, ws4 1.04 → 2.80 % (11.98 points).

Excerpts (the first three lines of each chapter, unedited):

> [근력: 999(MAX)]
> [민첩: 999(MAX)]
> 반투명한 홀로그램 창이 허공에 떠올랐다.

> 우드득.
> 가슴뼈가 으스러지는 소리와 함께 시야가 박살 났다.
> 마신의 창이 내 심장을 꿰뚫고 등 뒤로 튀어나왔다. 핏덩이가 목구멍을 역류했다. 숨통이 끊어지는 끔찍한 고통이 전신을 찢어발겼다.

**What changed against G6.** No reader-secret finding in either chapter at any round (G6-1, G6-2 fixed); no repeated
line (G6-3); no `원작 주인공` in the academy chapter (G6-4); both chapters used the five rounds and each passed all four
dimension gates in at least one round — the regression chapter's last round stood at one blocking finding and no major.

**Defects (fixed by ADR-0089, `standard@18`).**

- **G7-3 (the last blocker in both chapters):** a cast register describes the settled relationship, but the bible
  seeded every register as canon from before 화 1, and both relationships form in 화 1. The continuity checker demanded
  the settled register from the first line; complying created the "calls him 사부님 before seeing anything" blocking
  findings that quarantined every academy round after r1.
- **G7-2:** the regression writer's pack carried `원작` 63 times — the one 회빙환 overlay the intake maps regression,
  reincarnation and possession to is worded for novel possession, while the device rule in the same prompt forbids
  `원작`.
- **G7-1:** the concept generator, power-system designer and story architect copied provenance tags into their answers;
  eleven locked bible facts carry `[FACT]`, `[PLANNED]` or `[SUMMARY]`.
- **G7-4 (open):** the regression chapter's two solo scenes came back at 6.3 % and 4.2 % talk against planned 20 % and
  30 %; the talk redraft needs an on-page partner. The structure gate passed at every round.

## 8. G8 — the `standard.v18` checkpoint on both projects (09:30–10:19 UTC)

Chapter 1 of two fresh projects on `standard@18` (ADR-0089: relationships dated and not canon before they begin, the
회빙환 overlay in the device's words, provenance tags stripped, `lang/ko@8`), run in parallel from the live worktree at
`565c09b`. Run reports and findings: `ops/live-runs/g8-standard18/`.

| | G8a (academy) | G8r (regression) |
| --- | --- | --- |
| ADR-0089 on live data | 0 tagged bible facts; every register dated (화 1, 2, 11); no relationship seeded; the game variant and the `lang/ko@8` notes in the writer's prompt | 0 tagged bible facts; every register dated (화 3–14); no relationship seeded; no `원작` term list |
| Length (v1) | 6,120자 (+15.5 %) | 6,117자 (+15.4 %) |
| Scenes (planned talk → measured talk + 속마음) | 2: 40 % → 24.6 %, 25 % → 32.0 % | 3: 40 % → 20.6 %, 30 % → 24.0 %, 50 % → 43.2 % |
| Quoted dialogue lines | 45 (7.4 per 1,000자) | 50 (8.2 per 1,000자) |
| Quoted 속마음 lines | 7 | 9 |
| Plan critic / repairs | one critique of the contract (kept) and one of the scenes (re-planned once) | the same, and one scene redrafted for talk |
| First line | `[마력 적성, 제로(0).]` (a status-window line) | `[2026년 4월 20일]` (a date line) |
| r0 gate | overall 87: prose 79.2, structure 95, genre 75, voice 88.8; knowledge ✗ | overall 76: prose 61.5 ✗, structure 90, genre 80, voice 81 |
| Rounds | r0 to r5; r3 and r4 quarantined | r0 to r5; r2 quarantined |
| Blocking / major | r0 2 / 7 → r1 2 / 2 → r2 **0 / 3** → r3 1 / 2 → r4 1 / 2 → r5 **0 / 3** | r0 2 / 5 → r1 0 / 5 → r2 1 / 4 → r3 1 / 3 → r4 2 / 2 → r5 3 / 1 |
| The last blockers | r5: a mana-perception contradiction and two single `그녀` (0.33 per 1,000자; the operator's first-person p10 is 0.66) | r5: scenes 1–2 narrated in the third person (continuity and prose, blocking) and a payment of 5억 written as 5천만 |
| Reader-secret findings | 2 blocking at r0: two present-timeline secrets the hero knows from the game, told at the characters' entrances | none |
| Device vocabulary | `KO-DEVICE-01` 0; the genre judge flagged a bare `원작` twice at r0 and as blocking at r1 | `KO-DEVICE-01` 0 |
| Findings citing a 0화 register (G7: 5) | 0 | 0 |
| Likeness (C8) | 80 (first-person bands 80); G7a 80 | 85 (first-person bands 85); G7r 65 |
| Result | not accepted (`needs_attention`) | not accepted (`needs_attention`) |
| Calls / tokens / time | 74 (74 attempts) / 313,935 in, 32,320 out / 2,454 s | 79 (79 attempts, 1 failed) / 294,728 in, 31,343 out / 2,874 s |

Credits for the pair: ws1 80.93 → 83.04 %, ws2 94.08 → 98.57 %, ws3 6.75 → 11.35 %, ws4 2.80 → 4.33 % (12.73 points).

**Incident.** At 09:42 the full `pnpm check`, started beside the live runs, ran out of memory at the sandbox's ceiling and
the live runs' connections to the permanent database dropped. G8a's runner stopped on the failed heartbeat, and the
runner of the still-running G8r process claimed G8a's run and finished it. G8r's own runner could not prove its lease on
the failed read, failed closed and recorded the run as cancelled with the reason `operator_cancelled` (one designer call
discarded in `cast_core`) — a database blip, not an operator; it was resumed at 09:49 (`novel:resume`, a new runner). No
checkpoint was lost. `09-progress.md` now forbids the full check during a live run; the misleading cancellation reason
is an open item for unattended runs (N4).

Excerpts (the first three lines of each chapter, unedited):

> [마력 적성, 제로(0).]
> 입학식장 단상 위.
> 마력 측정구에서 흘러나온 차가운 기계음이 거대한 식장을 반으로 갈랐다.

> [2026년 4월 20일]
> 스마트폰 액정 위로 선명한 숫자가 떠올랐다.
> 게이트 사태 D-10.

**What changed against G7.** No finding cites a register from 화 0 (G7-3 fixed; G7 had five); no provenance tag in any
bible fact (G7-1); the regression writer's pack no longer lists possession terms (G7-2). The academy chapter reached 0
blocking findings twice.

**Defects (fixed by ADR-0090, `standard@19`).**

- **G8-1:** two present-timeline secrets the first-person hero knows at the start (a rival's drug use, a classmate's side
  business) were hidden from the reader until 화 8 and 15; the schedule gave the reader only prior-life and
  source-work knowledge.
- **G8-2:** the device rule forbids a bare `원작` in a game-possession serial, which the operator's own game-possession book
  uses 17 times; the genre judge followed the rule.
- **G8-3:** a cast card's example line pasted into the chapter; characters naming strangers before any introduction
  (r0, r1, r3).
- **G8-4:** the genre judge called the 먼치킨 hero's cost-free power a forbidden development (also G7a r2, r3, r5); the
  intake's protagonist type reached no prompt.
- **G8-5:** a first-person chapter with two scenes narrated in the third person; `KO-POV-01` reads the whole chapter and
  no patch rewrites two scenes.
- **G8-6:** the unawakened regression hero kicking steel doors off their hinges (also G7r r0, r2, r3).
- **G8-7:** prose-judge majors for single 그/그녀 in a chapter below the operator's own pronoun band.
- **Observations, not fixed:** the regression designer listed a non-regressor as remembering the prior loop (one
  continuity finding); a status-window line judged against the world rule's formatting example (G8a r4, blocking);
  G7-4 (solo scenes raised to the talk floor) recurred in the plan but not as a finding.

## 9. G9 — the `standard.v19` checkpoint on both projects (STEP 1 of this run; 11:57–12:38 UTC)

Chapter 1 of two fresh projects on `standard@19` (ADR-0090: the narrator's present knowledge, the operator's own device
words, the 먼치킨 premise, the per-scene POV redraft, pronouns inside the operator's band, writer 4.10.0), started by the
previous session at 11:57 UTC from the tree of `0b010a3` — one minute after the `standard@19` commit and before
ADR-0091 (migration 0025 was first applied to the permanent database at 13:55 UTC by this run's `db:migrate`, so the
runs used the old claim). The session ended before recording them. As with G5 (ADR-0085 §2), the recorded pair is the
`standard@19` checkpoint; nothing later on the branch changes prose behaviour. The metrics below come from
`quality:checkpoint` (new in this run: the same measures for every checkpoint, read from the database); the run
reports, every blocking/major finding and the metrics JSON are in `ops/live-runs/g9-standard19/`.

| | G9a (academy) | G9r (regression) |
| --- | --- | --- |
| ADR-0090 on live data | `KO-DEVICE-01` 0 and no genre finding for `원작` (G8-2); no finding against the 먼치킨 hero's power (G8-4); no pronoun major (G8-7); three scene-writer redrafts for two scenes | `KO-DEVICE-01` 0; no third-person scene in the kept draft (G8-5); two scene-writer redrafts for two scenes |
| Length (v1) | 5,952자 (+12.3 %), 4,635 without spaces | 5,529자 (+4.3 %), 4,340 without spaces |
| Scenes (planned talk → measured talk + 속마음) | 2: 20 % → 19.8 %, 40 % → 25.5 % | 2: 20 % → 10.9 %, 40 % → 37.4 % |
| Quoted dialogue lines | 42 (7.1 per 1,000자) | 47 (8.5 per 1,000자) |
| Quoted 속마음 lines | 9 | 11 |
| Plan critic / repairs | two critic majors on the scene plan (open on a voice; give the heroine's entrance "the fate or secret the hero knows"), the plan re-asked once | the critic flagged an unawakened hero breaking walls and doors and a non-voice opening; `PLAN-DLG-02` removed one talk ban; the plan re-asked once; three chapter-planner calls |
| First line | `웅성웅성. 시끌벅적.` (a sound line) | `우드득.` (a sound line) |
| r0 gate | overall 74: prose 73.3 ✗, structure 75.5 ✗, genre 80, voice 90.4; continuity and knowledge ✗ | overall 87: prose 89.3, structure 85, genre 90, voice 87.5 — all four gates passing, 7 majors |
| Rounds (revision scope) | r0 to r5 (r1 scene, r2 scene, r3 paragraph, r4 paragraph, r5 scene); r2, r3, r5 quarantined | r0 to r5 (r1 scene, r2 scene, r3–r5 paragraph); r1–r5 quarantined |
| Blocking / major | r0 4 / 8 → r1 2 / 3 → r2 0 / 5 → r3 0 / 4 → r4 **0 / 5 (kept)** → r5 1 / 3 | r0 **0 / 7** → r1 4 / 7 → r2 1 / 5 → r3 **0 / 2** → r4 0 / 4 → r5 0 / 3 |
| Why rounds were quarantined | r2: a new repetition major; r3 and r5: structure 87.5 → 77.5 and 85 → 75 under a paragraph patch that did not touch the opening or the cut | r1, r2: scene rewrites that entered the office twice and drifted into the third person (4 and 1 blocking); r3–r5: `targeted_worsened` alone — genre 90 → 85 against its gate of 72 |
| The last blockers | r4 (kept): 상태창 lines without the world rule's 체력 line and a trait name off by one word; the rival's drug use (hidden until 화 24) in narration; an over-nested sentence; the hero calling 반말 a breach of rules that make everyone use 평어 | r3/r5: contract AC-1 (the status window and the regression "within the first three sentences") in all six scorecards and never targeted; the unawakened hero kicking a locked steel door open; a repeated catchphrase |
| Reader-secret findings | r0: 3 blocking (continuity: the heroine's 원작 bad ending "15화 이전 공개 금지", her candy habit, the rival's drugs and fall) + 1 major (knowledge); r1 2 blocking; r2, r4 1 major | r0 1 major: the hero asks a stranger about her debt before any introduction |
| `KO-DEVICE-01` | 0 in every round | 0 in every round |
| Corpus copy check (14 syllables) | no `corpus_copy` finding on any of the six versions | no `corpus_copy` finding on any of the six versions |
| Likeness (C8) | v1 70 (first-person bands 80); kept v5 80 (75); G8a 80 | v1 70 (first-person bands 55); v6 55 (50); G8r 85 |
| Result | not accepted (`needs_attention`, APPROVAL_BLOCKED on v5: 0 blocking, 5 major) | not accepted (`needs_attention`) |
| Calls / tokens / time | 83 (85 attempts, 2 failed) / 334,809 in, 35,390 out / 2,440 s | 79 (80 attempts, 1 failed) / 332,188 in, 36,282 out / 2,272 s |

Credits for the pair: ws1 83.04 → 87.34 %, ws3 11.35 → 17.42 %, ws4 4.33 → 6.44 % (12.48 points); ws2 (98.57 % after G8)
answers `rate-limited` with no reading, so its share is unknown (at most 1.43 points). Nothing else is recorded against
the workspaces between the G8 reading and this run's first reading (13:53 UTC).

Excerpts (the first three lines of each chapter, unedited pipeline output):

> 웅성웅성. 시끌벅적.
> 제1연무장을 가득 채운 백여 명의 신입생들이 뿜어내는 열기가 뜨거웠다.
> 입학식 직후에 치러지는 마력 측정 평가.

> 우드득.
> 가슴뼈가 통째로 부서지는 감각.
> 심장을 꿰뚫고 지나간 거대한 발톱의 서늘함이 생생했다. 핏물이 식도를 타고 역류하며 단말마의 비명조차 삼켜버렸다.

**What changed against G8.** Both chapters open on a sound line, as the operator's do; no scene was left in the third
person (G8-5), no device or 먼치킨 finding (G8-2, G8-4) and no pronoun major (G8-7). The regression chapter's first
draft passed all four dimension gates with no blocking finding — the best r0 of any live run — and its r3 reached
0 blocking and 2 majors; both were thrown away by the revision rules, not by the text.

**Defects (each is fixed in this run; the ADR that fixes it is named when it lands).**

- **G9-1 — two dates for one secret.** The canon-state lines every pack carries render a secret with the bible's one
  reveal chapter ("15화 이전 공개 금지") while the reveal schedule (ADR-0088, ADR-0090) gives the first-person narrator's
  remembered game knowledge to the reader from 화 1. The writer followed the schedule; the continuity checker read the
  canon line and raised three blocking findings (G9a r0). G5-1 was the same split in the knowledge section.
- **G9-2 — the heroine formula against the schedule.** The operator's introduction formula (`operator-voice-analysis.md`
  §8: "the hero's game knowledge of her, often a doomed fate") reaches the planners and the plan critic without the
  schedule; the critic sent the plan back to give the heroine's entrance "the fate or secret the hero knows", and the
  writer told a habit only the heroine knows (화 8) and the rival's drugs (화 24). The bible compounds it: the hero
  knows the drugs' consequence ("이 마약 부작용으로 … 타락") but is not a knower of the drugs.
- **G9-3 — noise quarantines resolved rounds.** A judge's score moves in rubric steps of about 5 points (one sub-score);
  the regression tolerance is 3. `targeted_worsened` quarantined G9r r3–r5 for genre 90 → 85 against a gate of 72 while
  the round resolved its targets (7 majors → 2); the structure judge's rubric read 55, 75, 70, 55, 70, 50 over G9a's six
  scorecards on mostly unchanged text, so paragraph patches that never touched the opening or the cut were quarantined
  for structure (r3, r5).
- **G9-4 — a spanless contract finding is never targeted.** G9r's AC-1 ("상태창 알림과 회귀 확신이 첫 3문장 안에") has
  no quote, so the patch planner listed it as untargeted in every round; no round could ever approve the chapter.
- **G9-5 — a quarantined round repeats itself.** After a quarantine the next round starts again from the same parent
  with the same targets and the same rung: G9r r3, r4 and r5 are the same four paragraph patches to v1 (1,972–1,978
  characters each), quarantined the same way.
- **G9-6 — the unawakened body again.** The hero kicks a locked steel door open (G9r r0, r4, r5) although the plan
  critic removed door-breaking from the plan and the writer's own narration says only a plywood door gives way.
- **G9-7 — a scene rewrite is judged before it is checked.** G9r r1's scene rewrite entered the office twice and slipped
  into the third person (`진우는`); four blocking findings came from a draft that a deterministic check could have
  rejected before any judge call.
- **G9-8 — stock figures and world vocabulary.** `서늘한 미소가 입가에 번졌다`, `정적이 내려앉았다` (one stock figure raised
  by two judges as two majors); `오러` for a mage; a 상태창 without the world rule's lines and trait name.

## 10. G10 — the `standard.v20` checkpoint on both projects (STEP 2/3; 15:09–15:37 UTC)

Chapter 1 of two fresh projects on `standard@20` (ADR-0092: the schedule's dates in every canon line, `voice/operator@3`,
score attribution, quoteless findings to a scene, no repeated round, checked rewrites), run in parallel from the live
worktree at `75439a9`. Metrics from `quality:checkpoint`; exports in `ops/live-runs/g10-standard20/`. (A launcher bug
first created three empty projects with no run — `G10 아카데미 standard20`, `G10 회귀 standard20`, `probe-shape-only`; the
runs are `G10a …` and `G10r …`.)

| | G10a (academy) | G10r (regression) |
| --- | --- | --- |
| ADR-0092 on live data | the writer's canon lines carry `독자는 이미 안다(서술해도 됨)` / `다른 인물에게 N화 이전 공개 금지`; no reader-secret finding in any round | the same; no reader-secret finding in any round |
| Length (v1) | 5,319자 (+0.4 %), 4,175 without spaces | 4,528자 (−14.6 %), 3,567 without spaces |
| Scenes (planned talk → measured talk + 속마음) | 2: 40 % → 28.3 %, 40 % → 28.5 % | 2: 20 % → 7.7 %, 40 % → 27.8 % |
| Quoted dialogue lines | 47 (8.8 per 1,000자) | 35 (7.7 per 1,000자) |
| Quoted 속마음 lines | 12 | 5 |
| Plan critic / repairs | one critic finding (a character knowing what he cannot); `PLAN-DLG-02`, `PLAN-DLG-03`; the plan re-asked once | one critic finding (state contradiction); the plan re-asked once |
| First line | `“신입생들! 똑바로 서라!”` (a dialogue line) | `“크아아악!”` (a dialogue line) |
| r0 gate | overall 80: prose 74.4 ✗, structure 85, genre 95, voice 81.7; knowledge ✗ | overall 85: prose 89.3, structure 80.5, genre 90, voice 87.5 — all four gates passing |
| Rounds (scope) | r0, r1 (scene rewrite, quarantined: one new terminology major, `KO-DEVICE-01` 1) — then stopped | r0, r1 (scene rewrite, kept), r2 (dialogue patch, quarantined), r3 (scene rewrite, quarantined) — then stopped |
| Blocking / major | r0 1 / 3 → r1 1 / 5 | r0 2 / 3 → r1 **1 / 2** → r2 0 / 3 → r3 1 / 7 |
| Why the loop ended | `no_repeat`: after a quarantined rewrite the next round stopped instead of patching (G10-4) | `no_repeat`: both rungs tried once on the same parent, two rounds left (G10-4); r1 had cut the chapter to 3,966자 (−25 %) and passed (G10-2) |
| The last blockers | a secret dated before its meeting — the TA "already lost to the hero" (knowledge, blocking); exposition; a TA who knows the hero's family on hearing his name | length −25 % (untargeted, G10-3); the hero blackmailing with a mana-stone ledger before the first gate (promise, blocking; continuity) |
| Reader-secret findings | 0 in both rounds (G9a: 3 blocking + 1 major at r0) | 0 in every round |
| `KO-DEVICE-01` | r0 0, r1 1 | 0 |
| Corpus copy check (14 syllables) | no `corpus_copy` finding | no `corpus_copy` finding |
| Likeness (C8) | v1 **85** (first-person bands 80); G9a 70 | v1 65 (first-person bands 65); G9r 70 |
| Result | not accepted (`needs_attention`) | not accepted (`needs_attention`) |
| Calls / tokens / time | 37 (37 attempts) / 181,957 in, 28,512 out / 1,434 s | 49 (49 attempts) / 199,787 in, 26,106 out / 1,640 s |

Credits for the pair: ws1 87.34 → 89.67 %, ws3 17.42 → 21.70 %, ws4 6.44 → 8.00 % (8.17 points); ws2 still unreadable.

Excerpts (the first three lines of each chapter, unedited):

> “신입생들! 똑바로 서라!”
> 쩌렁쩌렁한 목소리가 제3연무장의 낡은 대리석 바닥을 쾅쾅 울렸다.
> 은빛이 도는 회색 머리. 먹잇감을 노리는 듯한 날카로운 삼백안.

> “크아아악!”
> 비명이 목구멍을 찢고 터져 나왔다.
> 침대에서 용수철처럼 튕겨 오른 몸이 바닥으로 사정없이 처박혔다.

**What changed against G9.** G9-1 and G9-2 are fixed on live data: no reader-secret finding in any round of either chapter
(G9a had three blocking at r0). The academy draft came out on its length with the best likeness of any live draft (85).

**Defects (fixed by ADR-0093, `standard@21`, except G10-5).**

- **G10-1:** a secret describing the aftermath of a 화-1 meeting was known from before 화 1 (knowledge blocking at G10a r0).
- **G10-2:** a scene rewrite cut the chapter by a quarter and passed its regression check (a length finding has no quote).
- **G10-3:** the length finding was untargeted afterwards; no rung could lengthen the chapter.
- **G10-4:** ADR-0092's `no_repeat` stopped both loops early — after one quarantined rewrite (G10a) and after one patch
  and one rewrite (G10r); both quarantines were for a single new finding while G10r r2 had removed a blocking one.
- **G10-5 (open):** a secret's owner outside the pack's registry appears in the canon lines as a raw id.

## 11. G11 — the `standard.v21` checkpoint (15:52–16:28 UTC)

Chapter 1 of two fresh projects on `standard@21` (ADR-0093: the untried rung before any stop, net improvement, the length
band, meeting-dated secrets, `lang/ko@9`), run in parallel from the live worktree at `ee2d5eb`. Exports:
`ops/live-runs/g11-standard21/`.

**G11a (academy) failed at the arc plan** after 10 calls (608 s): the arc planner wrote `to_stance: "believes"` in three
planned knowledge changes, a stance the arc-plan schema does not know; the contract's normalizer maps free stances, the
arc plan had none, and a resume would replay the same recorded answer (G11-1, fixed by ADR-0094 in `standard@22`; the
academy project is re-run on `standard@22` as G12a).

| | G11r (regression) |
| --- | --- |
| Length (v1) | 5,878자 (+10.9 %), 4,618 without spaces |
| Scenes (planned talk → measured talk + 속마음) | 2: 20 % → 12.2 %, 40 % → 18.1 % |
| Quoted dialogue / 속마음 lines | 52 (8.8 per 1,000자) / 12 |
| Plan critic / repairs | one critic finding (structure target); `PLAN-DLG-03`; the plan re-asked once |
| First line | `“2026년 7월 1일. D-10이군.”` (a dialogue line) |
| r0 gate | overall 88: prose 85.6, structure 90, genre 100, voice 86.9 — all four gates passing |
| Rounds (scope) | r0 to r5, every revision a scene-sized rewrite; r1–r5 quarantined |
| Blocking / major | r0 **1 / 1** → r1 0 / 6 → r2 0 / 3 → r3 2 / 3 → r4 0 / 3 → r5 1 / 5 |
| Why rounds were quarantined | each wrote new findings (a weapon that changes in one scene, a villain's suit colour, a voice card's catchphrase given to the hero); r2 also cut the chapter to 3,311자 and failed the new length protection; net improvement kept none (r2 and r4 weigh 3 against r0's 3) |
| The r0 findings | a stranger knowing the hero's name before they meet (continuity, blocking); "dialogue share 13 %" (structure major) — inside the operator's first-person band (p10 12.6 %) |
| Reader-secret findings / `KO-DEVICE-01` / corpus copy | 0 / 0 / 0 in every round |
| Likeness (C8) | v1 60 (first-person bands 55) |
| Result | not accepted (`needs_attention` on v1) |
| Calls / tokens / time | 71 (71 attempts) / 280,072 in, 37,349 out / 2,125 s |

Credits from the G11 start to 16:29 UTC (G11a, G11r and the first 17 minutes of G12a): ws1 89.67 → 92.22 %, ws3 21.70 →
27.09 %, ws4 8.00 → 9.41 % (9.35 points).

Excerpt (the first three lines of G11r's chapter, unedited):

> “2026년 7월 1일. D-10이군.”
> 쩍 갈라진 스마트폰 액정 위로 선명한 날짜가 빛났다.
> 목이 날아가는 감각이 아직 생생했다.

**What changed against G10.** The loop used all five rounds (G10-4 fixed); the length protection quarantined a revision that
cut the chapter by 38 % (G10-2 fixed); no reader-secret finding again.

**Defects.** G11-1 (above; ADR-0094). G11-2: the judges' dialogue-amount majors inside the operator's own talk band
(13 %, 14 % here; 19 % in G9a) send rounds to scene rewrites that write new defects. G11-3: a revision's weight counted
new-kind findings on lines both versions share. Both fixed by ADR-0095 (`standard@23`).

## 12. G12 and G13 — the academy project on `standard.v22`, the regression project on `standard.v23` (16:12–16:49 UTC)

Chapter 1 of two fresh projects: G12a (academy, `phase-c-academy-intake.json`) on `standard@22` (ADR-0094: secret owners
named in the canon lines, arc-plan stances normalized) from a second live worktree at `f395ea0`, so the G11r run was not
disturbed; G13r (regression, `phase-a-v7-intake.json`) on `standard@23` (ADR-0095: the talk band cap, variance-free
weights) from the live worktree at `35122fa`. Exports: `ops/live-runs/g12-standard22/`, `ops/live-runs/g13-standard23/`.

**G13r (regression) failed at the arc plan** after 10 calls (592 s): the arc planner typed its tenth beat `cliffhanger`,
a type the arc-plan schema does not know (`/beats/9/type`, `ARC_PLAN_INVALID`), and a resume would replay the recorded
answer (G13-1, fixed by ADR-0096 in `standard@24`).

| | G12a (academy) |
| --- | --- |
| Length (v1) | 5,761자 (+8.7 %), 4,527 without spaces |
| Scenes (planned talk → measured talk + 속마음) | 2: 50 % → 28.7 %, 30 % → 18.8 % |
| Quoted dialogue / 속마음 lines | 42 (7.3 per 1,000자) / 8 |
| Plan critic / repairs | two critic majors (the first beat opens on a place, not a voice; a scene with a partner and no dialogue beat); `PLAN-DLG-03`, `PLAN-DLG-02` (a talk ban removed); the plan re-asked once |
| First line | `“하아암─.”` (a dialogue line) |
| r0 gate | overall 66: prose 51.4, structure 80, genre 70, voice 84.1 |
| Rounds (scope) | r0 to r5; r1 a scene rewrite, quarantined (a protected dimension regressed, new blocking findings); r2–r5 paragraph patches, all kept |
| Blocking / major | r0 3 / 3 → r1 5 / 6 → r2 2 / 4 → r3 1 / 1 → r4 1 / 5 → r5 **0 / 4** |
| Prose (rubric / lint composite) | 51.4 (56.3 / 44), 63.1 (62.5 / 64), 54.6 (56.3 / 52), 59.9 (62.5 / 56), 63.1 (62.5 / 64), 66.9 (68.8 / 64) |
| 그/그녀 | 1.5–1.8 per 1,000자 in every round (the operator's first-person median is 1.51, the warn line 2.57); the per-hit marker was 11, 9, 11, 11, 9 and 9 of the round's 14, 9, 12, 11, 9 and 9 lint minors; the prose judge's translation-markers sub-score 1 or 2 in every round |
| The r5 findings | a heroine's misunderstanding narrated before the scene that starts it (continuity); two word-choice errors (prose); one line mixing 반말 and 존댓말 toward one listener (voice) |
| Reader-secret findings / `KO-DEVICE-01` / corpus copy | 0 / 0 / 0 in every round |
| Likeness (C8) | v1 70 (first-person bands 70); v6 65 |
| Result | not accepted (`needs_attention` on v6: prose 66.9 / 78 and voice 72 / 76 failing, 4 majors) |
| Calls / tokens / time | 80 (80 attempts) / 363,743 in, 39,851 out / 2,215 s |

Credits from 16:29 UTC to 17:10 UTC (the rest of G12a and all of G13r): ws1 92.22 → 94.10 %, ws3 27.09 → 29.66 %, ws4
9.41 → 10.54 % (5.58 points); ws2 still unreadable (`rate-limited`).

Excerpt (the first three lines of G12a's last version, unedited):

> 1만 시간을 갈아 넣은 만렙 캐릭터에 빙의했다.
> “하아암─.”
> 늘어지는 하품이 턱 끝에 매달렸다.

**What changed against G11.** The academy project passed the arc plan (G11-1 fixed) and its loop kept four of five
revisions: blocking findings fell from 3 to 0, the first academy run to end without one. The last version failed on two
dimension gates and four majors.

**Defects.** G12-1: the per-hit pronoun marker charged 4 lint points for every 그/그녀 in a chapter inside the operator's
own pronoun band — every lint finding in r1, r4 and r5 — and the prose judge's digest listed those hits as 번역투; without
them r5's composite is 100 and prose 81.3 (ADR-0096 measures the marker on the operator's 259 first-person chapters:
median composite 52 with it, 80 without). G12-2: the heroine's misunderstanding narrated as already formed before the
scene that forms it (an r5 major; the planned-state order inside one chapter, not fixed yet). G13-1 (above). G12-1 and
G13-1 are fixed by ADR-0096 (`standard@24`).

## 13. G14 — the `standard.v24` checkpoint, and the first chapter to pass its gates (17:18–18:56 UTC)

Chapter 1 of two fresh projects on `standard@24` (ADR-0096: arc-plan beat types, the pronoun band lint), run in
parallel from the live worktree at `96ad254`; both arc plans used schema types, so the beat normalizer was not exercised.
After both loops ended one step short, each chapter was granted five more rounds with `novel:extend` (ADR-0098, from a
second worktree at `aba1b7b`, because G15 was running in the first). Exports: `ops/live-runs/g14-standard24/`.

| | G14a (academy) | G14r (regression) |
| --- | --- | --- |
| Length (v1) | 4,984자 (−6.0 %), 3,955 without spaces | 6,022자 (+13.6 %), 4,701 without spaces |
| Scenes (planned talk → measured talk + 속마음) | 2: 40 % → 25.7 %, 20 % → 17.8 % | 2: 20 % → 3.3 %, 45 % → 33.3 % |
| Quoted dialogue / 속마음 lines | 40 (8.0 per 1,000자) / 7 | 47 (7.8 per 1,000자) / 3 |
| First line | `와아아아아-!` | `징, 지징.` |
| r0 | overall 52: prose 18 (4.41 그/그녀 per 1,000자, above the fail line; composite 0), voice 56.3; 2 blocking, 11 majors, two of them in-world characters saying ‘엑스트라’ | overall 79: prose 72.6, voice 66.3; 0 blocking, 8 majors |
| Rounds r1–r5 | r2 overall 85 with all four gates passing (prose 81.8; the chapter back inside the pronoun band, its 12 hits recorded as notes), 0 / 5; r3 and r4 quarantined; r5 overall 87, all gates passing, **1 / 1** | r1 quarantined; r2–r5 kept; r5 overall 88, all gates passing, **0 / 4** |
| Why approval was blocked at r5 | a status-window penalty that fixes the stats at 5 where the bible caps them at 99 (continuity, blocking); one line of the heroine's in 해라체 (voice, major) | an unawakened body kicking a lock apart (G9-6 again), money the hero knows without a setup, killing intent that knocks men out in a system-hunter world, the hero's last line in 반말 |
| Granted rounds (ADR-0098) | r6 85 (1 / 6) → r7 88 (1 / 3) → r8 87 (0 / 1) → **r9 89 (0 / 0)**: prose 90.9, structure 87.5, genre 75, voice 91.3 — gate outcome `approved` | r6 86 (0 / 2) → r7 86 (0 / 3) |
| How it ended | the confirmation (the full re-evaluation that precedes approval, ADR-0086) lost four judges to the bridge's HTTP 502s at 18:54–18:56; the run is `failed` (retryable) with r9 approved by its scorecard and not yet accepted | the bridge returned HTTP 401 at the r8 evaluation; the run is `failed` (retryable) |
| Reader-secret findings / `KO-DEVICE-01` / corpus copy | r0 1 / 1 (the ‘엑스트라’ lines), then 0; 0; 0 | r3 1 blocking, otherwise 0; 0; 0 |
| Likeness (C8) | v1 60 (first-person 55); v10 65 (60) | v1 80 (70); v8 75 (75) |
| Calls / attempts / tokens / time | 120 / 166 (51 failed attempts) / 475,527 in, 43,867 out / 5,872 s | 101 / 109 (10 failed) / 387,794 in, 39,074 out / 4,589 s |

Credits: ws1 94.10 % (17:10) → 97.81 % (17:59), then `rate-limited`; ws3 29.66 → 39.82 %; ws4 10.54 → 14.85 % (18:58), for
G14 with its granted rounds, G15 and the retries. From 18:54 every bridge probe failed (`retryable_provider`), so no
live call could run until the bridge recovered.

Excerpt (the first three lines of G14a's v1, unedited):

> 와아아아아-!
> 고막을 찢을 듯한 환호성이 치고 들어왔다.
> 제1연무장.

**What changed against G12.** In-band pronouns no longer cost the prose composite. G14a's prose rose from 18 to 81.8 by
r2 once the loop brought the rate back into the band, and it passed every later round. Both chapters ended their five
rounds with all four dimension gates passing, and G14a's granted rounds reached 0 blocking and 0 majors.

**Defects.** G14-1: a first draft far above the pronoun band spends rounds on pronouns (ADR-0097's redraft, in
`standard@25`). G14-2: in-world characters saying the possessor's word ‘엑스트라’ (ADR-0097's device rules 3). G14-3: a
chapter that passes every gate with one or two findings left has no way forward once its rounds are spent. A resume
replays to the same `APPROVAL_BLOCKED`, and a chapter first approvable in the last round would have stopped with
`REVISION_LIMIT` in the polish round (both fixed by ADR-0098). G15-1: G15a's requirement interpreter typed a
requirement `relationship`, failing `novel:start` (ADR-0099, `standard@26`). G15b's cast step lost a call to a bridge 502
and was resumed; G15r and G15b were paused at 18:35 to leave the degraded bridge to G14.

### 13.1 After the bridge came back (19:25–19:43 UTC)

- **G14a.** The resumed job replayed r0–r9 and repeated only the confirmation. The full re-reading of r9 came back at
  overall 82, 0 blocking / 6 majors: the structure judge at 77.5 (below its gate) with a late hook, pacing, exposition
  and a weak ending as majors, a continuity major for one line of the heroine's in 반말, and a genre major for the
  system forcing a class change. Round 10, the last granted one, left overall 86, 0 blocking / 2 majors (a late hook;
  bystander reaction cuts used four times), with prose 87.2, structure 85, genre 85 and voice 91.3 all passing. The run
  ended `APPROVAL_BLOCKED` with the grant at the policy's cap (ten rounds in all).
- **G14r.** r8 and r9 were quarantined (0 / 7 each); r10 kept at overall 86, 0 blocking / 3 majors, all four gates
  passing; `APPROVAL_BLOCKED` at the cap.
- **G14-4: one reading's severity decides acceptance.** The structure judge read r8 fresh and rated the late hook and the
  summarizing last line minor (structure 87.5). The confirmation, one sentence later, rated both major, adding a pacing
  and an exposition major (77.5). At r10 the hook was major again and the pacing and exposition minor. Fixed by
  ADR-0100 (`standard@27`): a taste judge's reviewer-class major must be reproduced by a second reading to block.
- Every finding left on either chapter is reviewer-class (ADR-0042): an editor may override it with a recorded reason,
  or the chapter may be regenerated. Both are the operator's decisions, and neither was taken.

## 14. G15–G17 — `standard.v25` to `standard.v28` under a failing bridge (18:00–21:20 UTC)

Exports: `ops/live-runs/g16-standard27/`, `ops/live-runs/g17-standard28/`.

- **G15 (`standard@25`).** G15a failed at its first call: the requirement interpreter typed a requirement
  `relationship` (G15-1, ADR-0099). G15b, the academy relaunch, lost a cast call to a bridge 502 and was resumed. G15r and
  G15b were paused at 18:35 to leave the degraded bridge to G14's granted rounds, and have not been resumed.
- **G16a (academy, `standard@27`).** Its v1 (5,245자, −1.0 %; first line `“퇴교 명령을 집행한다.”`) never reached a
  scorecard. The continuity checker's pack needed 35,114 tokens of critical context against the pinned budget of 34,000
  (`PACK_FAILED`, G16-1, fixed for new projects by ADR-0101 in `standard@28`). A resume replays the same draft into the
  same pack.
- **G16r (regression, `standard@27`).** r0 overall 88, 0 blocking / 7 majors, with voice at 65 (below its gate of 76)
  and the other three dimensions passing; r1 87 (0 / 5); r2 90 (2 / 3, voice 56.3); r3 and r4 quarantined. The bridge
  failed the r5 evaluation (voice and continuity judges, six HTTP 502 attempts each). The run is `failed` (retryable).
  Voice failed in every round: its findings are the hero's register toward strangers, the same class as G14r's last
  major. `major_agreement` never applied, because blocking findings or checker majors were open in every round.
- **G17a (academy, `standard@28`).** Planned (bible, arc plan, contract), then lost its scene plan to the bridge twice
  (21:09, 21:15); the run is `failed` (retryable) before any draft.
- **The bridge.** Probes failed from 18:54 to about 19:25 and again from 21:15 UTC. In between, long calls failed
  often: G16r's 75 calls took 122 attempts, 50 of them failed. The bridge's per-workspace counters reset twice (the
  readings at 20:24 and 21:20 start from 0 done), so credit deltas across those resets are not comparable.

Calls / attempts / tokens / time: G16a 20 / 25 / 159,998 in, 35,540 out / 2,170 s; G16r 75 / 122 / 345,094 in, 43,622 out
/ 4,634 s; G17a 17 / 33 / 70,242 in, 19,223 out / 2,483 s.

**Defects.** G16-1 (above; ADR-0101). G16-2: the regression hero's register toward strangers fails the voice gate in
every round (voice 56–69); open. The bridge outage is not a pipeline defect.

## 15. G17a — the first accepted chapter (21:25–23:10 UTC)

Chapter 1 of G17a (academy, `standard@28`) was drafted once the bridge recovered and run from the live worktree. The
code moved forward as each downstream defect was fixed: `730d457` (the polish round), then `211ca59`, `e5dd44d`,
`df43377` and `f7271d1`. Every resume replayed the recorded calls. From the approved v5 onward, the only new model call
was the extractor's second repair. Export: `ops/live-runs/g17-standard28/`.

| | G17a |
| --- | --- |
| Length (accepted v6) | 6,339자 (+19.6 % against the contract's 5,300), 5,033 without spaces; 252 paragraphs |
| Rounds | r0 80 (3 / 2) → r1 85 (0 / 3) → r2 84 and r3 89 quarantined (protection failed; r3 also a new major) → r4 86, **0 / 0**, all four gates passing (prose 87.2, structure 85.5, genre 90, voice 95.7) |
| Confirmation (ADR-0086) | the full re-reading of v5: overall 89, 0 / 0, approved |
| Polish (ADR-0073) | v6 kept: lint findings 7 → 1; overall 89, 0 / 0, approved |
| Extraction | three answers. The first failed the canon-delta schema on seven items. The first repair fixed five. The second fixed the other two and broke `hypothesis_results`, which was taken back from the first repair (ADR-0103) |
| Canon commit | v3 (`chapter_acceptance`): 5 events, 2 facts, 1 relationship state, 1 promise opened, then the summary and dependency edges; accepted at 23:10:26 |
| Reader-secret findings / `KO-DEVICE-01` / corpus copy | 0 / 0 / 0 |
| Calls / attempts / tokens / time | 80 calls (99 attempts, 2 failed calls) / 341,138 in, 41,342 out / 2,961 s of model time; wall clock 20:35–23:10, including the bridge outage and the fixes |

Excerpt (the first three lines of the accepted v6, unedited):

> “다음 수험생, 번호표 771번! 시온! 단상으로 올라와라!”
> 쩌렁쩌렁한 호통 소리가 귓바퀴를 세게 때렸다.
> 나는 새끼손가락으로 귓구멍을 후비적거리며 느릿하게 눈을 떴다.

**What it took.** Each defect below appeared only once the one before it was fixed. None of them was in the prose.

- **G17-1.** The polish round found no target in a passing chapter and stopped with `INTERNAL` (ADR-0102).
- **G17-2.** The extractor's answer failed the canon-delta schema. It is now repaired at most twice, with per-item
  errors and rendered shapes (ADR-0102).
- **G17-3.** The second repair broke a field that both earlier answers had right. Such a field is now taken back
  (ADR-0103).
- **G17-4.** The planner's window `1.0 → 1.1` against the extractor's paragraph-order ordinals turned a relationship
  dated 1.2 into "the future" (ADR-0104).
- **G17-5.** Two facts dated only by their items reached the insert without `valid_from` (ADR-0105).

G17a was resumed with `--stop-after=5` at 23:12 (STEP 5).

**G18r (regression, `standard@28`).** Planned from 22:30, from the second worktree. r0 77 (2 / 4) → r5 89 (0 / 1), with
every round kept. At r5 all four taste gates passed (prose 90.9, structure 87.5, genre 85, voice 90.3), so G16-2 did not
recur. One continuity-checker major remained: a line that contradicts the extortion it follows. At 23:12 the chapter
was granted five rounds (ADR-0098) on `f7271d1`.

Credits at 23:15: ws1 7.02 %, ws2 1.61 %, ws3 56.74 %, ws4 21.88 % (`rate-limited`), ws5 2.38 %, ws6 3.66 %
(`rate-limited`). ws5 and ws6 are new in this period. Against the 22:20 reading, G17a's acceptance and G18r's planning
and five rounds cost about 8 points across the six workspaces.

## 16. Run 3 — the resume point and the continuity checker's second opinion (2026-09-26, from 08:10 UTC)

Run 3 started on `547741f` (the default branch after run 2's merge). The permanent database was reachable and
migrated, and the bridge probe passed on all four classes. `novel:status` found more than run 2's handoff recorded,
because run 2 kept going after its last report:

| Project | Policy | State at 08:12 UTC |
| --- | --- | --- |
| G17a (academy) | `standard@28` | chapter 1 accepted (canon v3); chapter 2 `APPROVAL_BLOCKED` after its five rounds: v6 at 0 blocking / 1 major, a structure `excessive_exposition` that the agreement reading (ADR-0100) reproduced; all four gates passing (prose 87.7, structure 81.3, genre 80, voice 100) |
| G18r (regression) | `standard@28` | chapter 1 `APPROVAL_BLOCKED` with its grant used up (5 of 5): v9 was approved at 0 / 0, its confirmation found 2 majors, and v10 and v11 each ended on a new continuity finding (v11: 1 blocking) |
| G19r (regression) | `standard@28` | created by run 2 at 23:29 UTC and not in its handoff: chapter 1 `APPROVAL_BLOCKED` after five rounds, v6 at 0 / 2 (a continuity `inventory_impossible`, a prose `other`), all four gates passing |

G17a's chapter 2 and G19r's chapter 1 were granted five rounds each (ADR-0098) at 08:20 UTC.

**G18r, rounds r6–r10.** r5 v6 89 (0 / 1) → v7 91 (1 / 1) → v8 91 (0 / 2) → v9 91 **0 / 0, approved** → the confirmation of
v9: 92 (0 / 2) → v10 92 (0 / 1) → v11 92 (1 / 0). 109 calls in all (109 attempts), 431,531 input / 40,257 output tokens,
3,270 s (22:30–23:25 UTC). Every version from v7 on passed all four taste gates. The findings that stopped each version,
read against its text:

| Version | Finding | Reading |
| --- | --- | --- |
| v7 | continuity `timeline_error` (blocking): the landlord says “아침부터” on a call made before 23:10 | right: a time word the rewrite introduced |
| v7 | knowledge `reader_knowledge_violation` (major): the hero sees through the broker's lowball, a secret scheduled for 화 6 | right, and planned: the contract's MH-2 has the hero face down the lowball in 화 1 (G19-3) |
| v8 | continuity `numeric_inconsistency` (major): a threat to take less money from the deposit he is owed | right |
| v8 | knowledge `knowledge_ignorance` (major): “생애 첫 시스템 상태창” for a regressor | right |
| v9 (confirmation) | continuity `canon_contradiction` (major): the bible's “knows and lets it pass” against the extortion | right, and planned (G19-3) |
| v10 | continuity `inventory_impossible` (major): the phone pushed across the counter rings in his pocket | right, a slip; major by the severity policy (§3 lists inventory mismatches) |
| v11 | continuity `world_rule_violation` (blocking): the broker “has a rare skill” ten days before the system | right in wording (the same chapter says the skill has not awakened); blocking is above the policy's severity for a world rule |

So the checker was right about the slips. What failed is the loop around it:

- **G19-1: one reading does not establish a finding.** G17a chapter 2's v5 was read by the continuity checker after round
  4 (23:40:47 UTC) with nothing above minor, and was approved. The confirmation read the same text 52 seconds later and
  the checker raised a blocking `character_inconsistency`. G18r's v9: nothing in r8's reading, a major in the
  confirmation's.
- **G19-2: every confirmation contradicted the reading that approved.** G17a chapter 2 (v5: 0 / 0, then 1 blocking and 5
  majors from four evaluators), G18r (v9: 0 / 0, then 2 majors). Every later round rewrote text for the new findings, and
  every rewrite was read once more by a checker whose next reading found another slip.
- **G19-3: a plan that contradicts its own schedule.** G18r's contract (MH-2) has the hero subdue the broker who lowballs
  him in 화 1, while the bible schedules “the hero already sees through him” for 화 6 and records that he lets it pass. The
  knowledge and continuity checkers raised it in v1, v4, v7 and v9; no revision can fix a contract.

**Fixed in code.** G19-1 and G19-2 by ADR-0106 (`standard@29`): the continuity and knowledge checkers' reviewer-class
findings join ADR-0100's second reading, and a finding the second reading does not reproduce is a minor doubt. Canon
contradictions, timeline errors and leaks still block on one reading, so G19-3 still stops a chapter. ADR-0107 closes
ADR-0103's deferred item: a resume after a rejected extraction asks the extractor again.

**G19r's granted rounds (08:20–08:29 UTC)** ended the same way: v7 and v8 quarantined, v9 at 2 blocking, v10 at 1 blocking /
1 major (all continuity `inventory_impossible`), v11 quarantined; 38 calls. **G18r and G19r stay as the record of
`standard@28` at the grant cap, as G14a and G14r do for `standard@24`** (ADR-0108). The regression line continues on a
fresh `standard@29` project.

Credits at 08:12 UTC: ws1 10.97 %, ws2 3.29 %, ws3 59.40 %, ws4 23.18 %, ws5 5.16 %, ws6 8.20 % (none rate-limited).
Against run 2's last reading (23:15 UTC) that is 16.87 points, spent by run 2 after its report (G17a chapter 2, G18r's
granted rounds and G19r).

## 17. G20a and G20r — chapter 1 on `standard@29` (08:47–09:30 UTC), and the next fixes

Two fresh projects on `standard@29` (ADR-0106), from the same intakes as G17a (`ops/live-runs/phase-c-academy-intake.json`)
and G18r / G19r (`ops/live-runs/phase-a-v7-intake.json`), the first concept approved, `--stop-after=5`, run in parallel
from `/tmp/hoplite/live3` at `167b74d`.

| | G20a (academy) | G20r (regression) |
| --- | --- | --- |
| r0 | v1 87 (1 / 4); 7,436자, +40.3 % | v1 87, **0 / 0** after the agreement readings (four one-reading findings recorded as minor); voice 69 against its gate of 76 |
| Rounds | r1 quarantined, r2 89 (0 / 3), r3 quarantined (prose 23), r4 89 (0 / 3), r5 88 (0 / 4) | r1 and r2 quarantined, r3 87 (0 / 0, voice 70.5), r4 quarantined |
| Stopped on | a length lint major (v6 7,437자, +40 %) with two continuity slips and one prose finding; the lint major kept ADR-0106 from applying | the voice gate alone (70.5 / 76), with every finding minor |
| Length | v1 7,436 / 5,879자 (with / without spaces); v6 7,437 / 5,880 | v1 6,353 / 4,967; v4 (best) 6,353 |
| Likeness (corpus:likeness, last version) | 60 | 45 (a quarantined version) |
| Calls / tokens / time | 67 calls (67 attempts) / 305,843 in, 34,958 out / 2,021 s | 67 calls (67 attempts) / 302,863 in, 33,026 out / 1,933 s |

**What `standard@29` changed.** In G20r the second readings did what ADR-0106 set out to do: the continuity checker's and
the voice and genre judges' one-reading majors were re-read (`continuity:1:r2:agree`, `continuity:1:r3:agree`, …) and
recorded as minor, and the chapter reached 0 / 0 in r0 and r3 — something no `standard@28` regression chapter did after
its confirmation. What was left was measured, not read: the voice score.

**Defects.**

- **G20-1: a scene drafted at twice its length.** G20a's scene 2 came back at 5,421자 against 2,650 planned (scene 1 at
  2,015). The chapter stayed at +40 % through five rounds; the scene rewrites the length rung sent were quarantined.
  Fixed by ADR-0112 (`standard@32`): a scene over 1.5× its planned length is re-drafted once toward the target.
- **G16-2 (open since G16r): the voice gate.** G20r's versions mixed 존대 and 반말 inside one quotation six times
  (0.94 per 1,000자); the voice judge's register report caps `register_consistency` at 3 for such lines. The operator's
  656 chapters, read with the same check: median 0 per chapter, p90 4, p90 0.725 per 1,000자. Fixed by ADR-0111
  (`standard@31`): a scene above the operator's p90 is re-drafted once with those lines named.

**Next projects.** G21r (regression, `standard@31`) from 09:24 and G22a (academy, `standard@32`) from 09:33 UTC, both
`--stop-after=5 --auto-resume=6` (ADR-0109), from `/tmp/hoplite/live4` (`8104f82`) and `/tmp/hoplite/live3` (`c1beaf6`).

Credits: 08:47 → 09:33 UTC, ws1 13.58 → 15.19 %, ws2 4.22 → 5.53 %, ws3 61.03 → 62.58 %, ws4 23.65 → 24.41 %, ws5 6.44 →
9.99 %, ws6 9.79 → 12.13 % (11.12 points: both chapters, 134 calls, and the two new projects' planning). Run 3 so far:
19.63 points since 08:12.

## 18. G21r and G22a — chapter 1 on `standard@31` and `standard@32` (09:24–10:05 UTC)

| | G21r (regression, `@31`) | G22a (academy, `@32`) |
| --- | --- | --- |
| Rounds | r0 v1 82 (0 / 2), voice 63.7 → r1 v2 83, **0 / 0**, voice 74.7 → r2–r5 quarantined or 0 / 0 at voice 70.3–74.7 | r0 v1 82 (0 / 2) → r2 v3 **approved** (0 / 0) → confirmation 0 / 2 → r5 v5 **approved**, overall 91, every gate passing → confirmation: voice 71.7 |
| Stopped on | the voice gate (74.7 / 76) with 0 / 0 | the voice gate (71.7 / 76) at the confirmation |
| Re-drafts | one register re-draft (mixed utterances 6 → 3 per chapter, inside the operator's p90) | none needed (4,824자 v1; scenes 1,797 and 3,027) |
| Second readings | 15 `:agree` calls | 12 `:agree` calls |

G21r's remaining voice findings (all minor after the second readings) are card deviations: a character carded as strict
하십시오체 sneering in 반말, a verbal tic in another character's mouth. Both chapters were granted five rounds at 09:57 and
10:06 UTC.

**G22-1: an approval on a carried voice score.** G22a's v4 and v5 carried v3's voice reading because the r3 and r4
patches aimed at structure; the confirmation's two readings of v5 averaged 71.7. Fixed by ADR-0113 (`standard@33`): the
voice judge re-reads after any patch that changed dialogue.

**The granted rounds (09:57–10:27 UTC).**

- **G21r** (115 calls, 465,905 in / 43,791 out, 2,767 s in all): voice passed from r6 (76.9) and v8 was **approved** at 0 / 0
  with every gate passing (voice 87.8). The confirmation found a real slip that the reproducing reading kept — the
  hero's 7 million won goes into his coat pocket and comes out of a plastic bag — and a genre major; the reviser left the
  slip in v9 and v10, while its rewrites changed the contracted closing status window (a contract failure) and, in v11,
  had the unawakened hero kick a steel door off its hinges (G9-6 again). Stopped at the cap (1 / 1).
- **G22a** (129 calls, 503,601 in / 46,240 out, 3,478 s in all): approved four times in all (v3, v5, v7, and v10 at overall
  91, voice 95.7); every confirmation raised new majors. Stopped at the cap on one reproduced continuity
  `power_rule_violation` (0 / 1).

**Defects.** G21-1: a reproduced slip survives two patch rounds (the reviser rewrites elsewhere and breaks the contract's
closing line instead). G22-2: an approval is followed by new, reproduced majors at the confirmation in every project —
the confirmation reads the whole chapter fresh, the round's targeted readings do not. Both open.

G21r and G22a stay as the record of `standard@31` and `standard@32` at the grant cap (ADR-0108). **G23r** (regression,
`standard@33`) was started at 10:23 UTC from `/tmp/hoplite/live4` at `7719a2c` (`--stop-after=5 --auto-resume=6`).

Credits 09:33 → 10:28 UTC: ws1 15.19 → 18.56 %, ws2 5.53 → 6.52 %, ws3 62.58 → 65.16 %, ws4 24.41 → 25.36 %, ws5 9.99 →
15.62 %, ws6 12.13 → 16.45 % (17.84 points). Run 3 in all: 37.47 points since 08:12.

## 19. Run 4 — why acceptance does not converge (2026-09-26, from 11:58 UTC)

**No live call in run 4.** The sandbox had none of the permanent database's or the bridge's variables (`09-progress.md`),
so STEP 0.2–0.3 (migrate, `corpus:verify --database`, the bridge probe, credits, G23r's resume) and every measurement below
that reads the stored runs or calls the model are **BLOCKED**. G23r's state is unknown.

**STEP 1.1 — the per-finding table (G17a chapter 2, G19r, G20r, G21r, G22a, G23r).** `quality:findings <project>` builds it
from the stored scorecards and version texts: for every blocking or major finding (and every one a second reading
demoted), its round and version, the reading (full, targeted, confirmation), the evaluator, whether the paragraphs it
quotes changed since that evaluator's last reading or had been read and passed unchanged, whether a second reading kept
it, and whether it was later fixed, came back or was never addressed; the real-slip verdict is the analyst's, from the
quoted span. **BLOCKED:** not run on the six projects. What §13 and §15–§18 already record is summarized in ADR-0114.

**STEP 1.2 — reading variance** (five full readings of G22a v10, G21r v8 and one G23r version; per judge: finding count,
share seen in at least three of five readings, score spread): **BLOCKED.**

**STEP 1.3 — diagnosis:** ADR-0114. The acceptance decision is taken by the last single reading while every reading
samples a different set of findings on the same text; many of those findings are real (G18r, G21r), some are not.

**What `standard@34` changes (ADR-0115).** Every evaluator reads three times and a reviewer-class finding stands on two;
hard kinds keep their one-reading rule; gated scores are medians. After a patch, a new finding on text that passed
unchanged is held for the one final full reading, an open finding on unchanged text stays open, and the confirmation runs
once. The simulated runs of `novel-ko.integration.test.ts` reproduce both G22-2 patterns: under `standard@33` each stops
at `APPROVAL_BLOCKED` with every gate passing (one after six reproduced majors on five different paragraphs), under
`standard@34` each is accepted. The live A/B on the same seeds is **BLOCKED**.

**What `standard@35` changes (ADR-0116, G21-1).** A finding still open after a kept patch round that targeted it is named
to the next reviser as a survivor (change the quoted sentence itself, and both places of a contradiction), and after two
kept surviving rounds its scene is drafted again. In the simulated run the survivor note reaches round 2 under
`standard@35` and not under `standard@34`. The live A/B is **BLOCKED**.
