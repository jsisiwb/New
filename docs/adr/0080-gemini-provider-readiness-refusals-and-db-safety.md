# ADR-0080: Gemini provider readiness — model-id variables, error classes, refusals, bridge credits, database safety

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering (autonomous run; the operator reviews through the PR chain)
- **Relates to:** ADR-0051 (live providers), ADR-0056 (Notion bridge), ADR-0057 (counted normalizers),
  ADR-0072 (`provider_retry`, `provider:check`), `docs/08-delivery/13-live-run-gemini.md`.

## Context

From this run on, every role is served through the Notion bridge by one model the operator names as Gemini
3.1 Pro. Before any prose behaviour changes, the provider layer had to be measured and five gaps closed:

1. **Model-id variables.** The operator sets the model id under two names, `YEONJAE_NOTION_MODEL` and
   `YEONJAE_MODEL_NOTION`. The code read only the first; the live-run log said the earlier runs took the
   id from the second, which the code never read.
2. **Error classes.** An empty reply, a 5xx, a throttle and a transport fault were all recorded as
   `PROVIDER_FAILED`. A safety block was a generic refused request (`non_retryable_request`). A finish
   reason outside `stop|length|content_filter|error` (Gemini's `MAX_TOKENS`, `SAFETY`,
   `PROHIBITED_CONTENT`, `RECITATION`) was mapped to `stop`, so a truncated or blocked answer looked
   finished. A refusal *in words* ("죄송하지만 … 작성해 드릴 수 없습니다") passed as a two-sentence scene or
   burned the schema repair budget.
3. **Normalizers.** The gateway's own JSON recoveries (fence stripping, object extraction) were not counted,
   so the common Gemini habit of fencing JSON was invisible.
4. **Spend.** The bridge prices no call; its `/health` endpoint reports per-workspace billing-period and
   rolling-window use, which earlier runs copied by hand.
5. **The permanent database.** Novel data now lives in the operator's permanent PostgreSQL 16. Its URL
   carries `sslmode=require` against a self-signed certificate: psql connects, node-postgres refused
   (`DEPTH_ZERO_SELF_SIGNED_CERT`), because node-postgres reads `require` as `verify-full`. And the test kit
   resets whatever `DATABASE_URL` names (`DATABASE_URL ?? TEST_DATABASE_URL`, then `DROP SCHEMA public
   CASCADE`): a test run in a shell that inherits the permanent URL would wipe the novels.

## Decision

1. **Both model-id names are accepted; `YEONJAE_NOTION_MODEL` wins.** It is the name the adapter has read
   since ADR-0056, so an existing deployment keeps its meaning; `YEONJAE_MODEL_NOTION` is an alias.
   `notionModelFromEnv` reports the source and a conflict (both set, different), and `provider:check`
   prints the source and warns on a conflict, never a value.
2. **Error classes.** A new failure class `refused` (never rerouted). `ProviderFailure` carries a
   `reason` (`empty_reply`, `http_5xx`, `http_429`, `http_4xx`, `safety_block`, `transport`, `deadline`,
   `malformed_body`) and the audit's `error_class` is derived from it: `EMPTY_REPLY`, `HTTP_5XX`,
   `THROTTLED`, `HTTP_4XX`, `REFUSED`, `TRANSPORT`. A cut-off JSON answer keeps `SCHEMA_INVALID` and is flagged
   `truncated_json` on its attempt (same repair path). Unknown wire finish reasons are mapped by meaning
   (`MAX_TOKENS` → `length`, `SAFETY`/`PROHIBITED_CONTENT`/`RECITATION` → `content_filter`). An error body
   below 500 that names a safety block is `refused`.
3. **Refusal rule, policy-gated.** `provider_retry.refusal { max_retries, detect_text }`. Under it a
   content-filter finish, a thrown safety block, or (with `detect_text`) a reply of at most 600 characters
   that reads as a refusal where prose or JSON belongs is recorded `refused`, and the **same request** is
   sent again **on the same route** at most `max_retries` times; then the call fails `MODEL_REFUSED`. The
   request is never softened: the story is not weakened to avoid a refusal, and a recurring refusal is a
   defect to record. Without the block every refusal is still counted
   (`yeonjae_provider_refusals_total`) and the call proceeds exactly as before, so pinned policies replay
   unchanged. The block first appears in `standard.v12` (Phase G).
4. **Counted JSON recoveries.** `json_fence_stripped` and `json_object_extracted` join the counted
   normalizers and are listed on the attempt record (`normalizers`).
5. **Bridge credits.** `bridge:credits [--json]` and `provider:check --credits` read `/health` and print
   numbers only (billing-period %, rolling window, request counts per workspace); `creditDelta` gives the
   points a run used.
6. **`provider:check --probe --deep`** sends three small Korean requests on the P route and reports: the
   model family the reply names, whether a JSON-only answer came back clean, fenced or wrapped and which
   recovery would fire, and whether a 1,500-item array came back whole. Reply texts are not returned.
7. **Database safety.** `createPool` gives `sslmode` its libpq meaning (`uselibpqcompat=true` unless the
   URL sets it), so the product connects wherever psql does. `resetDatabase` refuses any database whose
   name is not a test, restore-drill or harness database unless `YEONJAE_ALLOW_DB_RESET=1`
   (`RESET_REFUSED`). `DATABASE_MIGRATION_URL` stays documented as reserved: no code reads it.

## Alternatives considered

- **`YEONJAE_MODEL_NOTION` wins.** Rejected: it would silently change which model an existing deployment
  calls when both are set.
- **Retry refusals on the next route.** Rejected: in notion mode every route is the same pooled model, and
  in live mode rerouting a declined request re-sends the same bytes to a second paid model. The same route
  with backoff is enough to catch a stochastic refusal.
- **Rephrase or soften a refused prompt automatically.** Rejected: it weakens the story to satisfy a
  filter. A refusal that recurs is recorded as a defect instead.
- **Replace the English `NOTION_COMPLETION_FRAME` with a Korean one.** Not done: the frame is the adapter's
  transport (ADR-0056) and the operator's rule for this run is not to modify the adapter's transport. The
  Korean prompt surface inside the frame is unchanged, and the Latin-leak scan covers it.
- **Disable TLS verification globally** (`NODE_TLS_REJECT_UNAUTHORIZED=0`). Rejected: process-wide, and it
  would also disable verification for the provider's HTTPS calls.

## Consequences

- Measured live through the bridge (`docs/08-delivery/13-live-run-gemini.md` §0): the identity probe's
  reply names Gemini; a JSON-only answer comes back clean (no fence; the bridge also returns a parsed
  `json` field); a 1,500-item array (7,894 characters) came back whole with `finishReason: stop` in 59 s; a
  tiny call costs about 0.05–0.08 billing-period points; probes sent while a run holds the pool fail fast
  as empty completions (the bridge serializes per workspace).
- Tests: `packages/gateway/src/refusal.test.ts` (detection, finish-reason mapping, error classes, the
  refusal rule with and without the block, truncated-JSON and fence labels, model-id precedence),
  `bridge-credits.test.ts` (readings without names, deltas, the deep probe's labels),
  `packages/db/src/db-safety.test.ts` (sslmode semantics, reset guard).
- Follow-up: `standard.v12` (Phase G) turns the refusal rule on.
