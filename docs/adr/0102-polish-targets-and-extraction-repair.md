# ADR-0102: The polish round's targets and one repair of the extractor's answer

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (the canon-delta verifier), ADR-0057 (output normalizers), ADR-0073 (the polish round),
  ADR-0098 (the polish round's round limit), `docs/08-delivery/13-live-run-gemini.md` §15.

## Context

G17a (`standard@28`) was the first live chapter to pass its confirmation (overall 89, 0 blocking / 0 majors). The two steps
that follow had never run on live output.

- **G17-1: the polish round could not run on a passing chapter.** ADR-0073's polish round gives the reviser the lint's
  findings "of any severity". A chapter that passes its gates has no major left, so those findings are minor or notes.
  The reviser targets only blocking and major findings unless a finding is named as an extra target, so it found no
  target and stopped the run with `INTERNAL`. Every Korean chapter reaching this point would have stopped the same way.
- **G17-2: the first live extraction failed the canon-delta schema.** The extractor wrote event participants as bare ids
  (the schema wants `{entity_id, role}`), a relationship type outside its enum (`hostility`), a promise event with
  `kind: foreshadowing`, and a fact whose value was folded into its attribute. The verifier rejected it
  (`EXTRACTION_REJECTED`), correctly, and a resume replays the recorded answer. The prompt lists each type's required
  fields but not their shapes. Its union error listed every branch's complaint about the first item only.

## Decision

1. **The polish round names its targets.** The polish call passes the lint findings as the reviser's extra targets. The
   polished version is still kept only when it passes and the lint finds fewer (ADR-0073).
2. **At most two repairs of an extractor answer that fails the schema.** When the extraction envelope does not validate,
   the extractor is asked again (activities `extract:<n>:repair`, then `extract:<n>:repair2`; counted as
   `extraction_repair`). The request carries the
   envelope's top-level errors, each item's own errors (its payload validated against its type's branch of the union,
   `extractionItemErrors`), and the payload shapes of the types it used, rendered from the schemas with their enums, patterns and bounds
   (`proposalShapes`).
   The repaired answer is anchored, envelope-checked and validated exactly like the first; if the second repair still fails, the
   extraction is rejected as before.

The repair count is two, the same bound the gateway uses when it repairs a schema-invalid answer. It is fixed in code
because it is a recovery path, not a tuning knob. In G17a the first repair fixed five of seven items (participants,
kinds, the fact's attribute), and two errors remained: a relationship axis of 8 against a maximum of 5, and a promise
event still using `op: assert`. Both changes apply to every project, because each turns a stop that no project could get past
into the designed behaviour. Evidence, frame, clock and approval-lock checks are unchanged.

## Alternatives considered

- **Normalize the extractor's shapes in code.** Rejected: a participant's role and a fact's value are claims about the
  text that only the extractor can make.
- **Put the canon-delta union in the extractor's output schema so the gateway repairs.** Rejected here: the envelope's
  version ids are filled by code after the call, and the output shape is rendered into every project's prompt.

## Consequences

- A chapter that passes its gates can be polished, extracted and committed.
- Tests: `novel-ko.integration.test.ts` (two simulated `standard@28` runs to acceptance: one through the polish round,
  which fails without change 1; one whose first extraction has bare-id participants and is repaired),
  `extraction-repair.test.ts` (per-item errors; shapes rendered from the schemas, bounds included), `normalizers.test.ts`.
