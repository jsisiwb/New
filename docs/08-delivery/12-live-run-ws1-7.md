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
