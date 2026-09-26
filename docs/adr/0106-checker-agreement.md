# ADR-0106: A checker's reviewer-class finding blocks only when a second reading reproduces it, `standard.v29`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0042 (the override matrix), ADR-0086 (the confirmation before approval), ADR-0100 (major
  agreement for taste judges), `docs/05-generation/02-evaluation-and-revision-pipeline.md` §3 (severity policy),
  `docs/08-delivery/13-live-run-gemini.md` §16.

## Context

Run 3 found three `standard@28` chapters stopped on continuity-checker findings (`13-live-run-gemini.md` §16):

- **G19-1: the same checker, the same text, two answers.** G17a chapter 2's v5 was read by the continuity checker in the
  targeted re-evaluation after round 4 (23:40:47 UTC): no finding above minor, and the version was approved. The
  confirmation (ADR-0086) read the same v5 52 seconds later and the checker raised a blocking `character_inconsistency`.
  G18r's v9 went the same way: no major in the r8 reading, a `canon_contradiction` major in the confirmation's.
- **G19-2: every confirmation contradicted the reading that approved.** G17a chapter 2 (v5: 0 / 0, then 1 blocking and 5
  majors from four evaluators), G18r (v9: 0 / 0, then 2 majors), and G14a before them (G14-4). Each round then rewrites
  text to answer the new findings, and each rewrite is read once more by a checker whose next reading samples other
  slips: G18r's granted rounds ended on a new continuity finding in every round (a time word, a sum, a phone's pocket,
  a skill before the system exists).
- **The checker is often right, and severity is where one reading is unreliable.** Reading G18r's findings against the
  text, most are real slips. What one reading cannot establish is whether a slip is a major or a doubt: the evaluation
  pipeline's severity policy already names "low-confidence continuity doubts" as minor (§3), and ADR-0100 showed that a
  judge's single reading does not measure severity reliably. ADR-0100 left checkers out: a checker's finding left the
  evaluation as it was.

## Decision

`standard.v29` = `standard.v28` + **`evaluation.checker_agreement`** (with `major_agreement`). The continuity checker and
the knowledge checker (`AGREEMENT_CHECKERS`) join ADR-0100's second reading:

1. **Who reads again.** When every blocking or major finding of an evaluation is either a taste judge's reviewer-class
   major (ADR-0100, unchanged) or a reviewer-class finding of one of these checkers, major or blocking, that ran in the
   evaluation (`agreementJudges(…, checkers)`), each implicated judge and checker reads the same text once more
   (activity `:agree`).
2. **What stands.** A checker's finding stands when the second reading rates a finding of the same kind, or one whose
   span overlaps it (code-point range or paragraph), major or blocking (`unconfirmCheckerFindings`). Otherwise it is a
   doubt one reading raised and the next did not: it is recorded as minor (override class `advisory`), its claim prefixed
   with a note, and it stays in the scorecard for the reviser and the operator.
3. **What does not change.** Findings outside the reviewer class — `canon_contradiction` and `timeline_error`
   (`canon_workflow`), `knowledge_leak` (`never`) — and project escalations, lint findings, carried findings and the
   contract and promise checkers leave the evaluation as it is, so a contradiction of canon or a leaked secret still
   blocks on one reading. The gates, the override matrix, the confirmation and ADR-0100's rule for taste judges are
   unchanged. A checker has no rubric, so nothing is averaged for it.

## Alternatives considered

- **Override the remaining findings** (ADR-0042). Rejected: an override is a reviewer's judgement about a finding; the
  question here is whether one reading established it.
- **A severity rubric in the continuity checker's prompt.** Deferred: the severity policy already lists inventory and
  rank mismatches as major, so the rubric would restate §3 without making one reading more reliable.
- **A targeted verification call** (show the checker its own claim and ask whether it holds). Rejected for now: a model
  shown a claim tends to agree with it, so it would filter fewer one-off readings than an independent second reading,
  and it needs a new prompt family.
- **Read every checker twice in every evaluation.** Rejected: it doubles the checkers' cost in rounds with real findings
  to repair, where one reading's severity decides nothing.

## Consequences

- A chapter whose last findings are one checker reading's doubts is no longer blocked by them; a reproducible slip, a
  canon contradiction, a timeline error or a leak still blocks.
- The cost is one more checker call when a chapter is otherwise clean, as with ADR-0100.
- Recall: a real slip that the second reading misses is recorded as minor, not dropped. The reviser still sees it, and
  the confirmation reads the whole chapter again before approval.
- Tests: `major-agreement.test.ts` (who reads again under `checker_agreement` and who does not; kind and span
  reproduction), `novel-ko.integration.test.ts` (a simulated run in which every first continuity reading raises a major
  and every second reading none: stopped for attention under `standard.v28`, accepted under `standard.v29`),
  `policy.test.ts` (v29), `commands.test.ts`.
