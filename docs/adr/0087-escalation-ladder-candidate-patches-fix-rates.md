# ADR-0087: The escalation ladder — candidate patches chosen by local checks, a scene rewrite for what patches rarely fix, per-kind fix rates, `standard.v16`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (patch-first revision), ADR-0077 (multi-patch rounds), ADR-0084 (convergence),
  ADR-0086 (`standard.v15`), `docs/08-delivery/13-live-run-gemini.md`.

## Context

Revision has one tool: a patch over a window of text. `quality:fix-rates` (new, read-only) aggregates every patched
round the permanent database holds — the regression report names the findings a round targeted and which of them it
resolved, the parent's scorecard names their kinds. Over the six live projects before this ADR (G1, G3b, G4r, G4a,
G5r, G5a: 18 patched rounds, 2 kept):

| dimension | kind | targeted | resolved | fix rate |
| --- | --- | --- | --- | --- |
| prose | paragraph_length | 16 | 16 | 100 % |
| structure | weak_pacing | 9 | 3 | 33 % |
| structure | excessive_exposition | 6 | 1 | 17 % |
| prose | weak_pacing | 6 | 3 | 50 % |
| prose | translation_like_english | 4 | 4 | 100 % |
| prose | literary_drift | 3 | 3 | 100 % |
| continuity | location_error | 3 | 3 | 100 % |
| structure | payoff_without_setup | 3 | 3 | 100 % |
| continuity | power_rule_violation | 3 | 2 | 67 % |
| continuity | timeline_error | 3 | 2 | 67 % |
| structure | weak_ending | 3 | 3 | 100 % |
| prose | western_novel_drift | 3 | 1 | 33 % |

Sentence-level kinds are repaired by patches; kinds that describe a whole scene — too little talk, exposition
blocks, a Western-novel register — are not, because a window patch cannot add an exchange or restructure a scene. A
patch can also bring a new 번역투 or stock phrase into its own span, which only a judge notices afterwards.

## Decision

`standard.v16` = `standard.v15` + the two knobs below. No gate threshold moves.

1. **Candidate patches (`revision.candidates_per_cluster` 2).** Each cluster of a multi-patch round gets up to two
   patches; the one that brings fewer new lint pattern hits (번역투 markers, AI stock phrases, calques — every lint
   finding that quotes a span, measured with the project's language layer) into its span is kept, the first on a tie
   and the second only when the first brought a hit. Local and deterministic: no judge call.
2. **The scene-rewrite rung (`revision.ladder.scene_rewrite_kinds`: weak_pacing, excessive_exposition,
   western_novel_drift — the kinds at or below 33 % in the table).** A round whose open blocking/major findings
   include one of these kinds drafts again the scene holding most of their spans — for findings that quote nothing,
   the scene furthest below its planned talk share — from its scene plan, with the findings and the measured talk
   share in the writer's plan, countable talk targets and, for the last scene, the cut. The new scene replaces the
   old one in the current version (scenes are located by their first lines, searched in order), and the result is
   evaluated and regression-checked like a patch of scope `scene`. At most `revision.max_scene_rewrites` (starting value, `standard.v1`) per chapter; other kinds stay on
   the patch rung.
3. **The table is a standing report.** `pnpm cli quality:fix-rates [--projects=…] [--json]`; a later policy moves a
   kind between rungs only with the table's evidence.

## Alternatives considered

- **Chapter regeneration as a rung.** Deferred: a full redraft costs a chapter's drafting and evaluation again, and
  no live run has yet shown a chapter whose findings a scene rewrite could not reach. The ladder can grow a rung when
  one does.
- **Three candidates per cluster.** Rejected for now: the reviser's calls are cheap, but the table shows prose kinds
  already resolved at 100 %; the second candidate exists to avoid new pattern hits, which one retry covers.
- **Moving continuity kinds to a rewrite.** Rejected: 67–100 % patch fix rates.

## Consequences

- A round targeting a structural kind costs one scene draft instead of one to four patches, and re-runs the
  continuity and knowledge checkers (scope `scene`).
- Counters `patch_candidates` and `scene_rewrite` record how often each path ran.
- Tests: `policy.test.ts` (v16 = v15 + the ladder), `novel-ko.integration.test.ts` (a quote-less pacing major on the
  first scorecard is answered by exactly one scene rewrite, which is kept and approved), `normalizers.test.ts`.
