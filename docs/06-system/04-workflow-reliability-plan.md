# Workflow Reliability Plan

## 1. Durable orchestration (Temporal, ADR-0003)

- Workflow code is deterministic; every side effect is an activity with a retry policy.
- Activities are idempotent by `idempotency_key`; LLM activities check `llm_calls` for a completed record
  before calling a provider; DB-writing activities use upserts keyed by the same key.
- Long activities heartbeat every 15 s; heartbeat timeout 60 s; start-to-close per role (writer 6 min,
  evaluators 4 min, extractors 5 min, commit 60 s).
- Child workflows: `CanonCommitWorkflow` and `RevisionWorkflow` have `PARENT_CLOSE_POLICY=TERMINATE`
  except `CanonCommitWorkflow` which is `ABANDON` after commit start (commit must finish or roll back on
  its own).
- Workflow IDs are deterministic: `chapter:{project}:{n}:{contract_version}:{nonce}`; reuse policy
  `REJECT_DUPLICATE` while running; `target_leases` guard against concurrent jobs on the same target.

## 2. Failure catalog and handling

| Failure | Detection | Handling |
| --- | --- | --- |
| Provider outage | connection errors, 5xx bursts | retry ×3 w/ backoff (1s→30s, jitter); circuit breaker per provider (open after 5 failures/60s) → route to fallback model of same class; audit records actual model; if no fallback → pause job (`waiting_provider`) and alert |
| Timeout | activity timeout | retry with `max_tokens` −20% once; then fallback model; then `needs_attention` |
| Rate limit (429) | status | token-bucket per provider; backoff honoring `Retry-After`; concurrency reduce; route to alternate |
| Retryable fault under a policy with `provider_retry` (ADR-0072) | 429, 5xx (502/503/504), transport, empty reply | the gateway waits `base × multiplier^(n−1)` (cap, full jitter) after each retryable fault, moves to the class's next route and wraps, up to `max_attempts` (starting value 6, `standard.v6`); each attempt's `backoff_ms` is on the audit row; a 4xx is never retried |
| Stuck unattended run (ADR-0072) | `novel:run --status-file` heartbeat: no call, step or event past the threshold | the run is failed with `RUN_STUCK` and the reason; `quality:run-report --status-file` shows the last beat |
| Invalid structured output | schema validation | `json_repairer` ×2 → regenerate ×1 → step failure → `needs_attention` |
| Truncated output | `finish_reason=length` / `EP-TRUNC-01` | continuation protocol ×1 → regenerate scene with reduced target ×1 → fail |
| Duplicate job | workflow ID policy / lease | reject start with `LEASE_HELD`; UI shows existing job |
| Worker crash | Temporal task timeout | activity re-dispatched; idempotency prevents duplicate spend |
| User cancellation | cancel signal | workflow catches `CancelledFailure`, runs cleanup activity (release lease, mark partial artifacts non-canonical, write cost summary) |
| Partial completion (batch) | child failure/pause | batch records completed chapters; resumable from next chapter; no rollback of accepted chapters |
| Failed extraction | extractor errors/verification failures | chapter stays `approved`; `CanonCommitWorkflow` retried (idempotent); after 3 → `needs_attention` (canon untouched) |
| Failed retrieval | store errors | degraded pack (structured-only) with flag; evaluators later verify; if T1 fetch fails → retry then fail |
| Stale canon | pre-commit dependency check | re-validate contract; continue or restart from planning; never commit over |
| Conflicting jobs | leases | second job waits/rejects; batch sequential |
| Budget exhaustion | pre-call check | stop cleanly at activity boundary; job `paused_budget`; resume after budget raise |
| Low quality after retries | revision round limit | `needs_attention` with residual issues & options |
| Non-English output | output-language check (`EP-LANG-01`) | discard; regenerate once with violation named; then route to alternate P-class model; persistent failure → `needs_attention` |
| Translation-like / Western-novel / literary / serial drift | prose & structure lint + judges | dimension-targeted revision workflow; escalate per `docs/02-narrative-identity/05` |
| Poison input (injection) | classifier | quarantine imported text; require human confirmation |
| Schema/prompt version mismatch | pinned set check | job continues with pinned set; warn if deprecated |
| DB failure mid-commit | tx error | tx rolls back; activity retries; version optimistic check prevents double-apply |

## 3. Checkpoints and resumability

Checkpoint = completed activity with persisted result. Chapter pipeline checkpoints: contract validated;
scene plan saved; each scene draft saved (version `draft`); assembled version saved; scorecard saved; each
patch saved; approval recorded; extraction candidates saved; reconciled delta saved; commit done;
post-commit tasks (each idempotent). A resumed workflow replays deterministically and skips completed
activities via Temporal history; if history is lost (namespace reset), the job can be **rehydrated** from
the DB artifacts by a `ResumeFromArtifactsWorkflow` that finds the last saved stage.

## 4. Dead-letter & escalation

`needs_attention` jobs appear in the **Attention** queue with: failure class, last error, residual issues,
spend so far, recommended actions (retry step / regenerate / accept with override / edit manually / raise
budget). Operators can retry a specific activity from the trace view (re-run with the same idempotency
scope + new attempt scope).

## 5. Idempotency and exactly-once semantics

- LLM calls: at-most-once per idempotency key *with respect to spend*, at-least-once with respect to
  completion (a retried call after a provider response was lost may be re-issued; the record marks
  `duplicate_risk=true` and the cost counted once when the provider returns a request ID we can match).
- Canon commit: exactly-once via version optimistic check + unique `(project, version)`.
- Patches/versions: unique `(chapter_id, version_no)`; version numbers allocated in the activity that
  writes them.

## 6. Timeouts & budgets per workflow

| Workflow | Max duration | Budget guard |
| --- | --- | --- |
| RequirementInterpretation | 10 min | project |
| Concept | 20 min | project |
| StoryBible | 45 min | project |
| SeriesPlanning | 60 min | project |
| ChapterProduction | 3 h (incl. waiting for review: unlimited with `waiting_review` state excluded from timer) | chapter |
| Batch | unbounded (sequence) with per-chapter guards | project |
| CanonCommit | 20 min | chapter |
| Export | 30 min | project |

## 7. Tracing

Every workflow run has a trace: workflow → activities → gateway calls (with `llm_call_id`) → provider
request IDs. The **trace view** in the UI reconstructs a chapter's production from `jobs`, `context_packs`,
`llm_calls`, `manuscript_versions`, `patches`, `scorecards`, `canon_commits`.

## 8. Testing reliability (see testing strategy)

Chaos tests inject: provider 5xx, timeouts, invalid JSON, truncation, worker kill mid-scene, DB failure in
commit, stale canon between evaluation and commit, duplicate start, cancellation during extraction. Each
asserts: no duplicate spend beyond one call, no partial canon, resumability, correct final state.
