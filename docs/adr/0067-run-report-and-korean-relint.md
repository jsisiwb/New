# ADR-0067: A read-only run report and a Korean re-lint for live-run evidence

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0029 (calibration), ADR-0043 (status only in the progress file), ADR-0057 (normalizer
  counters), ADR-0060 (evaluation v2), ADR-0062 and ADR-0065 (Korean lint layers), the Step 0 improvement
  audit (§8.4, §10.5, §11)

## Context

A live run leaves its evidence in rows and artifacts: one scorecard per evaluated version (gates, gated
dimensions with their composition, issues with their sources and lint rule ids), plan-check findings,
quarantined versions, and one `llm_calls` row per model call with its attempts, latency and usage. Nothing
aggregated them: the audit found no per-role latency or cost series (§10.5), no quality tracking across 화
(§8.4) and none of the operator utilities it lists (§11). Reporting a live run meant hand-written SQL, and
the Korean lint thresholds (starting values) could only be compared with live chapters under the layer the
project happened to pin.

## Decision

1. `buildRunReport` / `quality:run-report <project>` reads a project's run, chapters, versions, quarantined
   versions, scorecard and plan-check artifacts and model calls, and reports per chapter every evaluated
   version (gate outcome, the four gated dimensions with score, threshold, rubric score and lint composite,
   severity counts, issue sources, Korean lint findings by rule with the worst severity), plan-check findings
   and quarantined versions; per role the calls, attempts, failed attempts, latency of succeeded attempts
   (nearest-rank p50/p90/max), tokens and cost; and the run's wall clock. Markdown by default, JSON with
   `--json`. With `--metrics-log=<file>` it adds the newest normalizer snapshot a `novel:run --metrics-log`
   wrote.
2. `relintAccepted` / `quality:lint-ko <project> [--layer=<ref>] [--chapter=N]` runs the Korean lint over
   the accepted chapters with the project's registry names and exemplars, under the pinned language layer
   or another one: the pinned composed profile is copied into a throwaway profile that differs only in its
   language layer, and nothing is stored.
3. Both read only. They call no model, take no lease and write nothing, so they are safe beside a live run.

## Alternatives considered

- **Metrics series in the metrics registry.** Deferred: the registry is per process (ADR-0057), and a live
  run spans processes; the persisted rows are the durable record.
- **Re-running evaluation under another policy.** Rejected: it would spend model calls; lint is
  deterministic and is the part whose thresholds need live evidence.

## Consequences

- A live run report is a command, not a query session, and it can be repeated while the run continues.
- The latency of a timed-out attempt is not recorded (the gateway stores none), so the report counts failed
  attempts but its latency percentiles cover succeeded attempts only.
- Not built: the other audit §11 utilities (`inspect-pack`, `story-state`, `continuity-report`, `bench`,
  `estimate`, platform export, `edit-chapter`), cost/time projection at intake (§10.2) and an A/B harness
  (§8.3).
