# ADR-0055: A Korean project's whole prompt surface is Korean

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** product owner
- **Relates to:** ADR-0027 (Narrative Identity Guard), ADR-0033 (Active Constraint Set), ADR-0053, ADR-0054,
  docs/02-narrative-identity/01-narrative-identity-architecture.md, docs/05-generation/03-prompt-architecture.md

## Context

ADR-0054 made Korean a per-project manuscript language and authored Korean prompt families (v2.x). A review
of what a Korean project's model calls actually contain showed that most of the text the model reads was
still English, and some of it actively contradicted a Korean manuscript:

- the Narrative Identity Block was compiled in English (`## Output-Language Contract (English)`, "Use these
  English terms", "never native-script names in prose", "Any other romanized or non-English token is an
  error"), and the Korean project composed from English-authored tradition and genre layers (English status
  window grammar, "Senior"/"Professor" address terms, `sir/ma’am` register rules, romanization policy);
- context packs rendered section titles, the Chapter Contract, knowledge, relationship, promise and canon
  lines in English; planner briefs (season, arc brief, cast brief, bible summary, blueprint) were English;
- the Active Constraint Set required an English paraphrase (`text_en`) for every non-English requirement,
  which the Korean requirement interpreter never produces, so the first Korean chapter contract failed with
  `CONSTRAINT_UNRENDERABLE`;
- the v2.x templates kept English structural labels (`[CHAPTER CONTRACT]`) and two single-brace
  placeholders (`{length_target_words}`) that reached the model as literal text.

Mixed-language instructions pull the model toward translated and Western-novel diction — the failure the
product owner reported.

## Decision

1. **Language-aware identity compilation.** `compileBlock` renders the entire block in Korean when the
   composed identity's output language is `ko` (headers, every section, rubrics, identity tail). The English
   rendering stays byte-stable.
2. **Korean-authored global layers.** `lang/ko@2`, `tradition/kr-webnovel@2` and `genre/*@2` are authored in
   Korean (Korean contract text, Korean status-window grammar, 호칭 and speech levels instead of English
   address terms). A Korean intake composes from these layers; English projects keep `@1`. Korean project
   layers drop romanization and English register rules and infer a secondary-world setting for fantasy
   genres.
3. **Language-aware context packs.** Pack section titles, the Chapter Contract rendering and canon,
   knowledge, relationship, promise, previous-chapter and guard lines render in Korean for Korean packs.
   Provenance tags (`[FACT]`, `[PLANNED]` …), ids and schema enum values stay as identifiers.
4. **The Active Constraint Set uses the project's working language.** A Korean project renders Korean
   requirements verbatim with Korean headings; an English project still fails closed on a non-English
   requirement without `text_en`. Every compile site passes the same working language, so the contract's
   ACS hash and the pack's ACS hash agree.
5. **Fully Korean prompt families (v3.0.0).** All 25 families get a Korean-only version (instructions,
   labels, output-shape notes). JSON keys and enum values remain schema identifiers. The generator is
   `tools/seed-prompt-families-ko-v3.py` with one module per immutable version under `tools/ko_prompts/`.
6. **Guards accept both languages.** The gateway Guard and pack validation accept the Korean contract
   section headings; both contracts remain mandatory and hash-pinned.

## Alternatives considered

- Translate the English profiles mechanically — rejected: AGENTS.md rule 4 forbids machine-translated profile
  rules; the Korean layers are authored as Korean craft text, and English-only policies are dropped rather
  than translated.
- Keep English section labels as "structural anchors" — rejected: only the simulated test model parsed them;
  it now accepts both languages.
- Remove the `text_en` requirement globally — rejected: an English project must still fail closed on a
  requirement it cannot render in its working language.

## Consequences

- New profile versions; the prompt registry gains 25 versions and the active set moves to v3.0.0; older
  versions stay registered for pinned jobs (ADR-0053).
- `story-intake.target_words_per_chapter` is required only for English projects.
- Tests: Korean identity blocks contain no English instructions; v3 prompts contain no English labels or
  single-brace placeholders; a Korean simulated novel run plans, drafts, evaluates and accepts two chapters.
