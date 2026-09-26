# ADR-0108: G14a, G14r, G17a, G18r and G19r stay as the record of their policies; no override, no regeneration

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run under the operator's rule 8: decide from the repository's evidence and record
  the reasoning; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0042 (the override matrix), ADR-0053 (a pinned project is not re-pinned), ADR-0098 (granted
  rounds), ADR-0100 (major agreement), ADR-0106 (checker agreement), `docs/08-delivery/13-live-run-gemini.md` §13, §16.

## Context

Five chapter runs are stopped at the grant cap, with every gate passing and only reviewer-class findings, or one
continuity finding, left:

| Project | Policy | Where it stopped |
| --- | --- | --- |
| G14a (academy) | `standard@24` | v10 at 0 blocking / 2 majors (taste judges) after r9 was approved at 0 / 0; ten rounds in all |
| G14r (regression) | `standard@24` | 0 / 3 (taste judges); ten rounds in all |
| G18r (regression) | `standard@28` | v11 at 1 blocking (continuity `world_rule_violation`); v9 was approved at 0 / 0, its confirmation found a `canon_contradiction` major |
| G19r (regression) | `standard@28` | v10 at 1 blocking / 1 major, both continuity `inventory_impossible`; ten rounds in all |
| G17a (academy) chapter 2 | `standard@28` | chapter 1 accepted; chapter 2's v11 approved at 0 / 0, then the confirmation's single readings raised 4 majors (continuity `character_inconsistency`, two genre, one repetition); ten rounds in all |

Run 2 left G14a and G14r to the operator. The operator's rule 8 asks this run to decide, preferring root causes over
overrides.

## Decision

**None of the five chapters is overridden or regenerated. They stay as the recorded outcome of their policies.**

1. **No override.** An override (ADR-0042) is a reviewer's judgement that a finding stands but may be accepted. For
   G14a and G14r the question was never that: their remaining majors are single readings of taste judges, the class
   ADR-0100 showed one reading cannot establish. Overriding them would put a person's signature on a measurement
   problem, and `standard@24` has no second reading to settle it. G17a's chapter 2 is the same case for its confirmation's single readings (G19-2), which ADR-0106 settles by a second
   reading in `standard@29` and `standard@28` cannot. For G18r and G19r the remaining findings are real
   slips (`13-live-run-gemini.md` §16): accepting them would put a known contradiction into canon, and G18r's
   `canon_contradiction` is outside the reviewer class altogether.
2. **No regeneration on the old pins.** A project keeps its policy for life (ADR-0053). Regenerating chapter 1 of G14a
   or G14r would run `standard@24` again without ADR-0097 … ADR-0107; regenerating G18r or G19r would meet G19-1 and
   G19-2 again. The root causes are fixed in newer policies, so the evidence that matters comes from fresh projects on
   them.
3. **Where the lines continue.** Both lines continue on fresh `standard@29` projects from chapter 1: G20a (academy, the
   same intake as G17a) and G20r (regression, the same intake as G18r and G19r). G17a keeps its accepted chapter 1. The five projects are
   neither cancelled nor changed: their runs stay `needs_attention`, so an operator can still grant, override or
   regenerate later with full history.

## Alternatives considered

- **Override the reviewer-class findings with a recorded reason.** Rejected for the reasons in 1.
- **Regenerate chapter 1 on the pinned policy.** Rejected for the reasons in 2.
- **Re-pin the projects to `standard@29`.** Rejected: ADR-0053 forbids it, since it mixes production inputs and voids the
  replay guarantee.
- **Cancel the runs.** Rejected: nothing is gained, and a cancelled run cannot be granted or overridden later.

## Consequences

- The five projects remain the measured baseline of `standard@24` and `standard@28` at their grant caps.
- Acceptance evidence for the fixes comes from new projects (`13-live-run-gemini.md` §17 onward).
- No operator action is required for these projects; the operator may still decide otherwise with the run intact.
