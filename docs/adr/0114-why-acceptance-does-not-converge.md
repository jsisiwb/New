# ADR-0114: Why chapter acceptance does not converge — the diagnosis from run 3's record

- **Status:** Accepted (STEP 1.1 measured on the stored runs; the five-reading variance of STEP 1.2 is still to measure)
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0086 (the confirmation), ADR-0100 and ADR-0106 (second readings), ADR-0108, ADR-0115;
  `docs/08-delivery/13-live-run-gemini.md` §13, §15–§19.

## Context

Run 3 accepted no chapter. G21r (`standard@31`) and G22a (`standard@32`) reached approval — G22a four times, the last at
overall 91 with every gate passing — and each confirmation raised new majors that a second reading kept (G22-2); the
reviser left one real slip in place for two rounds (G21-1). Run 4's STEP 1 asked for this to be measured from the stored
runs (G17a chapter 2, G19r, G20r, G21r, G22a, G23r) and from five independent readings of frozen versions before any
protocol change. The database and the bridge became reachable only at 12:56 UTC; `quality:findings` (the per-finding trace
of STEP 1.1) then ran on the six stored runs (`13-live-run-gemini.md` §19.1, `ops/live-runs/run4/step1/`). This ADR records
what the record established first and what the trace then measured.

## What the record establishes

1. **One reading does not establish a finding.** G17a chapter 2's continuity checker found nothing above minor in v5 and,
   52 seconds later, a blocking finding in the same text (G19-1). G14a's structure judge rated the same two observations
   minor at r8 and major at the r9 confirmation (G14-4). G18r's v9: nothing in r8's reading, a major in the confirmation's.
2. **Every confirmation contradicted the reading that approved.** G17a chapter 2 (v5: 0 / 0, then 1 blocking and 5 majors
   from four evaluators), G18r (v9: 0 / 0, then 2 majors), G21r (v8: a slip and a genre major), G22a (v3, v5, v7, v10:
   new majors each time).
3. **Many of those findings were real.** Of G18r's seven round and confirmation findings, all described the text
   correctly and one carried a severity above the policy's (§16); G21r's confirmation found a real slip (the money put in a
   coat pocket comes out of a plastic bag). So the confirmation is not mostly noise: each full reading samples a different
   subset of the text's real slips, plus some findings that are not there.
4. **The loop lets whichever reading comes last decide.**
   - The approving scorecard is assembled from targeted re-readings and carried findings; the confirmation is the first
     reading of the whole text by every evaluator since the last full evaluation, so it draws a new sample.
   - ADR-0100 / ADR-0106's second reading runs only when *every* blocking or major finding is a reviewer-class finding of
     an implicated evaluator — one lint or hard-kind finding switches it off for all of them (G20a) — and it counts a
     finding as reproduced when the second reading rates *any* finding of the same kind heavy, anywhere in the text.
   - Span attribution (ADR-0086) keeps a new finding on unchanged text open (it only spares the patch the blame), so a
     fresh finding on text that had already passed becomes the next round's target.
   - Patches bring new slips that only the next full reading sees (G18r v7's time word, G21r v11's steel door, G9-6).

## Diagnosis

The acceptance decision is taken by a single reading at a time — the last one — while one reading has low recall of the
text's real slips and a non-zero rate of findings that are not there. Each round fixes what the last reading saw; the
next full reading draws a new sample. The chapter converges only when a whole reading happens to find nothing, which the
round cap rarely allows. The fix is in the protocol, not in the gates or the cap: decide a finding by several readings,
tie a finding's standing to the text it quotes, and read the whole text fresh once, at the end (ADR-0115).

## The questions of STEP 1.3, answered from the stored runs (§19)

- **New confirmation findings on text that had already passed unchanged:** 18 of the 22 blocking or major findings of the
  confirmations of G17a chapter 2, G21r and G22a. Over every reading of the six runs, 105 of 198 findings (53 %) were
  raised on paragraphs the same evaluator had read and passed unchanged.
- **How many were real slips:** about 11 of the 22 (canon, voice-card, register, world-rule, numeric, repeated-sentence and
  terminology slips, each checkable against its quoted span); the other half are taste judgments (genre `other`, late
  hook, deferred payoff) that one reading raises and the next does not.
- **Why the reviser failed on G21-1:** not a wrong span, a rejected patch or a missing attempt. Each patch rewrote the
  quoted sentence and the contradiction moved to the next place (r8: the bag “stuffed in the pocket”; r9: that sentence
  fixed, the next still opening the bag; r10: removed), while a new slip (G9-6) stopped the chapter at the cap — a
  two-place contradiction patched one place at a time.

These numbers confirm the diagnosis: most findings that stop a chapter are new samples of text that had passed, about
half of them real.

## Consequences

- ADR-0115 (`standard@34`) implements the protocol change. Its starting values (three readings, a quorum of two, a
  one-paragraph window) are to be recalibrated from STEP 1.2's measurement (five readings of G22a v10, G21r v8 and one
  G23r version: per judge, finding counts, the share of findings seen in at least three of five readings, score spread).
- When the database is reachable: run `quality:findings` on the six projects, fill `13-live-run-gemini.md` §19's table,
  and revise this ADR's answers.
