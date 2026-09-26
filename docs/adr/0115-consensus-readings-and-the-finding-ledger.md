# ADR-0115: Consensus readings and the finding ledger, `standard.v34`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0060 (targeted re-evaluation), ADR-0086 (span attribution, the confirmation), ADR-0100 and ADR-0106
  (second readings, superseded under this policy), ADR-0114 (the diagnosis), `docs/08-delivery/13-live-run-gemini.md` §19.

## Context

ADR-0114: a chapter's acceptance is decided by one reading at a time, the last one, and each full reading samples a
different set of findings on the same text (G19-1, G19-2, G22-2). The gates and the round cap are not the problem and do
not change.

## Decision

`standard.v34` = `standard.v33` + **`evaluation.consensus`** `{ readings: 3, quorum: 2, ledger: { window_paragraphs: 1 } }`
(starting values, `standard.v34`).

1. **Consensus readings.** Every model evaluator that runs in an evaluation reads the text `readings` times (the first
   reading keeps its activity id; the others carry `:c2`, `:c3`). Its findings are grouped across the readings — spans
   that overlap, whatever kind each reading gave them, or the same kind when neither quotes the text; one reading's
   findings never merge with each other. A reviewer-class finding stands at the highest severity that at least `quorum`
   readings rate it at or above; rated blocking or major by fewer readings it is recorded as minor with the note
   “(3회 판독 중 1회만 주요 결함으로 지적)”. A finding outside the reviewer class (canon contradiction, timeline error,
   knowledge leak, requirement violation, forbidden development) stands on one reading, as before. Gated scores are the
   medians of the readings; a contract criterion fails only when `quorum` readings fail it. ADR-0100 / ADR-0106's second
   reading does not run under consensus.
2. **The finding ledger.** In an evaluation with a parent scorecard (after a patch, including the smoke re-reading after
   `smoke_after_patches` patches; never the confirmation), each evaluator's consensus findings are read against the text
   it last read:
   - a blocking or major finding in a changed paragraph, within `window_paragraphs` of one, or with no quote counts;
   - one on unchanged text counts only when it re-raises an open finding; otherwise it is held as minor with the note
     “(앞서 통과한 대목의 새 지적: 최종 전체 판독의 합의를 거쳐야 한다)” — that text was read and passed, so only the final
     full reading, by consensus, may raise it;
   - an open finding on unchanged paragraphs stays open whatever the re-reading says (a reading cannot fix text that did
     not change); one on changed text is resolved unless the re-reading raises it again.
3. **One fresh full reading.** Under the ledger the confirmation (`revision.convergence.confirm_full`) runs at most once
   per chapter: when a ledger-decided evaluation first becomes approvable. Later approvals rest on the ledger.

## Alternatives considered

- **A focused verifier call for findings a single reading raised.** Deferred: it would recover real slips a quorum
  misses, but a yes-biased verifier would readmit noise, and neither rate is measured yet (STEP 1.2).
- **Re-read only the patched spans with a new local prompt.** Not adopted: continuity needs the whole chapter (the slip
  in G21r spans two distant paragraphs). The evaluators read the whole chapter; the ledger decides which findings count.
- **Temperature or seed control.** The adapter forwards `params` (the prompt version's temperature and `max_tokens`; no
  seed) to the bridge; whether the Notion bridge honours them is unknown and needs a live probe (**BLOCKED** in run 4).
  Consensus does not depend on it.
- **More rounds or lower gates.** Excluded by the operator's rules.

## Consequences

- About three times the evaluator calls per evaluation (credits are not the constraint for this run).
- A single reading can no longer block a chapter with a reviewer-class finding, and a re-reading can no longer drop an
  open finding on text that did not change. Hard kinds keep their one-reading rule, so a canon contradiction, a timeline
  error or a leak still stops a chapter.
- Risk: a real slip raised by one reading of three is recorded as minor. The held and demoted findings stay on the
  scorecard with their notes, and `quality:findings` reports them, so the live A/B can measure the rate.
- Tests: `consensus.test.ts` (clustering, quorum severity, hard kinds, medians, criteria, the ledger rules),
  `novel-ko.integration.test.ts` (two G22-2 patterns: a checker whose readings each quote a different paragraph, and one
  whose agreeing readings raise a new finding on unchanged text after a patch — both stop at `APPROVAL_BLOCKED` under
  `standard.v33` and are accepted under `standard.v34`, the second after exactly one three-reading confirmation),
  `policy.test.ts` (v34), `commands.test.ts`.
- Live A/B against `standard.v33` on the same seeds: **BLOCKED** in run 4 (no bridge or database).
