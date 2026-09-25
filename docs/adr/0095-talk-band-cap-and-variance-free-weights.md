# ADR-0095: The talk band cap and variance-free weights, `standard.v23`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0083 (the operator's bands), ADR-0086 (span attribution), ADR-0090 (the pronoun band cap), ADR-0093
  (net improvement), `docs/10-corpus/corpus-stats.md`, `docs/08-delivery/13-live-run-gemini.md` §9–§11.

## Context

- **The judges' dialogue rule of thumb against the operator's band.** The operator's first-person chapters put 12.6 % (p10)
  to 38.8 % (p90) of their characters in dialogue and 속마음, median 23.2 % (`corpus-stats.md`, 656 chapters); the
  language layer's `KO-TALK-SHARE-1P` warns below that p10. The structure judge raises a major for "대사 비중이 낮다" at
  19 % (G9a r0), 13 % (G11r r0) and 14 % (G11r r1) — inside the operator's band. In G11r that major was one of the two
  findings of the best first regression draft of the run (1 blocking, 1 major): it sent the round to a scene rewrite,
  which wrote six new majors.
- **Weights read judge variance as damage.** ADR-0093 compares a revision's weighted open findings with its parent's. A
  targeted re-evaluation of the revision also surfaces findings of new kinds on lines both versions share — the same
  variance ADR-0086 stopped charging to the patch — and those counted against the revision's weight.

## Decision

`standard.v23` = `standard.v22` +:

1. **`evaluation.talk_band_cap`.** In a chapter whose measured talk share is at or above the language layer's talk warn
   threshold (the operator's own p10; `KO-TALK-SHARE-1P` in first person), a judge's blocking or major finding about the
   amount of dialogue is recorded as minor (`capTalkFindings`); below that line the judge's severity stands and the lint
   reports the band either way. Same rule, same kind of evidence, as ADR-0090's pronoun cap.
2. **`revision.convergence.net_improvement.exclude_variance`.** The revision's weight leaves out findings of a kind the
   parent did not have on text both versions share; carried and introduced findings still count.

No gate threshold moves.

## Alternatives considered

- **Raise the scene talk targets.** Rejected here: the chapters in question are inside the operator's band; the plan's
  targets already follow the operator's densities (ADR-0086).
- **Cap every judge finding that mentions dialogue.** Rejected: a finding about what the dialogue says (a line out of voice,
  a stranger named) is not about how much there is; the claim must be about the amount.

## Consequences

- A chapter inside the operator's talk band is no longer rewritten for talk alone.
- Tests: `pronoun-cap.test.ts` (the talk cap inside and below the band, other claims and the lint untouched),
  `convergence.test.ts` (variance-free weights: fails under v21, passes under v23), `policy.test.ts` (v23).
