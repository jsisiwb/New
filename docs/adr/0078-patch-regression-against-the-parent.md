# ADR-0078: Patch regression protections measured against the parent (`standard.v11`)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0014 (patch regression), ADR-0064 (discard and continue), ADR-0077 (multi-patch
  rounds, `standard.v10`), `docs/08-delivery/12-live-run-ws1-7.md` §8.3.

## Context

No live Korean chapter has kept a single patch. The regression reports explain why:

| Run | Rounds | Failing protections on every round |
| --- | --- | --- |
| Phase A, `standard.v6` | 3 | contract, continuity, knowledge (+ prose / westernization) |
| `standard.v8` | 3 | continuity |
| `standard.v10` | 3 | continuity, knowledge, voice, translation-like, register |

On `standard.v10` rounds 2 and 3 the report's only failure was `protection_failed`. The patch had introduced
no new blocking or major issue kind, and no gated dimension had fallen. It was quarantined because
continuity, knowledge and voice **already failed on the parent**. The translation-like and register guards
fired on majors the parent **already carried**, in paragraphs the patch never touched.
`patchRegression` read every protection on the revised scorecard alone: a protected section had to pass,
and a guarded kind had to be absent, whatever the parent was.

A round targets one dimension, and a live first draft fails several. Measured absolutely, no single round
can pass, so the revision loop can never make progress. The approval gate already demands that the accepted
version pass every gate. The regression check's job is narrower: to stop a patch from making things worse.

## Decision

1. **`revision.regression_baseline: absolute | parent`.** Under `parent`:
   - a protected section (output language, contract, continuity, knowledge, genre, voice, prose,
     structure) fails only when it **passed on the parent and fails on the revision**; the outcome records
     that the section failed on the parent too;
   - the westernization, translation-like and register guards fail only when the revision carries **more**
     open blocking/major issues of those kinds than the parent.
2. **Unchanged under both baselines:**
   - the targeted issues must resolve, or the targeted score must rise;
   - the targeted dimension must not worsen;
   - no non-targeted gated dimension may fall beyond the tolerance;
   - no gated dimension may be missing or dropped;
   - no new blocking/major issue kind may appear.
3. **`standard.v11`** = `standard.v10` + `regression_baseline: parent`. `absolute` is the behaviour of every
   earlier policy, which replays byte-identically.

## Alternatives considered

- **Drop the section protections.** Rejected: a patch that breaks a passing section must still fail.
- **Keep absolute protections and target every failing dimension in one round.** Rejected: that is the
  union-span scene rewrite ADR-0077 removes.

## Consequences

- A round that fixes its target and breaks nothing is kept, and the next round starts from it.
  Accumulated rounds can reach the approval gate, which is unchanged.
- A count-based kind guard can let a patch trade one translation-like major for another in a different
  place. The targeted-dimension checks and the approval gate still see both.
- Evidence: `comparison.test.ts`:
  - the live defect: the same patch fails under `absolute` and passes under `parent`;
  - a pass-to-fail section still fails;
  - an extra major of an existing guarded kind still fails.

  Also `policy.test.ts` (v11 = v10 + the field) and the live `standard.v11` run in §8.
