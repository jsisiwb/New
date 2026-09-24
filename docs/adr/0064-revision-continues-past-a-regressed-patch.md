# ADR-0064: A regressed patch is discarded and revision continues; revision rounds per language in the policy

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0014 (patch regression), ADR-0041 (pinned production policy), ADR-0056 (multi-round Korean
  revision), the Step 0 improvement audit (§7.3, §7.4)

## Context

A targeted patch must pass the ADR-0014 regression check before it can reach approval. When it failed, the
chapter stopped as `PATCH_REGRESSED` (`needs_attention`) even with revision rounds left, so an autopilot serial
waited for an operator over one bad patch whose parent version was still available (audit §7.3). The number of
rounds was also decided in code: English took one representative round and Korean up to `max_rounds`
(`language !== 'ko'`, audit §7.4). Working on this path also showed that a rejected Korean version could not be
quarantined at all: `quarantine_versions` kept the English-era language check (migration 0022).

## Decision

1. **`revision.on_regression`.** `stop` (the default when the knob is absent) keeps the ADR-0014 behaviour.
   `discard_and_continue` quarantines the patched version (`canon.quarantine_version`, reason
   `patch_regressed:r<round>`), returns the chapter to the version before the patch together with that
   version's scorecard, and lets the next round revise again within the round limit. The regression report is
   saved either way, the discard is a checkpointed step, and the result lists every discarded patch. A patch
   that regresses in the last round leaves the chapter on its previous version, which then faces the approval
   gate like any other.
2. **`revision.rounds_by_language`.** When present it sets the rounds for each manuscript language and replaces
   `max_rounds` for that language; when absent, English keeps one representative round and Korean up to
   `max_rounds`, byte-for-byte as before.
3. **`standard.v4`** is `standard.v3` plus `on_regression: discard_and_continue` and
   `rounds_by_language: { en: 1, ko: 3 }` (starting values: the same round counts as before, now in the policy).
4. **Migration 0022** gives `quarantine_versions` its own `language IN ('en', 'ko')` check.

## Alternatives considered

- **Retry the same span in the same round.** Rejected: the next round already picks the dimension with the most
  open issues from the restored scorecard, and a separate retry loop would bypass the round limit.
- **Keep the regressed version and patch on top of it.** Rejected: a version that failed its regression check
  must never become the parent of the version that reaches approval.

## Consequences

- One regressed patch no longer stops an autopilot serial; the operator sees the discarded patches and their
  regression reports in the result and the artifacts.
- Rejected Korean versions are quarantined, as the invariant requires.
- Not built in this change (audit §7): structural failures routed to scene regeneration (7.1), several
  non-overlapping patches per round (7.2), the reader panel (7.5), the polish pass (7.7), best-of-N openings
  and 절단 (7.8), deterministic length control (7.9) and the single-call benchmark (7.10). A deterministic
  paragraph trim was considered for 7.9 and rejected: it cannot tell which paragraph carries the 절단 or a
  setup, so length control needs a reviser version with paragraph-scoped instructions.
