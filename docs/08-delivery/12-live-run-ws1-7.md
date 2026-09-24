# Live Korean run — Workstreams 1–7 (Phase A)

- **Date:** 2026-09-24 (UTC).
- **Purpose:** the first live Korean run through the Notion bridge after Workstreams 1–5 (merged, PRs #1–#5)
  and the chain that follows them (state ledgers, revision, lint v5, Korean planning surfaces): what the
  pipeline produces for a Korean regression/hunter-gate serial, how its gates and lint read live chapters,
  and what the bridge costs in time. Every manuscript sentence quoted here was written by the pipeline; the
  operator (this session) wrote the intake and chose a concept, nothing else.
- **Status rule (ADR-0043):** this file records one run. `09-progress.md` records status.

## 1. Setup

| Item | Value |
| --- | --- |
| Database | disposable `yeonjae_live_a` on local PostgreSQL 16.14; migrations 0001–0021, then 0022 before the bible stage |
| Code | intake, Story Spec and concept 1 on `1eb38d0` + the `--metrics-log` flag; concept 2 and the bible stage on the chain tip of that time (`c8de274`: #6 WS4b, #7 WS7a, #8 WS5b + the flag). The concept and planning prompts are identical in both. |
| Policy | `policy/standard@2` (evaluation v2, ADR-0060), pinned at `project:create --policy` |
| Identity | composed at novel start: `tradition/kr-webnovel@3`, `genre/regression@3` (primary) + `genre/hunter-gate@2`, `lang/ko@4` |
| Provider | `YEONJAE_PROVIDER_MODE=notion`, pooled model `notion-ai` (two Notion workspaces), three routes per class |
| Client deadline | the environment's `YEONJAE_NOTION_TIMEOUT_MS=600000` until 10:30; the adapter default 1,260 s afterwards (§3.1) |

Intake (operator-written specification, not manuscript): a one-sentence Korean premise — the last surviving
hunter of a destroyed world regresses to ten days before the first gate opens — genre regression +
hunter-gate, 15세, 200화 at 5,500자 per 화, "노골적인 성적 묘사 금지", autopilot. `novel:approve --stop-after=5`.

## 2. Timeline

| UTC | Event |
| --- | --- |
| 09:17:38 | `novel:start`; identity composed; run `suggesting` |
| 09:36:25 | `requirement_interpreter` succeeded on attempt 2 (525 s); attempt 1 was aborted by the 600 s client deadline |
| 09:54:58 | concept 1 succeeded on attempt 2 (514 s); attempt 1 aborted at 600 s |
| 10:24:58 | concept 2 failed: all three attempts aborted at 600 s → run `failed` (`MODEL_CALL_FAILED`) |
| 10:30:16 | `novel:start` again with the adapter's default deadline (1,260 s); intake, spec and concept 1 replayed from their checkpoints |
| 10:37:36 | concept 2 succeeded on attempt 1 (439 s); run `awaiting_approval` |
| 10:43:10 | operator approved concept 1 (`--stop-after=5`); `novel:run` started the bible |
| 11:31:47 | `character_designer` failed: three attempts, each HTTP 502 from the bridge (`retryable_provider`), 48 min in all → run `failed` |
| 11:33:32 | `novel:resume`, `novel:run` again; the retried `character_designer` call had not returned when this record was written (12:21) |

## 3. Findings

### 3.1 The client deadline must outlast the bridge's failover

The bridge gives one workspace 600 s and then moves the call to the second workspace (ADR-0056 §14). The
environment set `YEONJAE_NOTION_TIMEOUT_MS=600000`, so the client aborted every call that the first
workspace had not finished at exactly the moment the bridge failed it over: `requirement_interpreter` and
concept 1 succeeded only on their second route, and concept 2 lost all three routes (3 × 600 s) and failed
the run. With the adapter's default (1,260 s = two bridge attempts + 60 s) the same concept 2 request
succeeded on its first route in 439 s. `.env.example` now says to leave the variable empty (ADR-0070 §1).

### 3.2 The English concept seed leaked into Korean output

Both concepts were generated with the English angle seeds (the run started before #9). Concept 1's `angle`
came back as "…마지막 생존자라는 **프리미스**를 정공법으로 민다" — the seed's word *premise*, transliterated. #9
gives Korean projects Korean seeds; the simulated test had missed it because the simulated model echoes
its seed.

### 3.3 A crash before the first concept call leaves the run `suggesting`

A restart attempt that crashed while loading the pinned policy (the stale content hash fixed in #6/#7)
had already moved the run from `failed` to `suggesting`; the crash happened before `suggestConcepts`'s
failure handler, so the run stayed `suggesting` until the next `novel:start` replayed it. Harmless here (the
next start proceeded), but `novel:status` showed a run that was not running.

### 3.4 The character designer fails on the bridge

The bible's first stage (`character_designer`, up to 7,000 output tokens) failed three times with HTTP 502
from the bridge after ~16 minutes each. The K2 run (ADR-0056) saw the same stage succeed only on a
fallback route. The run was resumed; the bridge had not answered the retry 48 minutes later, when this
record was written. The rest of the bible (world, progression, blueprint, arcs) and every chapter wait on
this stage.

## 4. The run report

`quality:run-report` (ADR-0067) on the live database when this record was written:

| Role | Calls | OK | Attempts | Failed attempts | Latency of the succeeded attempt | Tokens in/out |
| --- | --- | --- | --- | --- | --- | --- |
| `requirement_interpreter` | 1 | 1 | 2 | 1 | 525 s | 661 / 842 |
| `concept_generator` | 3 | 2 | 6 | 4 | p50 439 s, max 514 s | 3,697 / 2,379 |
| `character_designer` | 1 | 0 | 3 | 3 | — | 0 / 0 |

- Wall clock from the run's creation to the last recorded call: 8,047 s (2 h 14 min) for the Story Spec, two
  concepts and one failed bible stage. Cost: 0¢ (the bridge reports no price).
- Normalizer counters (`--metrics-log`, ADR-0057): all zero — no planner, writer, judge or reviser output
  had been normalized, because none ran.
- No chapter rows, scorecards, plan checks or quarantined versions exist yet.

The bridge's own health report at 12:00 UTC: two workspaces, round-robin with failover, neither
rate-limited nor cooling down; over the bridge process's lifetime roughly a third of the requests had failed
on each workspace (61 completed / 31 failed and 52 / 30), and each workspace had used about 60 % of its
billing-period AI credits.

## 5. Reproducing the report

```bash
DATABASE_URL=postgres://…/yeonjae_live_a pnpm cli quality:run-report <project> --metrics-log=<file>
DATABASE_URL=postgres://…/yeonjae_live_a pnpm cli quality:lint-ko <project> --layer=lang/ko@5
```

Both read only (ADR-0067); the second needs accepted chapters.

## 6. What this run did not reach, and why

- **Chapters.** No chapter was drafted in this session, so there are no per-chapter judge sub-scores,
  gate results, lint findings, revision rounds or evaluator latencies to report, and no manuscript excerpt:
  the bible's first stage did not get through the bridge (§3.4). The run stays resumable from its
  checkpoints (`novel:resume`, `novel:run`).
- **A4 and A5** (ADR-0070): decided "not yet", with the evidence each needs.
- **A live run on `standard.v3`–`v5`** (state ledgers, discard-and-continue, labelled scene plans): the
  project is pinned to `standard@2` by design; those policies have simulated evidence only.

## 7. Phase A, second attempt — `standard.v6` through chapter 1 (2026-09-24, 14:36–15:35 UTC)

Every manuscript sentence quoted here was written by the pipeline; the operator (this session) wrote the
intake (`ops/live-runs/phase-a-intake.json`: regression + hunter-gate, a one-line premise, 200화 × 5,300자,
15세, one restriction) and approved the first of the two concepts.

### 7.1 Setup

| Item | Value |
| --- | --- |
| Database | disposable `yeonjae_live_b`, PostgreSQL 16.14, migrations 0001–0022 |
| Code | the Phase P branch (ADR-0072), then the A-1 fix (ADR-0074) for the resume |
| Policy | `policy/standard@6` (provider retry with backoff, batched cast, labelled scene plans, ledgers, discard-and-continue) |
| Identity | composed at novel start: `lang/ko@5`, `tradition/kr-webnovel@3`, `genre/regression@3` + `genre/hunter-gate@2` |
| Provider | `YEONJAE_PROVIDER_MODE=notion`; model id from `YEONJAE_MODEL_NOTION` (only that variable was set; rule 2); client deadline as configured by the operator (not changed) |

### 7.2 Timeline

| UTC | Event |
| --- | --- |
| 14:36:42 | `novel:start` |
| 14:40:02 | Story Spec and two concepts done (3 min 20 s; one concept attempt retried after a 7.3 s backoff) |
| 14:53:50 | concept 1 approved (`--stop-after=5`); `novel:run --status-file` |
| 14:55:45 | cast in three batches done (one batch attempt retried after an 11.5 s backoff) |
| 15:01:07 | world, progression and blueprint done: bible complete in 7 min 17 s (8 characters, 3 locations, 3 organizations, 16 propositions, 10 promises, 4 seasons) |
| 15:03:50 | chapter 1 failed `SCENE_PLAN_INVALID` — the contract named no location (defect A-1) |
| 15:27:01 | fix deployed; `novel:resume` replayed every checkpoint (no repeated paid call) and planned the scenes |
| 15:35:31 | chapter 1 `needs_attention: APPROVAL_BLOCKED` after three revision rounds (defects A-2, A-3) |

### 7.3 Chapter 1

| Measure | Value |
| --- | --- |
| Length | 5,621자 with spaces, 4,330 without (target 5,300 ± 12%: 4,664–5,936) — within target; 99 paragraphs |
| Rounds | r0 + three revision rounds; every patched version failed its regression check and was quarantined (discard-and-continue) |
| Gate (r0) | prose 38.3/78 ✗ (rubric 62.5, lint composite 2), structure 87/78, genre 95/72, voice 95.7/76; 2 blocking, 10 major, 17 minor |
| Best patched round (r1) | prose 81.8/78 (rubric 75, lint 92) but 3 blocking → quarantined |
| Korean lint (r0) | `KO-NAME-02`×6 (major, all false positives — A-2), `KO-DLG-SHARE`×1, `KO-PARA-LONG`×1 |
| Judge / checker findings (r0) | contract checker: the regression fact arrives at ¶7–9, not in the first three sentences (AC-1); continuity: a text message sent while the sender was pinned down; promise checker: the possession-novel term “원작에서” in a regression serial; prose judge: 번역투 “짐승의 그것처럼”; knowledge-leak checker (2 blocking): the narrator's own regression (A-3) and the regressor's future knowledge of a side character's secret (A-4) |
| Normalizers | `contract_location_fallback` 1, `scene_plans` 1, `patch_quote_anchor` 1, `judge_quote_anchor` 45; the others 0 |
| Calls | 36 over the run (bible 9, chapter 27); per role p50: scene writer 61 s, reviser 69 s, prose judge 30 s, continuity checker 55 s, chapter planner 70 s |
| Tokens | chapter 1: ~113k in / ~17k out; whole run: 139,655 in / 30,238 out |
| Cost | 0¢ recorded (the bridge reports no price); bridge billing-period credits moved from 60.26 % / 64.73 % to 61.76 % / 67.51 % on the two workspaces (≈ 4.3 points for the run) |
| Wall clock | intake to chapter 1's stop: 58 min 49 s, including the 23-min stop for A-1 |

Excerpt (the first three lines of the pipeline's chapter 1, unedited):

> 심장이 갈기갈기 찢겨 나가는 감각.
> 단말마조차 뱉지 못한 채 억눌렸던 숨이 단번에 터져 나왔다.
> “후읍!”

### 7.4 Defects (ADR-0074)

| # | Evidence | Status |
| --- | --- | --- |
| A-1 | contract `locations: []` → `SCENE_PLAN_INVALID` on every scene | fixed: registered fallback location from the contract's text, recorded as a continuity risk; the run resumed |
| A-2 | 6 `KO-NAME-02` majors on ordinary words (독식해, 차가운, 수하, 쓰기, 지구, 곰탱) matched against aliases, short forms and two-syllable names; lint composite 2 | fixed for new projects: `KO-NAME-04` in `lang/ko@6` (`standard.v7`); `lang/ko@5` is pinned and unchanged |
| A-3 | the narrator's own regression listed as a reader secret (blocking) | fixed for new projects: `evaluation.pov_secrets_reader_visible` (`standard.v7`) |
| A-4 | the regressor's future knowledge of a secret due at 15화, used by the planned chapter-one hook | open: the knowledge model has no notion of future knowledge |

The v6 project stays at chapter 1 on its pinned layer and is kept as this record; the continuation runs a
fresh project on `standard.v7`.

## 8. Phase K checkpoint — `standard.v7`, then `standard.v8` (2026-09-24)

### 8.1 `standard.v7` (16:21–16:34 UTC)

A fresh project on the Phase A intake plus `pov: first` (`ops/live-runs/phase-a-v7-intake.json`, config only),
pinned to `policy/standard@7` (`lang/ko@6`), driven by the same scripts as §7 through the Notion bridge.

| | |
| --- | --- |
| Start → concepts | 1 min 59 s (requirement interpreter, two concepts) |
| Approval → bible | three cast batches, world, progression, blueprint; 7 cast, 3 locations, 3 organizations, 15 propositions, 10 promises, 4 seasons |
| Chapter 1 | arc plan, contract (rhythm check recorded), three scene plans, three scenes drafted and assembled |
| Stop | `failed: PACK_FAILED` at the continuity checker's pack — critical context 20,928 tokens after the ladder against 20,000 (K-1, ADR-0075) |
| Length | scenes 2,293자 / 1,960자 / 2,464자 against 1,700 / 1,800 / 1,800 — 6,717자 against 5,300 (+27 %, K-2, ADR-0075) |
| Calls | 15, none failed; 66,390 in / 17,273 out; per role p50: scene writer 63.7 s, chapter planner 36.6 s, story architect 43.7 s |
| Cost | 0¢ recorded; bridge billing-period credits 61.76 % / 67.51 % → 62.24 % / 69.09 % |

Offline, on the same project state, the continuity pack's items measured 18,407 tokens before rendering:
chapter text 7,376, participants' states 3,744, contract 2,352, knowledge 2,025, world rules 1,433,
constraints 570, ledgers and relationships 475, promises 194. The Phase A packs (§7) had been at 19,771–19,782
of 20,000 with no ladder step. `standard.v8` raises the Korean-sensitive budgets and calibrates the scene
writer's requested length (ADR-0075); the v7 project stays at chapter 1 as this record.

### 8.2 `standard.v8` (17:01–17:48 UTC)

A fresh project on the same intake pinned to `policy/standard@8`, run to chapter 1's stop, resumed once.

| | |
| --- | --- |
| Start → concepts | 2 min 7 s |
| Bible | 7 cast, 4 locations, 2 organizations, 15 propositions, 26 promises, 4 seasons |
| Pack (K-1) | the continuity checker's pack built (the v7 stop is gone) |
| Length (K-2) | scenes asked for 0.8 × target with the remainder redistributed; chapter 1 assembled at **5,349자** against 5,300 (+0.9 %; v7: +27 %) |
| First stop | revision round 2: the reviser's patch had no `scope` → `PATCH_UNANCHORED`, run `failed` (live defect L-1, ADR-0076) |
| Resume | on the Phase L code (scope inferred, `patch_fields` 1): three revision rounds completed |
| Rounds | r0 overall 77, 7 majors, prose 66.1/78 ✗; patched rounds prose 93.1 / 85.6 / 81.2, each quarantined by the patch regression check |
| Stop | `needs_attention: APPROVAL_BLOCKED` on r0 — 0 blocking, 7 majors; structure 87/78, genre 95/72, voice 91.3/76 |
| Remaining majors (last scorecard) | `KO-DLG-SHARE` 14 % dialogue and inner speech (threshold 25 %); continuity: the phone shows Sunday, a later scene says “weekday afternoon”; contract: the veteran narrator talks to himself aloud against the contract's instruction |
| Calls | 48, none failed; 165,194 in / 27,928 out; per role p50: scene writer 50.5 s, reviser 52.3 s, chapter planner 73.9 s, judges 20–32 s |
| Cost | 0¢ recorded; bridge billing-period credits 62.24 % / 69.09 % → 63.98 % / 71.96 % |

The remaining majors are genuine: a weekday contradiction, a contract instruction the draft breaks, and
dialogue under the Korean lint's floor for a first-person opening. The pattern of Phase A repeats: the patched
rounds fix what they target and are quarantined for what they bring. The reviser was sent the union of the
targeted spans, and it rewrote whole scenes. ADR-0077 (multi-patch rounds, `standard.v10`) follows from this.

### 8.3 `standard.v10` (18:07–18:24 UTC)

A fresh project on the same intake, pinned to `policy/standard@10` (multi-patch rounds, ADR-0077).

| | |
| --- | --- |
| Start → concepts | 1 min 34 s |
| Bible | 6 cast, 3 locations, 3 organizations, 11 propositions, 8 promises, 4 seasons (`contract_location_fallback` 1) |
| Length | chapter 1 assembled at 4,799자 against 5,300 (−9.5 %, inside the 12 % warn band) |
| Rounds | three, each one cluster: the targeted voice findings sat in one window; one sub-patch applied per round, none dropped |
| Blocking/major by round | r0 4/4, r1 1/6, r2 2/4, r3 3/4 — r1 cut the blockings from 4 to 1 |
| Regression | r1 `new_blocking_or_major_issue` + `protection_failed`; r2 and r3 **only** `protection_failed`, on continuity, knowledge and voice (all failing on r0 already) and on the translation-like and register majors r0 already carried |
| Stop | `needs_attention: APPROVAL_BLOCKED` on r0 — 4 blocking, 4 major; prose 78/78, structure 96.8/78, genre 100/72, voice 60.7/76 ✗ |
| r0 blockings | knowledge-leak ×2: the regressor narrator names a secret he knows from his first life (reveal due in chapter 5) — defect A-4; continuity: canon lists the antagonist as an F-rank hunter, while chapter 1 takes place before anyone has awakened (the bible's rank belongs to a later time); voice: the antagonist begs for his life, which his voice card says he never does |
| Calls | 35, none failed; 121,708 in / 20,862 out |
| Cost | 0¢ recorded; bridge billing-period credits 63.98 % / 71.96 % → 65.02 % / 74.02 % |

The regression reports of every live run show the same thing. Phase A, v8 and v10 quarantined every patched
round with `protection_failed`, and the failing protections include sections that failed on the parent and
majors the parent already carried. Defect V-1: the protections were measured absolutely. ADR-0078
(`standard.v11`) measures them against the parent.
