# ADR-0092: The G9 fixes — the schedule in the canon lines, the heroine formula inside the schedule, score attribution, quoteless findings to a scene, no repeated round, checked rewrites, `standard.v20`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (patch regression), ADR-0086 (span attribution, threshold protection, the reveal
  schedule), ADR-0087 (the ladder), ADR-0088 / ADR-0090 (narrator knowledge), ADR-0083 (the voice profile),
  `docs/08-delivery/13-live-run-gemini.md` §9 (G9).

## Context

The `standard@19` checkpoint (G9) accepted neither chapter 1, and in both chapters the text was not what stopped it:

- **G9-1.** Every pack's canon lines render a secret with the bible's single reveal chapter ("15화 이전 공개 금지") while
  the reveal schedule (ADR-0088, ADR-0090) gives the narrator's remembered game knowledge to the reader from 화 1. The
  writer followed the schedule; the continuity checker read the canon line: three blocking findings in G9a r0.
- **G9-2.** The operator's heroine formula (`operator-voice-analysis.md` §8: "the hero's game knowledge of her, often a
  doomed fate") is a planner line of `voice/operator@2` with no reference to the schedule. The plan critic sent the
  scene plan back to give the heroine's entrance "the fate or secret the hero knows"; the writer told a habit only the
  heroine knows (reader date 8) and the rival's drugs (24): knowledge findings in r0–r4.
- **G9-3.** A judge's score moves in rubric steps (one of four sub-scores ≈ 5 points after weighting) larger than the
  regression tolerance (3). G9r r3 resolved five of its seven majors (7 → 2) and was quarantined for `targeted_worsened`
  alone — genre 90 → 85 against a gate of 72 — and so were r4 and r5. G9a r3 was quarantined because structure read
  87.5 → 77.5 (gate 78) under a paragraph patch that did not touch the opening its new `late_hook` finding quotes; the
  structure rubric read 55, 75, 70, 55, 70, 50 over G9a's six scorecards. A chapter-level complaint the parent already
  had (excessive exposition) was re-anchored by the judge to a passage the patch had rewritten and so counted as new.
- **G9-4.** A failed contract criterion carries no quote. G9r's AC-1 (the status window and the regression within the
  first three sentences) failed in all six scorecards and the patch planner listed it as untargeted every round, so no
  round could ever approve the chapter.
- **G9-5.** After a quarantine the next round rebuilt the same targets from the same scorecard and sent them at the same
  rung to the same parent: G9r r3, r4 and r5 are the same four paragraph patches to v1.
- **G9-7.** The scene-rewrite rung skips the drafting pass's deterministic checks: G9r r1's rewrite slipped into the
  third person (`진우는`), which the drafting pass would have re-drafted, and four blocking findings came from judging it.
  The rewritten scene also lost its range for later rounds (ranges are found by each drafted scene's first line).

## Decision

`standard.v20` = `standard.v19` + the knobs below. No gate threshold moves (`gates.blocking_max` and `major_max` stay 0;
the schema fixes them); every knob is opt-in, so every earlier policy replays byte-identically.

1. **`planning.reveal_schedule.canon_lines` (G9-1).** A Korean pack's canon lines render each secret with the schedule's
   two dates — `독자는 이미 안다(서술해도 됨)` or `독자에게 N화 이전 공개 금지`, and `다른 인물에게 M화 이전 공개 금지` —
   instead of the bible's single reveal chapter (`secretDatesOf`, `secretDatesKo`). The writer's pack and every
   checker pack read the same dates.
2. **`voice/operator@3` (G9-2).** v2 with one planner line changed: the heroine enters with "the fate the hero knows —
   only what the schedule lets the reader know as fact, a hidden secret at most one oblique hint". The formula itself is
   the operator's (§8) and stays; the bound is the schedule's hint budget, which already governs every other role.
3. **`revision.convergence.score_attribution` (G9-3).** With span attribution: (a) a blocking/major finding whose
   dimension and kind stood open on the parent is carried, not introduced, wherever it now quotes; (b) a gated
   dimension whose score fell with no blocking/major finding introduced on it, ending no more than
   `regression_tolerance_points` below its gate, moved by judge variance on text both versions share — it is neither a
   protected regression nor a targeted worsening. The version stays unapprovable while the dimension is below its
   gate and its findings stay targets; only the parent choice changes. A fall further than the tolerance below the gate,
   or one that comes with a finding the patch wrote, regresses as before.
4. **`revision.ladder.spanless_to_scene` (G9-4).** A judge's blocking or major finding with no quote joins the
   scene-rewrite findings; its scene is the one holding the paragraph its claim names (`[pN]`, the numbering every judge
   reads), else the first scene for a claim about the opening and the last for one about the cut (`claimAnchor`).
5. **`revision.ladder.no_repeat` (G9-5).** A round that would send a quarantined attempt's targets to the same parent at
   the same rung escalates: a patch round becomes a scene rewrite of the scene holding most targets (while
   `max_scene_rewrites` allows), with the rejected attempt's reasons in the writer's note; a repeated scene rewrite, or a
   patch round with no rewrite left, ends the loop, and the chapter rests `needs_attention` with the closest version
   (`revision.stopped: repeat_after_quarantine`).
6. **`revision.ladder.rewrite_checks` (G9-7).** A scene rewrite gets the drafting pass's quote marks and repeated-line
   rule, and in a first-person Korean project a third-person drift is re-drafted once (kept only when it no longer
   drifts), before any judge reads it; a kept rewrite is that scene's text for locating scene ranges afterwards.

## Alternatives considered

- **Re-judge a dimension that fell and average two samples.** Considered for G9-3: it measures the same thing more
  precisely but costs a judge call per regressed dimension and needs a second-sample path the evaluator does not have.
  Attribution uses what both versions share (identical lines) at no cost, as ADR-0086 does for findings.
- **Widen `regression_tolerance_points` to one rubric step.** Rejected: it would also excuse a fall the patch caused
  (a finding it wrote), and the tolerance is a threshold (rule 5); attribution leaves every number where it is.
- **Give the reader every source-work secret the narrator knows, whatever the bible's reader date.** Rejected for now:
  G9-1 is a rendering split, not a date the operator disputes; the designer's explicit reader dates stay authoritative.
- **Drop quoteless findings from the gate.** Rejected: a failed contract criterion is a real failure; the fix is to give
  the ladder a rung that can reach it.
- **Repeat quarantined rounds with a higher temperature.** Rejected: G9r r3–r5 show near-identical answers; the
  rejected attempt's reasons and a different rung change the request itself.

## Consequences

- A repeated round costs nothing any more (it escalates or ends); a scene rewrite may cost one more writer call (POV
  redraft). The canon lines and the voice profile cost no call.
- A quarantine now always changes what comes next; the loop can end before `max_rounds`, which the run report shows.
- Open: G9-6 (the unawakened body — the plan critic's own fix proposed kicking the lock, which the continuity checker then
  rejected) and G9-8 (stock figures and world vocabulary) are left to the patch rungs, which G9-3 frees to keep working.
- Tests: `convergence.test.ts` (G9r r3 and G9a r3 replayed: quarantined under v19, kept under v20; a carried finding;
  a fall beyond the tolerance still regresses), `ladder.test.ts` (claim anchors, spanless findings, target keys, the
  repeat decision, Korean rejection reasons), `reveal-schedule.test.ts` (the two dates rendered), `voice.test.ts`
  (v3 changes one planner line), `policy.test.ts` (v20 = v19 + the knobs, gates unchanged).
