# Implementation Handoff Guide

For the engineering agent (or team) that will build Yeonjae Studio from this plan.

**Governing principle: English is the manuscript language. Korean webnovel is the narrative tradition.**
Implementing this plan produces English-language novels, composed directly in English, with
Korean-webnovel structure, pacing, hooks, payoff cadence and genre conventions — never Korean prose, never
translation.

## 1. Read in this order (≈ 2 hours)

1. `README.md`, `AGENTS.md`
2. `docs/adr/0026-english-manuscript-korean-webnovel-tradition.md` (governing decision)
3. `docs/00-overview/01-executive-product-definition.md`, `02-glossary.md`, `03-scope-and-release-tiers.md`
4. `docs/01-requirements/01-functional-requirements.md` (FR-0 first; then skim as a checklist)
5. `docs/02-narrative-identity/01-…05-…` (output language + narrative tradition architecture)
6. `docs/04-memory-canon/01-…05-…` (the memory core)
7. `docs/05-generation/01-generation-pipeline.md`, `02-evaluation-and-revision-pipeline.md`
8. `docs/06-system/02-data-architecture.md`, `07-model-gateway.md`, `04-workflow-reliability-plan.md`
9. `schemas/*.schema.json` + `examples/`
10. `docs/08-delivery/01-implementation-roadmap.md`, `02-backlog.md`
11. Remaining `docs/adr/` (all; short)

## 2. Invariants you must never break

1. **Manuscript output, composed directly in the project manuscript language.** Every
   manuscript-producing role writes in the project language — `en` or `ko` per the intake (ADR-0054); a
   deterministic output-language check gates its output; there is no translation step anywhere
   (OUTPUT-LANG-001, NO-TRANSLATION-001).
2. **Narrative Identity Guard with both contracts.** Style-sensitive roles cannot call the gateway without
   a compiled Narrative Identity Block whose manifest carries the project Output-Language Contract hash and
   the Korean-webnovel Narrative-Tradition Contract hash; versions recorded (STYLE-GUARD-001).
3. **Separate dimensions.** English prose quality and Korean-webnovel structural adherence are separate
   evaluators, separate scorecard sections, separate gates; never averaged (EVAL-SEPARATION-001).
4. **Canon only from accepted chapters** (plus bible/user corrections with justification).
5. **Atomic canon commit** with optimistic version check; no canon writes outside `canon.commit_delta`.
6. **Evidence-backed facts** with Unicode code-point spans (ADR-0030).
7. **Planned ≠ happened**; reality frames; **proposition truth per timeline** (ADR-0031).
8. **Rejected drafts quarantined**: never in packs, extraction, summaries, embeddings, exemplars.
9. **Prompt versioning**: no inline prompt strings; every call records `prompt_version_id`.
10. **Context pack snapshots**: `pack_id`/`pack_hash` recorded; T0 validated byte-for-byte including the
    Active Constraint Set (ADR-0033).
11. **Durable checkpoints & idempotency**; budgets checked before each call.
12. **Dependency materiality**: only material edges mark stale by default (ADR-0032).
13. **Thresholds are configuration** with calibration status (ADR-0029).
14. **Tenancy**: RLS on every tenant table.
15. **Korean is terminology, not manuscript**: Korean script only in terminology/naming registries and
    glossed craft terms; never in prose; never imitated as grammar.

## 3. Build order (Phase 0 → 2 detail)

1. Scaffold + schemas → types (B-0-1, B-0-2); code-point utilities + length model (B-0-3).
2. DB migrations + `commit_delta` + evidence trigger + RLS (B-0-4, B-0-5). Write pgTAP tests first.
3. Gateway with Mock/Replay/Fault providers, the Guard and the output-language check (B-0-6). Test both
   before any prompt.
4. Prompt registry (B-0-7). `packages/prose` core (B-0-8). API/worker skeleton (B-0-9). Seed fixture
   (B-0-10).
5. Narrative identity + prose packages (B-1-1…1-6). Use `examples/fixture/contrast-sets.seed.json` in tests
   from day one.
6. Canon package (B-1-7…1-12, 1-16, 1-17). Use `examples/fixture/canon-delta.ch09.json` and
   `knowledge-ledger.json` as expected outputs.
7. Retrieval + context assembler (B-1-13, 1-14). Recall tests from fixture.
8. Workflows (B-2-*) — start with `ChapterProductionWorkflow` on MockProvider, then real prompts; run the
   P-class benchmark (B-2-15) before routing a real writer model.

## 4. Conventions

- Package boundaries as in `docs/06-system/01-system-architecture.md`; no cross-imports that bypass
  interfaces in `packages/domain`.
- Errors: typed error codes (`PACK_T0_OVERFLOW`, `CONSTRAINTS_OVERFLOW`, `STALE_CANON`,
  `NARRATIVE_IDENTITY_MISSING`, `OUTPUT_LANGUAGE_CONTRACT_MISSING`, `TRADITION_CONTRACT_MISSING`,
  `NARRATIVE_IDENTITY_STALE`, `OUTPUT_LANGUAGE_UNSUPPORTED`, `OUTPUT_LANGUAGE_FAILED`, `BUDGET_EXHAUSTED`,
  `LEASE_HELD`, `EVIDENCE_MISMATCH`, `FRAME_VIOLATION`, `KNOWLEDGE_LEAK`).
- Profile data (contracts, rubrics, thresholds, terminology) lives in data files, not literals; Korean
  terminology entries are data and are never machine-translated.
- Text fields are language-neutral (`text`, `summary`, `statement`); language metadata accompanies
  user-authored text; manuscript `language` is `en`.
- Tests colocated; fixture data imported from `examples/fixture` via a package alias.
- Commit per milestone with messages `feat(scope): …`, `test(scope): …`, `docs(scope): …`.

## 5. Where ambiguity is allowed

- Exact provider/model choices → routing tables (config), validated by the English-under-KWN benchmark.
- Exact lint thresholds → profile data; start with documented starting values, calibrate per ADR-0029.
- English rendering choices for registers → the register policy's rendering rules are guidance; the Voice
  Judge and reviewers adjudicate naturalness.
- UI visual design → follow the UI plan's structure; styling is free.
- Internal function names → free; schema field names → fixed by `schemas/`.

## 6. How to verify you are done with a phase

Run the fixture assertions listed in the roadmap's exit criteria; record results, commands, costs and any
ADRs added in `docs/08-delivery/09-progress.md` (the single durable progress document, ADR-0043) and in the
checkpoint's pull request. Keep `python tools/validate-planning-package.py` green whenever schemas, examples or docs change
(it also scans for contradictory language-output statements).
