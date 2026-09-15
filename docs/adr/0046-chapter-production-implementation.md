# ADR-0046: Chapter-production implementation choices — previous-chapter gate order, replay activity binding, and test isolation

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** engineering agent (Checkpoint 5), following ADR-0003/0004, ADR-0036, ADR-0037, ADR-0044

## Context

Checkpoint 5 implements the deterministic, Postgres-checkpointed chapter-production vertical slice
(ADR-0036 §MVP slice, ADR-0044 staged orchestration). Three points in the design needed a concrete
decision that earlier docs left open or described only as intent:

1. **Where the previous-chapter gate sits in `produceChapter`.** The plan requires that chapter k > 1
   never starts from a draft or missing chapter k−1 (PREVIOUS_CHAPTER_NOT_ACCEPTED, invariants §2
   items 4/8). The WIP slice (PR #7) ran the gate *after* model spend and canon writes
   (`interpretRequirements` → `buildStoryBible` → gate), so a blocked chapter 2 still consumed budget
   and wrote bible rows.
2. **How ReplayProvider matches recordings whose prompts embed run-specific ids.**
   Bible/contract/plan activities interpolate UUIDs (`{{entity.…}}`, `{{version.…}}`) that differ per
   run, so a pure prompt-hash key can never match them.
3. **Why canon/entity tables stay globally keyed.** `entities`/`promises` use a global `id` UUID
   primary key (not project-scoped) per the data architecture. A project-scoping `WHERE project_id`
   on the existence check was tried during repair and reverted: with a global PK a genuine cross-project
   collision fails loudly (`duplicate key … "entities_pkey"`), which is the correct fail-closed behavior;
   scoping the check only moved the failure into `createEntity`. The order-dependence seen in the
   failure-paths suite was a test-topology artifact (one shared Postgres database across tests that reuse
   the fixture's fixed deterministic UUIDs), not a production isolation bug.

## Decision

1. **Gate first, spend never.** `produceChapter` runs `ensureChapter` then `previousChapterSummary`
   *before* `interpretRequirements`/`buildStoryBible`. A missing or non-`accepted` chapter k−1 raises
   `PREVIOUS_CHAPTER_NOT_ACCEPTED` with `recommendedActions: ['retry_step']` before any canon write or
   model call; no draft is ever substituted.
2. **Activity-id replay binding with hash priority.** `ReplayProvider` keys recordings by prompt hash
   first, with an `activity:<activityId>` fallback carried in `ProviderRequest.trace`, reported in
   `served`. Prompt-hash recordings win; unbound `{{…}}` placeholders are errors, never silent output.
   Every fixture call has a recording; `misses == []`; no live provider is ever configured.
3. **Global canon identity; per-test database isolation.** Production `buildStoryBible` keeps the global
   `SELECT 1 FROM entities WHERE id = $1` existence check. The failure-paths integration block resets the
   database per test (`resetDatabase` + `migrate` in `beforeEach`) so fixed fixture UUIDs cannot leak
   between tests.

## Alternatives considered

- **Gate after planning (WIP order)** — spends model budget and writes bible rows for a chapter that is
  definitionally blocked; rejected.
- **Project-scoped entity/promise existence checks** — tried and reverted; masks the loud PK violation
  with a later identical one while weakening the fail-closed invariant; rejected.
- **Per-test UUID randomization** — would break replay determinism (recordings key on those ids);
  rejected in favor of per-test database reset.

## Consequences

- T17 proves the gate fires before spend; T19 proves crash-resume replays completed steps without
  re-spend on the same project with no reset between interrupt and resume; T19b proves two live projects
  cannot share deterministic fixture UUIDs (global canon identity fails loudly, never silently); T5/T7/T10/T11/T13/T21 prove fail-closed boundaries hold.
- Follow-ups: per-project name thesaurus (Checkpoint 6),
  Temporal orchestration from Checkpoint 7 (ADR-0044 unchanged). The `chapter:produce` / `chapter:status` /
  `chapter:resume` / `export:accepted` CLI surface over this workflow is delivered (replay-only,
  `apps/cli`, 5 chapter-surface tests).
