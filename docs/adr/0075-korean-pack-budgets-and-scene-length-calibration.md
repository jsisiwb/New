# ADR-0075: Korean pack budgets and scene length calibration (`standard.v8`)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0059 (Korean token estimator), ADR-0041 (Production Policy), ADR-0073 (`standard.v7`),
  `docs/08-delivery/12-live-run-ws1-7.md` §8.

## Context

The live continuation run on `standard.v7` (Notion bridge, a fresh project on the Phase A intake with a
first-person point of view) went from intake to an assembled chapter 1 and failed before evaluation:

- **K-1 (`PACK_FAILED`).** The continuity checker's critical context needed 20,928 tokens after the
  degradation ladder against the `pack.continuity_checker` budget of 20,000. Measured offline on the same
  project state: chapter text 7,376, participants' states 3,744, contract 2,352, knowledge 2,025, world
  rules 1,433, constraints 570 and the ledgers — 18,407 before rendering. The Phase A packs on `standard.v6`
  were already at 19,771–19,782 of 20,000 without a ladder step, and its writer packs at 20,893–21,169 of
  24,000. The budgets date from the English packs; a Korean pack is measured with the Korean estimator, one
  token per 자 (ADR-0059), about 1.4 times the o200k count, so a 5,300자 chapter alone takes a quarter of the
  checker's budget before any canon.
- **K-2 (length).** The three scene drafts came back at 2,293자, 1,960자 and 2,464자 against targets of
  1,700, 1,800 and 1,800 (+35 %, +9 %, +37 %): 6,717자 against 5,300, beyond the 20 % fail tolerance. The
  writer is told its target; it systematically writes more.

## Decision

1. **`standard.v8` raises the Korean-sensitive budgets:** `writer_input_budget_tokens` 24,000 → 36,000,
   `pack.continuity_checker` 20,000 → 34,000, `pack.extractor` 18,000 → 30,000, `pack.chapter_planner`
   14,000 → 20,000. In o200k tokens that is roughly 25k/24k/21k/14k, well inside the context of every model
   class the policy routes to. The estimator does not change (manifests of pinned runs keep their counts),
   no template or ladder changes, and T1 is still never dropped.
2. **`length.scene_calibration` (K3):** the scene plan keeps its target and evaluation still measures the
   chapter against the contract; only the length the writer is asked for changes — `request_ratio` × the
   scene's target, and with `redistribute` the remaining scenes' targets are rescaled by the chapter's
   remaining budget (the planned total minus what this chapter's earlier scenes measured), clamped to
   `[min_ratio, max_ratio]`. The labelled Korean scene plan and the writer's length variable both carry the
   requested length; the draft checkpoint records it (`requested_length`). `standard.v8` uses
   `request_ratio` 0.8 (the live overshoot's inverse), `redistribute`, `min_ratio` 0.5, `max_ratio` 1.3.
   Replayed on the live overshoot profile the chapter lands within the 12 % warn band.
3. **Everything else is `standard.v7`'s.** Projects pinned to v1–v7 replay byte-identically; new projects
   opt in by naming `policy/standard@8`.

## Alternatives considered

- **Change the Korean estimator to the o200k ratio.** Rejected: pinned manifests record the estimator, the
  worst case is cl100k at 1.08 tokens/자, and a conservative estimator with a budget sized for it is the same
  pack for less risk.
- **A trim or continuation call after assembly.** Deferred: it is an extra full-chapter rewrite whose content
  drift then needs its own regression check. The request calibration costs no call; a residual miss is still
  caught by the length gate and the revision rounds.
- **A deeper degradation ladder for checker packs.** Deferred: a template change is a new template version
  for every project; the measured Korean packs fit the new budgets with room for the previous chapter.

## Consequences

- Korean chapter-1 packs of the size measured live fit without a ladder step; the headroom is the previous
  chapter (tail, summary, delta) and later growth in on-page participants.
- Scene writers are asked for less than the plan's target; the gate, the report and the plan still speak in
  the plan's target. `requested_length` lets the run report compare asked with delivered.
- Evidence: `packages/workflows/src/length-calibration.test.ts`, `packages/domain/src/policy.test.ts`
  (v8 = v7 + the two changes), the Korean `standard.v8` simulated run in
  `packages/workflows/src/novel-ko.integration.test.ts`, and the live `standard.v8` run
  (`docs/08-delivery/12-live-run-ws1-7.md` §8).
