# ADR-0100: A taste judge's major blocks only when a second reading reproduces it, `standard.v27`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0042 (the override matrix), ADR-0060 (rubric sub-scores), ADR-0086 (the confirmation before
  approval), ADR-0095 (judge variance on unchanged text), ADR-0098 (granted rounds),
  `docs/08-delivery/13-live-run-gemini.md` §13.

## Context

- **G14-4: the same judge rates the same observation minor, then major.** G14a's structure judge read r8 fresh and
  recorded a late hook and a summarizing last line as minor (structure 87.5). The confirmation re-read r9, which
  differed by one sentence, and recorded both as major, with a pacing and an exposition major besides (structure 77.5,
  below its gate of 78). r10's fresh reading had the hook major and the pacing and exposition minor. The confirmation
  (ADR-0086) is right to read the whole chapter again; one reading of a taste judge is simply too noisy a measure of
  severity to decide acceptance alone.
- **This is the last blocker the live runs show.** After ten rounds each, G14a ended at 0 blocking / 2 majors (a late
  hook, bystander reaction cuts used four times) and G14r at 0 / 3, all four dimension gates passing in both. Every
  remaining finding is a reviewer-class major from a taste judge.

## Decision

`standard.v27` = `standard.v26` + **`evaluation.major_agreement`**. It applies when every blocking or major finding of
an evaluation is a reviewer-class major raised by a taste judge (prose, structure, genre, voice or repetition) that ran
in that evaluation (`agreementJudges`). Each such judge then reads the same text once more (activity `:agree`). A
major stands only when the second reading rates a finding of the same kind major or blocking (`reproducedKinds`);
otherwise it is recorded as minor with a note that the second reading did not reproduce it (`unconfirmMajors`). The
judge's rubric sub-scores and judge score become the mean of the two readings (`averageReadings`). The first
reading's pronoun cap applies to the second as well.

Nothing else changes. A blocking finding, a checker's finding (continuity, knowledge, contract, promises), a lint's, a
carried one, or any kind outside the reviewer class leaves the evaluation as it is, so facts, canon and the manuscript
language are judged as before. The gates, the override matrix and the confirmation are unchanged; the second readings
cost calls only when a chapter is otherwise clean.

## Alternatives considered

- **Override the remaining majors.** Rejected for the run: overrides are a reviewer's decision about a finding. This is
  about whether one reading established the finding at all.
- **Read every judge twice in every evaluation.** Rejected: it doubles the judges' cost in rounds that have real majors
  to repair, where the reading's severity does not decide anything.
- **A third reading on disagreement (best of three).** Deferred: two readings already separate a reproducible major
  from a one-off, at a third of the cost.

## Consequences

- A chapter whose last majors are one reading's severity is no longer blocked by them; a reproducible major still
  blocks.
- Tests: `major-agreement.test.ts` (who reads again, and who does not; merging the readings), `policy.test.ts` (v27),
  `commands.test.ts`.
