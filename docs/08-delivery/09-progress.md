# Progress — durable project state

The single place that records implementation status (ADR-0043). Update it in every checkpoint commit.
Everything else in `docs/` describes design; only this file claims what exists and what has run.

## Current state

| Item | Value |
| --- | --- |
| Project | Yeonjae Studio — English manuscripts in the Korean serialized-webnovel tradition |
| Phase | **Checkpoint 2 — domain, database and canon core** (complete pending review); Checkpoints 0–1 in PRs #1–#2 |
| Default branch | `hoplite/ainos-1ac771f8` (baseline commit `2823bb9`) |
| Working branch | `hoplite/prokonnesos-fc9b87c1--build-01-foundation--build-02-domain-canon` (stacked on Checkpoint 1, PR #2) |
| Application code | pnpm workspace: `packages/prose`, `packages/domain`, `packages/gateway` (MockProvider skeleton), `packages/db` (migration 0001, `canon.commit_delta`, `canon.rollback_latest`, bitemporal helpers), `packages/canon` (deterministic verifier + acceptance), `apps/cli` (pure + DB commands); 83 tests incl. 15 Postgres integration tests |
| CI | `planning-validation.yml` (validator) + `ci.yml` (Postgres 16 service; types-fresh, typecheck, lint, format, unit + integration tests, CLI smoke, audit, gitleaks) on every push/PR |

## Checkpoints

| # | Name | Branch | Status | PR |
| --- | --- | --- | --- | --- |
| 0 | Corrected planning baseline (audit, ADR-0037…0044, validator, schemas, fixture, policies) | `hoplite/prokonnesos-fc9b87c1` | done, awaiting review | [#1](https://github.com/jsisiwb/New/pull/1) |
| 1 | Repository foundation (pnpm workspace, TS strict, lint/format/test, schema→types lockstep, CI, mock provider, CLI skeleton, code-point/length/language primitives, StoryClock + lifecycle machines, policy loader) | `…--build-01-foundation` (stacked on 0) | done, awaiting review | [#2](https://github.com/jsisiwb/New/pull/2) |
| 2 | Domain, database and canon core (migration 0001; immutable versions; code-point evidence trigger; frame × timeline rule; `canon.commit_delta` with change classes + complete `inverse`; `canon.rollback_latest`; quarantine; bitemporal helpers; verifier; CLI DB commands) | `…--build-01-foundation--build-02-domain-canon` (stacked on 1) | done, awaiting review | stacked on #2 |
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
| `DATABASE_URL=postgres://… pnpm check` | types-fresh → typecheck → lint → format:check → unit + Postgres integration tests → validator | **green**: 14 test files, 83 tests passed (Checkpoint 2 head; 15 of them integration tests on Postgres 16.14) |
| `pnpm cli verify-evidence examples/fixture/manuscripts/ch09.accepted.txt examples/fixture/canon-delta.ch09.json` | code-point evidence verification via the CLI | ok: 8 spans verified |
| `pnpm cli db:migrate … manuscript:import … manuscript:approve … canon:accept … canon:state-at` | end-to-end: import fixture ch.9, approval-lock, verified atomic commit (version 0 → 1), state query at ch.11 returns the venom injury | ok (see PR #3 body) |

Tests not run: none skipped locally. Without `DATABASE_URL` the integration suite skips visibly.
Live-model tests: none executed; nothing in this repository is evidence of live-model prose quality.

## Known failures / gaps

- Contrast sets: 4 starter sets in the repo (target ≥ 40 before calibration; B-6-3).
- Fixture manuscripts: only ch.9 (accepted) and its rejected draft exist as text; ch.12/ch.14 evidence is
  described, not addressable, until Checkpoint 5 produces them.
- Thresholds in profiles and policies are `uncalibrated`.

## Unresolved risks (see `03-risk-analysis.md`)

R1/R2 (translation-like vs Western-pacing drift) remain the top product risks and are not testable until
Checkpoint 3 (gateway + judges) and Checkpoint 6 (contrast-set regression on live models).

## Next exact tasks (Checkpoint 3 — narrative identity, prompt registry, gateway)

1. `git checkout -b …--build-02-domain-canon--build-03-identity-gateway` from the Checkpoint 2 head.
2. `packages/narrative`: load the profiles in `examples/narrative-profiles/` (lang/en, tradition/kr-webnovel,
   four genres, composed), compose with merge-patch semantics, compile the Narrative Identity Block per role
   variant (writer_full, editor_full, planner_compact, judge_rubric_*, summarizer_min) with the two contracts
   first and never shed; SHA-256 block hash + separate contract hashes; `IDENTITY_TAIL`.
3. `packages/prompts`: registry of immutable prompt versions (id, semver, content hash, role, purpose,
   input/output schema refs, style_sensitive, manuscript_producing, identity variant, model class, params,
   failure behavior, changelog, regression cases) for the 24 families in the brief; prompt-set pinning.
4. `packages/gateway`: Narrative Identity Guard (fail closed: missing block / missing either contract / stale
   hash / not embedded), routing table, budget guard, structured-output validation with bounded repair,
   post-call output-language check for manuscript roles, retry/fallback, `llm_calls` audit rows with both
   contract hashes (migration 0002), ReplayProvider and FaultInjectingProvider.
5. Tests: Guard matrix, compiler determinism, prompt immutability, budget hard stop, language-check failure
   path (regenerate once → reroute), audit completeness; CLI `identity:compile`, `prompts:list`.

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
| 2026-09-14 | Canon boundary is the SQL function: all canon tables carry BEFORE triggers that refuse writes unless `canon.in_commit` is set by `canon.commit_delta`/`rollback_latest`, and refuse DELETE/TRUNCATE outright; `btree_gist` exclusion constraints make overlapping validity impossible; evidence trigger uses Postgres code-point `substring` on NFC text | `packages/db/migrations/0001_canon_core.sql` |
| 2026-09-14 | Toolchain: TypeScript 5.9 (typescript-eslint peer range), Vitest 4, ESLint 10 flat config, Prettier 3, `json-schema-to-typescript` for types with a freshness check in CI, Ajv 2020-12 at runtime; UUIDv7 implemented in-house (no dependency); deterministic script/lexicon output-language check (no statistical language-id dependency) | README.dev.md |
