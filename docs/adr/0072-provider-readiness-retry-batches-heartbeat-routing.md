# ADR-0072: Provider readiness — policy retry with backoff, a batched bible cast, a run heartbeat, per-class routing checks

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0041 (pinned Production Policy), ADR-0051 (autopilot runs, live providers), ADR-0052
  (complete bible before prose), ADR-0056 §14 (Notion adapter deadline), ADR-0070 (Phase A live run),
  `docs/08-delivery/12-live-run-ws1-7.md`

## Context

The Phase A live run (ADR-0070) never reached a chapter. Its bible stage failed on the one
`character_designer` call that designs the whole cast (up to 7,000 output tokens): three attempts, each HTTP
502 from the Notion bridge after ~16 minutes, one after another with no pause, and then the run failed. The
gateway moved to the next route immediately on a retryable fault, stopped after at most four attempts, and
recorded no wait; nothing outside the process showed whether a run that had not written a row for an hour
was working or stuck; and the per-class model variables (`YEONJAE_MODEL_R/P/M/C`) had no check that the
routes a mode configures can carry the prompts routed to them.

## Decision

1. **Retry and backoff come from the pinned policy** (`provider_retry`). After a retryable fault — HTTP 429,
   5xx (502/503/504 included), a transport fault or, with `retry_empty_reply`, an empty completion — the
   gateway waits `base_delay_ms × multiplier^(n−1)` capped at `max_delay_ms` (full jitter: a uniform share
   of it), moves to the class's next route and wraps to the first, up to `max_attempts` (clamped 1–8). The
   wait is taken after the admission slot is released and ends early on cancellation. Every attempt carries
   its `backoff_ms` on the call's audit row. A refused request (4xx) is never retried. Without the block the
   loop behaves exactly as before (next route at once, at most four attempts).
2. **The bible cast is designed in three checkpointed batches** under `planning.design_batches`:
   protagonist, core cast (3–5), supporting cast (2–4). The same `character_designer` prompt runs each batch;
   only the workflow-written cast brief differs, naming the characters already designed (roles in Korean for
   a Korean project) and asking for one register-only entry for the protagonist toward the new characters,
   which the merge folds into the protagonist's design. Each batch is its own step and `cast_batch`
   artifact, so a rerun replays completed batches; the merged cast is the usual `cast` artifact. Supplied
   characters missing after the last batch regenerate that batch. `world_builder`, `power_system_designer`
   and `story_architect` keep one call each: they succeeded through the bridge in the K2 run, and splitting
   them needs new prompt versions; the live run measures them. `faction_designer` and
   `naming_registry_compiler` do not exist in this codebase (organizations come from `world_builder`; the
   naming registry is assembled deterministically).
3. **`standard.v6` = `standard.v5` + `provider_retry` (6 attempts, 30 s base, 240 s cap, ×2, full jitter,
   empty replies retried) + `planning.design_batches`.** Earlier pins are unchanged and replay byte for byte.
4. **Unattended runs write a heartbeat.** `novel:run --status-file=<f>` rewrites an atomic JSON beat every
   30 s from the run's own rows (status, next chapter, accepted chapters, calls, the last call/step/event, the
   step in flight, idle time). With no call, step or event for longer than `--stuck-after-min` (default 150
   min: six attempts at the adapter's 1,260 s deadline plus the policy's backoff), the run is failed with
   `RUN_STUCK` and the reason, and the process exits. `quality:run-report --status-file=<f>` shows the beat.
5. **Per-class routing is checked, not assumed.** `requirementsFromPrompts` derives each class's needs from
   the active prompt set (largest output budget, JSON answers, a context floor); `checkRouting` reports
   missing routes, too little context, no native JSON, no fallback route, and judges on the writer's own
   model; `provider:check [--probe] [--json]` prints the matrix (model ids are never printed) and optionally
   sends one tiny request per class. **In notion mode every class goes to the bridge's pooled model:
   per-class routing does not apply and judges share the writer's model.** This is a known limitation,
   reported as a warning (`SINGLE_POOLED_MODEL`), not a blocker; live per-class routing is exercised by
   tests with fakes only.

## Alternatives considered

- **Changing the gateway's default retry behaviour** — rejected: every pinned project would change how it
  spends; retry is policy (ADR-0041), opt-in by version.
- **Splitting `world_builder` and `story_architect` now** — rejected until live evidence shows they fail:
  each split needs a new prompt version and a merge contract.
- **A shorter Notion client deadline to fail fast** — rejected again (ADR-0070 §1); the adapter is
  operator-managed.

## Consequences

- A 502 run of the bible cast costs one batch, not the whole cast, and waits before retrying.
- An unattended run either shows progress in its status file or ends as `failed: RUN_STUCK` with a reason.
- Operators can check a provider configuration before spending: `pnpm cli provider:check`.
- Follow-ups: split other large outputs if the live record shows them failing; per-class sampling
  parameters in the policy remain open.
