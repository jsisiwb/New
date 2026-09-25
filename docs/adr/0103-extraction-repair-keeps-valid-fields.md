# ADR-0103: A field an extractor repair broke is taken back from the answer it repaired

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (the canon-delta verifier), ADR-0057 (output normalizers), ADR-0102 (the extractor's repair),
  `docs/08-delivery/13-live-run-gemini.md` §15.

## Context

G17a's extraction under ADR-0102 used both repairs. The first repair fixed five of seven items. The second fixed the
other two, so every item validated, but it also wrote `hypothesis_results` as `{hypothesis_id, status, note,
evidence_quotes}`. The schema asks for `{hypothesis_ref, result, evidence?, note?}`, and both earlier answers had an
empty list there (G17-3). The envelope failed on that field alone and the extraction was rejected. A resume replays
the three recorded answers, so the chapter could not be accepted without a code change, even though it was approved and
polished and every item was valid. Nothing asked the second repair to change `hypothesis_results`: its note named only
item errors and item payload shapes.

## Decision

1. **A repair may not break what already validated.** After each repair, every top-level field that fails in the
   repaired answer and had no error in the answer it repaired is taken from that answer. If that answer did not have
   the field, the field is left out. The item list counts as one field. The envelope fields the workflow fills are
   never considered. The merged answer is validated like any other and counted as `extraction_field_restore`.
2. **The note names top-level shapes.** When errors name top-level fields, the repair note renders their shapes from
   `canon-delta.schema.json`, string length bounds included, after the item shapes. It also asks the extractor to leave
   every field without errors as it was.

Like ADR-0102's repair, this applies to every project without a policy version. It only turns a rejection into a
valid delta, and every part of that delta comes from an answer the extractor gave for the same approved version.
Items taken back were already anchored and envelope-checked. The verifier still runs on the merged delta. Evidence,
frame, clock and approval-lock checks are unchanged. In G17a, the resumed extraction replays the three recorded answers
and takes back the second answer's empty `hypothesis_results`, with no new call.

## Alternatives considered

- **Normalize the invented shape** (`hypothesis_id` → `hypothesis_ref`, `confirmed` → `realized`). Rejected: a
  mapping per invented shape is the drift-chasing ADR-0102 declined, and a hypothesis's `result` is a claim only the
  extractor makes.
- **Drop an invalid optional field.** Rejected: that would also drop a field no answer ever got right. Restoring takes
  back only what validated.
- **Merge items one by one.** Rejected: each answer lists its items anew, merged, split or reordered, so items have no
  identity across answers. The list is taken whole.
- **Make a resume re-ask the extractor after a rejection** (fresh activity ids). Deferred: it spends calls on every
  resume and needs the step's attempt in the idempotency keys. A rejected extraction still replays its answers on
  resume, and this remains open.

## Consequences

- A repair that breaks a field valid before it no longer costs the chapter; G17a's chapter is accepted on resume
  without new calls.
- Tests: `extraction-repair.test.ts` covers the fields errors name, a regressed field taken back, the item list as one
  field, nothing restored that was already broken, a broken field the repair added left out, and top-level shapes in
  the note. `novel-ko.integration.test.ts` has a simulated `standard@28` run whose repair fixes the items and breaks
  `hypothesis_results`; it is accepted after one repair, and it fails without change 1. `normalizers.test.ts` covers
  the new counter.
