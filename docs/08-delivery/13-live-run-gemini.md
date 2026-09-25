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
