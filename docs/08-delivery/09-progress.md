# Progress — durable project state

The single place that records implementation status (ADR-0043). Update it in every checkpoint commit.
Everything else in `docs/` describes design; only this file claims what exists and what has run.

## Current state

| Item | Value |
| --- | --- |
| Project | Yeonjae Studio — English manuscripts in the Korean serialized-webnovel tradition |
| Phase | **Checkpoint 1 — repository foundation** (complete pending review); Checkpoint 0 in PR #1 |
| Default branch | `hoplite/ainos-1ac771f8` (baseline commit `2823bb9`) |
| Working branch | `hoplite/prokonnesos-fc9b87c1--build-01-foundation` (stacked on `hoplite/prokonnesos-fc9b87c1`, PR #1) |
| Application code | pnpm workspace: `packages/prose`, `packages/domain`, `packages/gateway` (MockProvider skeleton), `apps/cli`; 62 unit tests |
| CI | `planning-validation.yml` (validator) + `ci.yml` (types-fresh, typecheck, lint, format, tests, audit, gitleaks) on every push/PR |

## Checkpoints

| # | Name | Branch | Status | PR |
| --- | --- | --- | --- | --- |
| 0 | Corrected planning baseline (audit, ADR-0037…0044, validator, schemas, fixture, policies) | `hoplite/prokonnesos-fc9b87c1` | done, awaiting review | [#1](https://github.com/jsisiwb/New/pull/1) |
| 1 | Repository foundation (pnpm workspace, TS strict, lint/format/test, schema→types lockstep, CI, mock provider, CLI skeleton, code-point/length/language primitives, StoryClock + lifecycle machines, policy loader) | `…--build-01-foundation` (stacked on 0) | done, awaiting review | stacked on #1 |
| 2 | Domain, database and canon core | stacked on 1 | planned | — |
| 3 | Narrative identity, prompt registry, gateway | stacked on 2 | planned | — |
| 4 | Context and retrieval | stacked on 3 | planned | — |
| 5 | Chapter-production vertical slice (ch.1 → ch.2 remembers ch.1 → export) | stacked on 4 | planned | — |
| 6 | Quality and long-form validation | stacked on 5 | planned | — |
| 7 | Interface and hardening | stacked on 6 | planned | — |

PR dependency rule: each checkpoint PR is based on the previous checkpoint branch and states its parent;
merge bottom-up. No PR is merged without explicit user authorization.

## Validation commands and latest results

| Command | Purpose | Last result |
| --- | --- | --- |
| `pip install jsonschema && python3 tools/validate-planning-package.py` | schemas, examples, canon-delta union, evidence offsets against fixture manuscripts, cross-file refs, stale terms, truthfulness | **ALL OK** (32 schemas; 14 examples + 1 bundle; 0 contradiction hits) |
| `pnpm install --frozen-lockfile && pnpm check` | types-fresh → typecheck → lint → format:check → test → validator | **green**: 12 test files, 62 tests passed (Checkpoint 1 head) |
| `pnpm cli verify-evidence examples/fixture/manuscripts/ch09.accepted.txt examples/fixture/canon-delta.ch09.json` | code-point evidence verification via the CLI | ok: 8 spans verified |

Tests not run: database integration tests (no DB code until Checkpoint 2). Live-model tests: none
executed; nothing in this repository is evidence of live-model prose quality.

## Known failures / gaps

- Contrast sets: 4 starter sets in the repo (target ≥ 40 before calibration; B-6-3).
- Fixture manuscripts: only ch.9 (accepted) and its rejected draft exist as text; ch.12/ch.14 evidence is
  described, not addressable, until Checkpoint 5 produces them.
- Thresholds in profiles and policies are `uncalibrated`.

## Unresolved risks (see `03-risk-analysis.md`)

R1/R2 (translation-like vs Western-pacing drift) remain the top product risks and are not testable until
Checkpoint 3 (gateway + judges) and Checkpoint 6 (contrast-set regression on live models).

## Next exact tasks (Checkpoint 2 — domain, database and canon core)

1. `git checkout -b hoplite/prokonnesos-fc9b87c1--build-01-foundation--build-02-domain-canon` from the
   Checkpoint 1 head.
2. `packages/db`: forward-only SQL migrations (projects, timelines, entities, manuscript_versions with
   `origin`/`status` + immutability trigger, evidence_spans trigger on code points, facts/events/
   propositions/proposition_truths/knowledge_states/relationship_states/promises/promise_events,
   canon_commits with delta+inverse, quarantine_versions, jobs/job_steps), `canon.commit_delta` SQL function
   (optimistic version check, sets `accepted`, per-class rules of ADR-0038), bitemporal query helpers.
3. `packages/canon`: delta application, change-class enforcement, rollback from `inverse`, quarantine move,
   evidence verification on write (reusing `@yeonjae/prose`).
4. Integration tests against a local Postgres 16 (service container in CI): atomic commit fault injection,
   racing commits → `STALE_CANON`, non-BMP evidence, TR1 transition keeps history, R1/C1/RB1/SR1, T16
   quarantine isolation, StoryClock `ord` index, frame × timeline-kind rule.
5. CLI: `db migrate`, `project create`, `manuscript import`, `canon commit --delta`, `canon state-at`.

## Important decisions log

| Date | Decision | Where |
| --- | --- | --- |
| 2026-09-13 | Lifecycle: `origin` + `status`; approval-locked extraction; accepted on commit | ADR-0037 |
| 2026-09-13 | Five bitemporal change classes; extraction emits transitions only | ADR-0038 |
| 2026-09-13 | `source_story` = fact-bearing timeline kind reached through knowledge; reincarnation reuses prior-loop timelines | ADR-0039 |
| 2026-09-13 | StoryClock: narrative order authoritative; world order partial; calendars; `narrated_at` | ADR-0040 |
| 2026-09-13 | Production Policy = single versioned source of limits/gates; per-dimension gates only | ADR-0041 |
| 2026-09-13 | Issue-override matrix (never / canon_workflow / reviewer / advisory) | ADR-0042 |
| 2026-09-13 | Truthful baseline: starter labels, one progress doc | ADR-0043 |
| 2026-09-13 | Modular monolith first; CLI before API/UI; Temporal after the core loop | ADR-0044 |
| 2026-09-14 | Toolchain: TypeScript 5.9 (typescript-eslint peer range), Vitest 4, ESLint 10 flat config, Prettier 3, `json-schema-to-typescript` for types with a freshness check in CI, Ajv 2020-12 at runtime; UUIDv7 implemented in-house (no dependency); deterministic script/lexicon output-language check (no statistical language-id dependency) | README.dev.md |
