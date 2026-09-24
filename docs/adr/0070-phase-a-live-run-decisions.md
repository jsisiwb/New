# ADR-0070: Phase A live-run decisions — the Notion client deadline, the default policy, lint thresholds

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** product owner
- **Relates to:** ADR-0029 (calibration), ADR-0041 (pinned Production Policy), ADR-0056 §14 (the Notion
  adapter's deadline), ADR-0060, ADR-0063, ADR-0064, ADR-0068 (standard.v2–v5), ADR-0062 and ADR-0065 (Korean
  lint layers), ADR-0067 (run report and re-lint), `docs/08-delivery/12-live-run-ws1-7.md`

## Context

The Phase A run (`12-live-run-ws1-7.md`) was the first live Korean run after Workstreams 1–5. Three
questions were to be answered with its evidence: how the Notion bridge must be configured for a long run,
whether new projects should default to a newer standard policy (A4), and whether the Korean lint thresholds
added as starting values (`KO-END-02`, `KO-NAME-01`/`KO-NAME-02`, ADR-0062/0065) should move (A5).

## Decision

1. **The Notion client deadline stays at the adapter default.** `YEONJAE_NOTION_TIMEOUT_MS` is left empty
   (1,260 s = two bridge attempts of 600 s + 60 s, ADR-0056 §14); `.env.example` says so. Live evidence:
   with a 600 s deadline every call the first workspace had not finished was aborted exactly when the
   bridge moved it to the second workspace (concept 2 lost all three routes); with the default the same
   request succeeded on its first route in 439 s.
2. **A4 — the default policy does not change yet.** New projects keep `policy/standard@1` unless the
   operator pins another with `project:create --policy`. The run produced no live chapter, so there is no
   live evidence about evaluation v2 or the later opt-ins on Korean prose; the simulated evidence (every
   Korean run on `standard.v2`–`v5` accepted, 0 Latin-script leaks) says they work, not that they help. The
   default moves when a live Korean chapter is accepted under the candidate policy (`standard.v5`, which
   carries every opt-in) without an attention stop, and the run report (ADR-0067) shows its gates and lint
   findings.
3. **A5 — the Korean lint thresholds do not move yet.** `KO-END-02`, `KO-NAME-01` and `KO-NAME-02` keep their
   starting values. Calibration reads accepted live chapters with `quality:lint-ko` under `lang/ko@4` and
   `lang/ko@5` beside the prose judge's sub-scores; moved thresholds ship as a new language layer, never as
   an edit of a pinned one.
4. **A novel start fails its run when its plan context cannot be built.** `startNovel` builds the context
   inside the handler that fails the run, so an unknown pinned policy or a stale policy hash leaves the run
   `failed` with the error, not `suggesting` with nothing running (live finding §3.3).

## Alternatives considered

- **Defaulting new Korean projects to `standard.v5` now.** Rejected: it would change what every new Korean
  project is gated by on simulated evidence alone.
- **Clamping a short Notion deadline in code.** Rejected: the variable is explicit operator configuration;
  documenting the failover arithmetic keeps the operator in control.

## Consequences

- A long Notion run is configured by leaving the deadline unset; a shorter one is an operator error the
  documentation names.
- A4 and A5 remain open with their evidence criteria written down; the live run's record says where it
  stopped and why.
