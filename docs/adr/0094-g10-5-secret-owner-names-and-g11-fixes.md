# ADR-0094: Secret owners named in the canon lines (G10-5), arc-plan stances normalized (G11-1), `standard.v22`

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
- **G11-1.** G11a (`standard@21`) failed before any chapter work: the arc planner wrote `to_stance: "believes"` in three
  planned knowledge changes; the arc-plan schema knows seven stances (`knows`, `suspects`, `believes_false`, `pretends`,
  `unaware`, `forgot`, `doubts`), the chapter contract's normalizer maps free stances but the arc plan had none, and the run
  failed `ARC_PLAN_INVALID`. A resume would replay the recorded answer and fail again.

## Decision

1. **`context.secret_names`.** The canon lines name a secret's owners and knowers from the registry whatever the chapter's
   cast (one registry read for the ids the lines need). Absent or false: names only for the cast, as before.

2. **`planning.normalize_arc_knowledge` (G11-1).** An arc plan's planned knowledge changes keep only the fields and stances
   the schema knows: an exact stance stays, a planner's alias becomes its nearest stance (`believes` → `suspects`, a
   belief short of knowledge; `misbelieves` → `believes_false`), and a change with an unreadable stance, knower or
   proposition is dropped (`normalizeArcKnowledge`). The planned changes guide chapter contracts; none is canon.

`standard.v22` = `standard.v21` + both knobs. No gate moves.

## Alternatives considered

- **Drop owners outside the cast from the line.** Rejected: who holds a secret is what the knowledge checker needs.
- **Fix it in the `canon_lines` knob.** Rejected: `standard@20` and `@21` pin those bytes.
- **Retry the arc planner on a schema failure.** Rejected as the only answer: the next answer can fail the same way, and
  a stance the planner meant is recoverable from its own word.

## Consequences

- No call; the pack for a chapter with many off-page secret owners grows by their names.
- Tests: `story-plan.test.ts` (`normalizeArcKnowledge`), `policy.test.ts` (v22 = v21 + the knobs),
  `novel-ko.integration.test.ts` (a simulated v22 run: every secret's owner named in the canon lines).
