# ADR-0118: The run-5 audit — ADR-0117's code-level changes behind policy knobs, `standard.v37`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0041 (pinned policies), ADR-0077 (multi-patch), ADR-0086 (every knob is opt-in), ADR-0088 (the
  contract critic), ADR-0093 (`length_to_scene`), ADR-0102 (the no-policy class of fixes), ADR-0108 (stuck chapters stay
  as the record), ADR-0117; `docs/08-delivery/13-live-run-gemini.md` §20.

## Context

A pinned policy replays byte-identically: every new behaviour is a new version whose knob earlier policies do not
carry (ADR-0041, ADR-0086). ADR-0117 described its changes as `standard.v36`, but the merged code (commits `839b3f8`
and `9983b3f`) ran them for every policy. The audit of run 5's code found:

1. **Contract critic (`planning.ts`).** For every policy with `plan_critic.contract`, the one re-plan was critiqued
   again (an extra `plan_critic:<n>:contract:repair1` call), and the first contract was kept unless the re-plan had
   strictly fewer serious findings. Before run 5 the valid re-plan was adopted and never critiqued again.
2. **Scene-plan critic (`drafting.ts`).** For every policy with a plan critic, each repaired scene plan was critiqued
   again (`plan_critic:<n>:repair<k>`); the critic's new findings fed the next repair and replaced the stored ones.
3. **Spanless findings (`multi-patch.ts`, `revision.ts`), G24-1.** For every policy with `multi_patch`: a finding
   without a span was placed through its claim (`p1~p3`, the opening, the ending) or `paragraph_ids`; when nothing
   placed, the round had no cluster instead of one whole-text cluster; length findings were dropped from the targets;
   and `pickRevisionDimension` never picked `length`. The last change breaks ADR-0093: a chapter whose only open
   finding is its length now ends the loop (`if (!dimension) break`) instead of rewriting the scene furthest from its
   planned length. A round whose targets placed nowhere threw `PATCH_UNANCHORED` (a failed run, which auto-resume
   repeats) or `INTERNAL` when the length was its only target. The defect it answered is real: G24r's rounds 8–10
   sent the whole 7.4k-자 chapter to the targeted reviser as one patch (the only targets were a `p1~p3`
   `missing_required_event` and the length), got back 2.2k 자, and quarantined each round.
4. **Assert-only ops (`canon/accept.ts`, `acceptance.ts`, `839b3f8`).** An extracted event, fact, knowledge state,
   relationship state or proposition truth written with `op: create` passes the extraction envelope's schema, and
   acceptance's `verifyDelta` refuses it (`ACCEPTANCE_FAILED`, `ILLEGAL_OP`). A resume replays the recorded extraction
   and is refused again: no project gets past it. Run 5 read such an op as `assert` at acceptance and again at
   extraction; the extraction copy changed the stored envelope of every run.
5. **The Notion bridge.** `notion_provider_bridge.py` in the tools folder (611 lines, "restored notion bridge") is a copy of the
   operator's bridge server, the process behind `YEONJAE_NOTION_URL`. Run 5 did not change the gateway's Notion client
   (`notion-provider.ts`, `provider-mode.ts` are unchanged since ADR-0080), and nothing in the repository runs the copy.
6. **CI.** The merged head fails `prettier --check` (six run-5 files), `eslint` (19 errors in run-5 files), three tests
   (`commands.test.ts` did not learn `standard@36` or the 319th prompt; ADR-0106's `standard@28` run stops `failed`
   instead of `needs_attention`, an earlier pin changed by the ungated patch path) and the planning validator
   (`standard.v36.json` outside the example manifest, ADR-0117 missing from the ADR index). GitHub Actions has not run
   on `hundas4/New`.
7. **The reading-variance numbers.** `quality:readings` made no readings. It loaded the scorecards stored for a version
   and, with fewer than five, padded them to five by dropping every fifth finding of a stored one in rotation; its report
   ended in three fixed "conclusions". The run-5 figures (5.6 %, 8.8 %, 20.0 % single-reading noise; "K=3 is adequate")
   measure the padding.

## Decision

1. **`planning.plan_critic.recritique`** carries ADR-0117 decisions 2 and 3: the contract is re-planned and
   re-critiqued up to `max_repairs` times, keeping the candidate with the fewest serious findings; a repaired scene plan
   is critiqued again and its serious findings join the deterministic ones. Without it, the pre-run-5 calls.
2. **`revision.multi_patch.anchor_spanless`** carries ADR-0117 decision 4, corrected. `pickRevisionDimension` is the
   pre-run-5 function for every policy, so a length finding can still choose the round and `length_to_scene` rewrites
   its scene. When a round goes to the patch rung, its targets are the findings a patch can place — spanned, or placed
   by `paragraph_ids` or the paragraph its claim names — never the length (`placeablePatchRound`); when none can be
   placed the loop ends (`stopped: no_placeable_target`) and the chapter reaches the approval check, an attention
   state, because a round with nothing to place would resend the same text. Without the knob, the pre-run-5 clusters.
3. **`standard.v37` = `standard.v36` + both knobs** (`recritique: true`, `anchor_spanless: true`). `standard.v36` keeps
   what its content pins: `plan_critic@4.11.0` (ADR-0117 decision 1) and `max_repairs: 2` for the scene-plan repair loop,
   whose re-checks are deterministic. No project was ever created on `standard@36`, so no stored run changes.
4. **The acceptance-time read of a `create` op as `assert` stays for every policy** (ADR-0102 class): `withFactClocks`
   returns every delta without such an item as the same object, so it changes only deltas acceptance always refused,
   turning a permanent `ACCEPTANCE_FAILED` into the designed commit. The extraction-time copy is reverted.
5. **The bridge copy is removed from the repository.** The running bridge is not touched; its source stays with the
   operator.
6. **CI:** the files are formatted and lint-clean, the CLI tests know `standard@36`, `standard@37` and 319 prompts,
   `standard.v36.json` and `standard.v37.json` join the example manifest, and the ADR index lists 0117 and 0118.
7. **Reading variance.** `quality:readings` reports only the readings that were stored, with their count, and no fixed
   text; the standalone script with hard-coded version ids is removed. The run-5 figures are withdrawn in
   `13-live-run-gemini.md` §19.2, and STEP 1.2 is measured live with independent readings (§20.2).
8. **Live runs.** Projects pinned to `standard@36` or earlier run from worktrees built at this audited commit, not at
   the default branch's head, whose code runs ADR-0117 for every pin. The exit-condition projects (G25r, G25a) start on
   `standard@37`, the version that carries what ADR-0117 meant `standard@36` to do. Chapters produced during run 5 ran
   with some or all of the ungated changes (the live worktree's commit was not recorded); they stay as they are
   (ADR-0108).

## Proof that earlier pins replay byte-identically

- Neither knob appears in any of the 38 earlier policies (`policy.test.ts`); policy hashes are fresh and the prompt
  registry is unchanged (`registry.test.ts`).
- Against `470aaba` (the last pre-run-5 merge), `planning.ts`, `drafting.ts`, `revision.ts` and `chapter-production.ts`
  differ only by knob-guarded code; `clusterIssueSpans` without text equals the pre-run-5 function on 2,000 random issue
  sets (`run5-audit.test.ts`).
- A simulated `standard@36` run makes exactly the pre-run-5 planning calls (one uncritiqued re-plan of the contract and
  of the scene plan); `standard@37` makes the re-critiques (`novel-ko.integration.test.ts`). The `standard@36` half fails
  on the merged head, and so does ADR-0106's `standard@28` run, which passes again here.
- The one exception is decision 4, which changes only runs that ended refused.

## Consequences

- G23r (`standard@33`) and G24a (`standard@35`) continue on the code their pins ran before run 5, plus decision 4.
- A patch round under `standard@37` never rewrites the whole chapter for a finding it cannot place.
- Tests: `run5-audit.test.ts`, `novel-ko.integration.test.ts` (two runs), `policy.test.ts` (v37), `multi-patch.test.ts`.
