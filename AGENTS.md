# Instructions for engineering agents

This repository currently contains a **planning package** for Yeonjae Studio. Read this file before
changing anything.

## The governing principle

**The manuscript language is per project (English or Korean); Korean webnovel is the narrative tradition.**
Reader-facing prose is composed **directly in the project's manuscript language** and follows Korean
serialized-webnovel structure, pacing, hooks, payoff and genre conventions. The system never translates
within the generation loop and never drifts into Western epic-fantasy, literary-fiction, or traditionally
published novel pacing. English is produced only by an explicit export/translation step (ADR-0054). See
ADR-0026, ADR-0054 and `docs/02-narrative-identity/01-narrative-identity-architecture.md`.

## Ground rules

1. **The plan is the spec.** Implement what `docs/` describes. If you must deviate, write an ADR in
   `docs/adr/` (next number, same template) *before* the deviation lands, and update the affected docs and
   `docs/01-requirements/04-traceability-matrix.md` in the same change.
2. **Do not weaken the invariants** listed in `docs/08-delivery/05-implementation-handoff-guide.md` §2
   (canon extracted only from approval-locked versions and read only from accepted ones, atomic canon
   commits that set `accepted`, evidence-backed facts, planned ≠ happened, transitions never retract
   history, rejected drafts quarantined, Narrative Identity Guard on every style-sensitive call, English
   output check on manuscript roles, prompt versioning, context-pack snapshots, durable checkpoints,
   per-dimension gates from the pinned Production Policy). They are the reason the product works.
3. **Schemas are contracts.** `schemas/*.schema.json` define the wire/storage shape of the core objects.
   Generate types from them (or keep Zod definitions in lockstep and test equivalence); do not fork them.
   Text fields are language-neutral with explicit language metadata; do not reintroduce
   language-suffixed primary fields.
4. **Korean is terminology and source culture, not manuscript language.** Korean craft terms (사이다,
   회귀, 상태창…) appear glossed in English in profiles and docs; character names and preserved terms are
   governed by the project's naming and terminology policies. Never machine-translate fixture prose,
   profile rules, or terminology entries; never let a formatter reflow example prose.
5. **No secrets in the repo.** Provider keys live in the secret manager / `.env` (git-ignored). `.env.example`
   may list variable *names* only.
6. **Commit per milestone** with focused messages. Never rewrite published history.
7. **Keep the validator green.** `python3 tools/validate-planning-package.py` validates schemas ($ref
   resolution), examples, the canon-delta union, evidence offsets against fixture manuscripts, cross-file
   references, stale lifecycle/length terms and truthfulness claims; run it before every commit that touches
   `docs/`, `schemas/`, `examples/` or `tools/`. CI runs it on every push.
8. **Numbers live in one place.** Workflow limits, gate thresholds and the override matrix come from the
   pinned Production Policy (`examples/production-policies/`, ADR-0041); docs quote them as
   "(starting value, `standard.v1`)" and never define them independently.
9. **Record status only in `docs/08-delivery/09-progress.md`** (ADR-0043). Design documents describe
   design; they do not claim what has been built or tested.

## Where to start implementing

`docs/08-delivery/09-progress.md` (current state, next tasks) → `docs/08-delivery/05-implementation-handoff-guide.md`
→ `docs/08-delivery/01-implementation-roadmap.md` (§0 checkpoint order, ADR-0044) → `docs/08-delivery/02-backlog.md`.
Use the fixture story in `docs/07-quality/02-fixture-story.md` + `examples/fixture/` as the first integration
test. Work on stacked checkpoint branches and open a PR per checkpoint; never merge without explicit
user authorization.

## Repository conventions once code exists (decided in ADR-0001, ADR-0021, ADR-0028)

- pnpm workspace monorepo, TypeScript strict, Node 22 LTS.
- `apps/cli` first (ADR-0044), then `apps/web` (Next.js), `apps/api` (Fastify), `apps/worker` (Temporal
  workers); `packages/*` (domain, db, gateway, prompts, narrative, prose, context, canon, eval, workflows);
  `services/grammar-service` (optional self-hosted grammar/spelling checker for English).
- Postgres 16 (+ pgvector when vector retrieval is enabled) is the single system of record. The MVP core loop
  runs as Postgres-checkpointed idempotent steps; Temporal orchestrates from Checkpoint 7 (ADR-0044).
- All IDs are UUIDv7; all timestamps UTC; all text UTF-8 NFC-normalized at the boundary; all text
  offsets are Unicode code-point indices into NFC text (ADR-0030).
