# ADR-0096: Arc-plan beat types and the pronoun band lint, `standard.v24`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0056 (single marker hits are evidence), ADR-0060 (rubric sub-scores and lint composites), ADR-0083
  (the operator's bands), ADR-0090 (the pronoun band cap), ADR-0094 (arc-plan stances), `docs/10-corpus/corpus-stats.md`,
  `docs/08-delivery/13-live-run-gemini.md` §12.

## Context

- **G13-1: a beat type outside the schema fails the arc plan.** G13r's arc planner typed its tenth beat `cliffhanger`; the
  arc plan failed validation (`/beats/9/type`, `ARC_PLAN_INVALID`) after ten calls, and a resume replays the recorded
  answer, so the run cannot pass the step. It is the shape of G11-1 (a stance outside the schema, ADR-0094) in another
  field. Nothing downstream computes with an arc beat's type: it is a label the planners read next to the beat's text.
- **G12-1: per-hit pronoun markers cost the operator's own chapters their prose composite.** The language layer marks
  every 그는, 그녀의 … (`TRN-KO-14`) as a minor finding, and the rubric score model (ADR-0060) charges each minor 4 points
  of the prose lint composite. The same layer's rate rule (`KO-PRN-RATE-1P` in first person) warns only at the operator's
  p90. Measured with `lintKoreanWebnovel` under `lang/ko@9` on the operator's 259 first-person chapters in the permanent
  database, the marker fires 7 times per chapter at the median and 14 at p90; with it the operator's median prose
  composite is 52 and 68 % of the chapters are below 64, without it the median is 80 and 15 % are below 64 (all 656
  chapters: 28 against 72). With the prose judge's weight of 0.6, a chapter at composite 52 needs a rubric score of 95 to
  pass the prose gate (78).
- **The live consequence.** G12a (academy, first person) wrote 1.5–1.8 그/그녀 per 1,000자 in every round — at the
  operator's first-person median (1.51), under the warn line (2.57). The marker produced 11, 9, 11, 11, 9 and 9 of the
  round's 14, 9, 12, 11, 9 and 9 lint minors, holding the prose composite to 44–64; in r1, r4 and r5 it was every lint
  finding. The prose judge's digest listed those hits as 번역투 findings, and its translation-markers sub-score was 1 or 2
  in every round. r5 ended at 0 blocking and 4 majors with prose at 66.9 (rubric 68.8, composite 64); without the marker
  the composite is 100 and prose 81.3. The regression project writes no 그/그녀 at all (G11r: 0) and passed prose in
  every round.

## Decision

`standard.v24` = `standard.v23` +:

1. **`planning.normalize_arc_beats`.** An arc plan's beat type is read as the schema knows it (`arcBeatTypeOf`): an exact
   type stays, a planner's word becomes its nearest type (`cliffhanger` → escalation, `twist` → reversal, `payoff` →
   cider), and a beat whose word cannot be read keeps its place and text as `escalation` instead of failing the plan.
2. **`evaluation.pronoun_band_lint`.** In a Korean chapter whose measured 그/그녀 rate is below the language layer's
   pronoun warn line (the operator's p90, the key the rate rule reads), each `TRN-KO-14` hit is recorded as a note: its
   span is kept, it costs the prose composite nothing, and the prose judge's lint digest replaces the hits with one line
   naming the rate and the band (`pronounBand`, `proseLintDigest`). At or above the line every hit stays minor and the
   rate rule's own finding stands, as without the knob.

No gate threshold moves, and no lint rule or threshold changes.

## Alternatives considered

- **Drop an unreadable beat, as ADR-0094 drops an unreadable stance.** Rejected: a wrong stance would plan a wrong
  knowledge change, but a beat's type is only its label, and dropping the beat loses the event it plans.
- **Lower the marker's severity or weight in a new language layer.** Rejected: the marker is the right evidence above the
  band, and a layer change would re-lint every pinned project; the band is a property of the chapter, not of the rule.
- **Tell the writer to avoid 그/그녀 outright.** Rejected: the operator's own chapters use them at this rate, and the
  project's voice is the operator's (ADR-0083); the band already bounds the rate.
- **Raise the prose judge's translation-markers sub-score when the chapter is in band.** Rejected: the rubric stays the
  judge's reading. The digest gives the judge the band as evidence instead of eleven findings pointing the other way.

## Consequences

- A first-person chapter inside the operator's pronoun band is scored on its other prose findings; stacked pronouns still
  cost what they cost before.
- An arc planner's off-schema beat word no longer stops a run.
- Tests: `pronoun-band-lint.test.ts` (notes inside the band with their spans, minor at the warn line and under v23, the
  third-person line when the layer has no first-person one, the digest), `story-plan.test.ts` (`arcBeatTypeOf`),
  `policy.test.ts` (v24).
