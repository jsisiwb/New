# ADR-0107: A resume after a rejected extraction asks the extractor again

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (the canon-delta verifier), ADR-0053 (deployment-safe resume), ADR-0102 (the extractor's
  repair), ADR-0103 (fields a repair broke; this item was deferred there).

## Context

The extraction step asks the extractor once and repairs its answer at most twice (ADR-0102, ADR-0103). When all three
answers fail the canon-delta schema, the step fails with `EXTRACTION_REJECTED` and recommends `regenerate`. Every model
call is keyed by its activity (`extract:<n>`, `extract:<n>:repair`, `extract:<n>:repair2`), so a resume replays the
three recorded answers and fails the same way. The chapter is approved and polished, and cannot reach canon without a
code change. ADR-0103 deferred this because the activity ids carried no attempt number.

## Decision

1. **A rejection is recorded.** Before the step fails with `EXTRACTION_REJECTED`, it writes an append-only
   `extraction_rejection` artifact for the version (its attempt number and the first 40 schema errors).
2. **The next attempt is keyed apart.** The step counts the version's recorded rejections; after `k` of them its
   activity ids are `extract:<n>:retry<k>`, `…:retry<k>:repair` and `…:retry<k>:repair2`. A resume therefore asks the
   extractor again (and repairs as before), while every call before the rejection, and a first attempt with no
   rejection recorded, replays as it did.

Like ADR-0102 … ADR-0105, this applies to every project without a policy version: it turns a stop no project could pass
into another attempt of the same step on the same approval-locked version. Evidence anchoring, the envelope checks, the
verifier and the approval lock are unchanged, and pinned policies and prompts are untouched. A step that fails for any
other reason (a bridge outage mid-repair) records no rejection and replays its recorded answers on resume.

## Alternatives considered

- **Key every attempt by the step's attempt counter.** Rejected: a resume after a bridge failure would then re-ask
  answers that were already recorded and valid.
- **Retry inside the step.** Rejected: the step already bounds its calls (one answer, two repairs); further attempts
  are an operator's or the unattended runner's decision to resume.

## Consequences

- A rejected extraction costs one resume and three calls at most, not the chapter.
- Tests: `novel-ko.integration.test.ts` (a simulated run whose first extraction and both repairs are rejected; the
  resume asks `extract:1:retry1` and the chapter is accepted; without the change the resume replays the rejection).
