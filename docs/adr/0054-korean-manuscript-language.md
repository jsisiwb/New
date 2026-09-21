# ADR-0054: Korean is the manuscript language; English rendering is a later translation step

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** product owner
- **Relates to:** ADR-0026 (superseded in its manuscript-language clause), ADR-0027, ADR-0034,
  docs/02-narrative-identity/, docs/05-generation/

## Context

The plan said English manuscripts in the Korean-webnovel tradition (ADR-0026). Live generation
repeatedly produced prose that reads as Western-novel or translation-like instead of natural Korean
webnovel prose — the failure mode ADR-0026 was designed to avoid, but now in the opposite direction:
the market the product serves is Korean serialized web fiction, and readers expect Korean prose written
the way Korean webnovelists write it. The product owner has decided that the pipeline must compose
reader-facing prose **directly in Korean** with the same serialized craft (episode emotion curve,
사이다/고구마 rhythm, cliffhanger placement, mobile-readable paragraphs), and that English is produced
**later, as an explicit translation step** for export — never as the primary composition language.

This supersedes the manuscript-language clause of ADR-0026 ("English is the required output language",
"no translation path exists"). The Narrative-Tradition Contract (`tradition/kr-webnovel`) is unchanged;
the Output-Language Contract becomes Korean.

## Decision

1. **Manuscript composition language is Korean (`ko`).** Every manuscript-producing role composes in
   natural, idiomatic Korean under both the (updated) Korean Output-Language Contract and the
   Korean-webnovel Narrative-Tradition Contract. The deterministic post-call output-language check
   gates Korean manuscript output.
2. **Prompts are authored in Korean.** All prompt families (system and user templates) are written in
   Korean so the model operates in the language and craft it must produce; Korean is the working
   language of style-sensitive roles. Planning/analytic roles keep their JSON envelopes (schemas are
   language-neutral); instruction text is Korean.
3. **English becomes an explicit export/translation step**, run as a separate later surface (manuscript
   export), never inside the generation loop. No generation role writes English as a substitute.
4. **Profiles and contracts are data.** A `lang/ko@v1` Output-Language profile holds the Korean
   contract text, Korean-focused translation markers, and Korean prose rubric anchors. The identity
   compiler accepts `ko`; composition still fails closed without both contracts.
5. **Storage follows the manuscript.** Manuscript rows carry `language='ko'`; DB CHECKs that pinned
   `'en'` are relaxed by migration. Length targets use Korean character counts (ADR-0034 stays
   language-neutral: targets are characters for `ko`).
6. **No invariant weakened beyond the language clause.** Canon, evidence, atomic commits, prompt
   versioning, context-pack snapshots, gates and quarantine rules are untouched. Old English
   prompt versions remain in the registry for pinned jobs (ADR-0053); new Korean versions are added as
   new immutable versions and become the active set.

## Alternatives considered

- Keep English composition and add a Korean "style" instruction — rejected: the observed failure mode
  is exactly that this does not produce natural Korean webnovel prose.
- Compose in Korean then machine-translate inside the loop — rejected: generation must stay
  single-language; translation belongs to the explicit export step where a human can verify it.
- Only convert style-sensitive prompts and leave analytic prompts in English — rejected: the product
  owner asked for all prompts; mixed-language instruction invites mixed-language behavior.

## Consequences

- New `lang/ko@v1` profile; narrative identity compiler accepts `ko`; prose output-language check gains
  a Korean path; migration 0020 relaxes the manuscript-language CHECK; new Korean prompt versions for
  every family become the active set.
- Traceability rows for OUTPUT-EN-001 / NO-TRANSLATION-001 are updated in the same change; README,
  AGENTS.md governing principle, handoff-guide invariants, narrative-identity and prompt-architecture
  docs are updated.
- The English export step is a follow-up surface; chapter production, canon, quality gates and
  evaluation remain unchanged in structure, with judges scoring Korean prose.
