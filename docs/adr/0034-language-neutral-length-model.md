# ADR-0034: Language-neutral length model; words are the author-facing unit for English

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** principal architects (product, software, AI systems, data, Korean webnovel production)

## Context
The first plan measured chapters in Korean characters (공백 포함), the norm on Korean platforms. English
manuscripts need a different author-facing unit, and mechanically converting Korean character counts to
English words is unreliable.

## Decision
Every manuscript version records a **length model**: words, Unicode code points, paragraphs, sentences,
estimated tokens (with model id), estimated reading time. Author-facing targets and tolerances for
English are in **words** (default 2,500 ± 12%). No fixed conversion from Korean characters is assumed;
**calibration is an implementation requirement**: the studio records, per project and per genre, how
word counts relate to reading time and to the episode "feel" the tradition profile targets, and adjusts
defaults from accepted-chapter statistics and reviewer feedback. Cost is reported per accepted chapter and
per 1,000 accepted words.

## Consequences
Supersedes the counting part of ADR-0024. Schemas use `lengthTarget`/`lengthModel`; UI shows words with
secondary counts; the structure profile's rhythm rules are expressed in words for English rendering.

> **Amended by ADR-0054 (2026-09-22):** for Korean (`ko`) manuscripts the author-facing unit is
> **characters** — Unicode code points excluding line breaks, spaces included (공백 포함) — with default
> 5,500 ± 12% per chapter. `lengthTarget.unit` is `words` for `en` and `characters` for `ko`; the
> deterministic length gate measures the unit the contract names. The model itself stays language-neutral.
