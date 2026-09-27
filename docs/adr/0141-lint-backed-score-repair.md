# ADR-0141: Repair the lint findings that contribute to a failing prose score

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request for permanent prose and repetition improvements
- **Relates to:** ADR-0086, ADR-0118, ADR-0140

## Context

A live chapter repeatedly failed prose scoring because its lint composite remained low, while score-only repairs targeted a few model-selected metaphors. The deterministic pronoun findings that contributed to the score were absent from those repair targets. A major model finding also suppressed score targets for the whole dimension, even when separate lint findings still contributed to its failing score.

## Decision

Under the existing `revision.convergence.score_targets` capability, include open advisory lint findings from a failed dimension when that dimension's recorded lint composite is below its pinned acceptance threshold. Include only findings anchored to the current manuscript version and exact quoted text. Keep their original identities, severities and sources; they are repair targets, not newly promoted approval blockers.

The existing judge weakest-passage fallback remains available when the dimension has no open major or blocking finding. A major model finding does not suppress independently grounded lint targets. Passing dimensions and dimensions without a failing lint composite retain their previous behavior.

Use the existing patch clustering, priority, limits and regression checks. Do not add rounds, relax thresholds, change accepted history or run the optional post-acceptance polish early.

## Consequences

Bounded repair can address the evidence behind the computed score instead of repeatedly rephrasing unrelated weak passages. It may still require several rounds and cannot establish literary quality. Tests cover revision target and clustering inputs, stale or invalid evidence, major findings, and preservation of the judge-only fallback.
