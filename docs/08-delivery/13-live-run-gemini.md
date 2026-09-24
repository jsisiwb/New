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
