# ADR-0094: Secret owners named in the canon lines (G10-5), and the G11 fixes

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0092 (the schedule in the canon lines), ADR-0093 (`standard.v21`), `docs/08-delivery/13-live-run-gemini.md`
  §10 (G10).

## Context

- **G10-5.** Since ADR-0092 every Korean pack's canon lines carry each secret's owners, knowers and dates. The owner of
  a secret who is not in the chapter's cast is not in the pack's name registry, so the line reads `소유자: <uuid>` — hex
  letters in a Korean prompt, and a name the writer and the checkers cannot use. In G10a's writer pack six of eight
  secret lines named their owner by id.

## Decision

1. **`context.secret_names`.** The canon lines name a secret's owners and knowers from the registry whatever the chapter's
   cast (one registry read for the ids the lines need). Absent or false: names only for the cast, as before.

The knob joins the next policy together with the fixes the `standard@21` checkpoint (G11) calls for.

## Alternatives considered

- **Drop owners outside the cast from the line.** Rejected: who holds a secret is what the knowledge checker needs.
- **Fix it in the `canon_lines` knob.** Rejected: `standard@20` and `@21` pin those bytes.

## Consequences

- No call; the pack for a chapter with many off-page secret owners grows by their names.
