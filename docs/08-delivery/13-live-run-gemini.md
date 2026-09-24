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
