# ADR-0117: Bounded plan critic re-plan loop, narrowed reveal exemption, and spanless claim anchoring, `standard.v36`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0077 (multi-patch), ADR-0086 (plan critic, reveal schedule), ADR-0088 (contract critic), ADR-0092 (ladder), ADR-0114, ADR-0115, ADR-0116;
  `docs/08-delivery/13-live-run-gemini.md` §19.5.

## Context

1. **G19-3 (Plan critic reveal exemption & single un-re-critiqued repair).** The plan critic (`plan_critic@4.7.0`) exempted any beat where the hero judged and acted on hidden knowledge from being flagged as `reveal_unsafe`. While intended for prior-life and source-work memory, the prompt broadly allowed later-dated reader secrets to leak into first-person narrative action. Furthermore, contract-stage findings received only one re-plan attempt (`:critic`) that was never re-critiqued, and scene plan repair loops only performed deterministic consistency checks without re-invoking `plan_critic`.
2. **Spanless multi-patch clustering defect (G24r r8–r10).** When all targeted issues in a revision round were spanless (such as `missing_required_event` pointing to `p1~p3` and `length_out_of_range`), `clusterIssueSpans` fell back to `[{ start: 0, end: total, issues }]`. This passed the entire 7.4k-character manuscript to `targeted_reviser`, which produced a truncated 2.2k-character draft, causing `patch_regressed` and immediate quarantine across rounds 7 through 10.

## Decision

`standard.v36` = `standard.v35` + **`planning.plan_critic.max_repairs: 2`** + **`prompts.max_version: "4.11.0"`**.

1. **Narrowed reveal exemption (`plan_critic@4.11.0`).**
   - In `system.md`, `reveal_unsafe` narrows the exemption strictly to prior-life memory (`회귀 전 기억`) and source-work knowledge (`원작 지식`).
   - Any beat showing a later-dated secret on page or contradicting character actions recorded in the bible is treated as a major defect.
2. **Bounded plan critic re-plan loop (`planning.ts`).**
   - In `chapter_contract`, the plan critic runs in a bounded loop up to `criticPolicy.max_repairs` (tracking the candidate with the fewest serious findings).
   - Re-planned contracts are re-critiqued with activity suffix `:critic:repair${attempt}`, retaining the candidate with the fewest serious findings.
3. **Scene plan re-criticism (`drafting.ts`).**
   - Within the scene repair loop, `runPlanCritic` re-runs with activity suffix `:repair${attempt}`, combining newly critiqued findings with deterministic checks.
4. **Spanless claim anchoring and length isolation (`multi-patch.ts`, `revision.ts`).**
   - `claimSpan` resolves spanless issues with paragraph claim anchors (e.g. `p1~p3`, opening, ending) or `paragraph_ids` to their specific paragraph code-point boundaries.
   - When text is provided, unanchored issues return empty clusters rather than falling back to `0..total`.
   - `length_out_of_range` and `dimension === 'length'` are excluded from targeted patch clusters and `pickRevisionDimension`, preventing destructive whole-chapter patch rewrites.

## Consequences

- Contract and scene plan defects are verified iteratively under `standard.v36`.
- First-chapter opening requirements (e.g. regression realization in `p1~p3`) are patched locally within their paragraph spans, keeping the rest of the manuscript intact.
- Tests: `policy.test.ts` (v36), `registry.test.ts` (plan_critic@4.11.0), `multi-patch.test.ts` (claim anchoring, spanless filtering), `dialogue-floor.test.ts`.
