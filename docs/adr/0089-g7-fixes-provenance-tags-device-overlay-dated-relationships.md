# ADR-0089: The G7 fixes — design answers lose copied provenance tags, the 회빙환 overlay speaks the premise device, relationships are dated, `lang/ko@8`, `standard.v18`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0055 (provenance tags stay identifiers), ADR-0073 (opt-in layers), ADR-0084 (the device
  lexicon), ADR-0086 (time frames), ADR-0088 (`standard.v17`), `docs/08-delivery/13-live-run-gemini.md` §7 (G7),
  `docs/10-corpus/voice-calibration.md` §4 (C7).

## Context

The `standard@17` checkpoint (G7) ran both projects to rest without an accepted chapter. Each chapter passed all four
dimension gates in at least one round (academy r1; regression r1, r2, r4, r5); what remained were blocking and major
findings, and the last one in each chapter was the same defect:

- **G7-3 (both chapters, the final blocker):** a cast register describes the settled relationship — the academy
  heroine calls the hero `사부님` once she has seen his strike, the regression thug calls the hero `형님` once he has
  been beaten — but the bible seeds every register as canon from before 화 1. Both relationships form in 화 1. The
  continuity checker demanded the settled register from the first line (the academy r1's only blocking finding; the
  regression r4's two majors and r5's only blocking finding, with r5 at 0 majors). The reviser complied, and the genre
  and voice judges then raised blocking findings for a heroine calling the hero `사부님` before she has seen anything
  (academy r2–r5, every round quarantined).
- **G7-2 (regression r0: one blocking and two `KO-DEVICE-01` majors):** the writer's pack carried `원작` 63 times. The
  intake maps regression, reincarnation and possession to one 회빙환 overlay, and `genre/regression@3` is worded for
  novel possession (`장르 용어: 빙의, 원작, 원작 주인공 …`, `‘원작에서는 여기서 죽었다.’`, a device that quotes a line of
  the 원작, a novel-possession exemplar) while the ADR-0084 device rule in the same prompt forbids `원작`. The academy
  intake composes the same overlay for a game-possession serial, where `원작 주인공` is the other device's word too.
- **G7-1 (both projects):** the concept generator, power-system designer and story architect copied the prompt's
  provenance tags into their answers; three (academy) and eight (regression) locked bible facts read `… [PLANNED] …` or
  `[FACT] …`, and the approved concept's logline began with `[FACT]`.

Separately, C7 (stock-phrase mining) now has drafts from eight projects: four phrases recur in drafts of at least three
projects and never in the operator's 656 chapters (`voice-calibration.md` §4).

## Decision

`standard.v18` = `standard.v17` +:

1. `planning.register_time_frames` with prompt family 4.9.0 (`character_designer` only): every register carries
   `since_chapter`, the 화 in which the relationship begins (0 when the two knew each other before 화 1). A register
   with `since_chapter` N ≥ 1 is planned, not seeded as canon; the voice judge's 호칭 matrix leaves it out before 화 N
   and marks it in 화 N as a relationship that begins there, and canon records it from the accepted text like any other
   relationship change (G7-3).
2. `identity.genre_layers: [genre/regression@4]`: v4 is v3 unchanged plus `device_variants` for regression,
   reincarnation and game possession, each in the device's own words (지난 생, 전생, 게임) with the other device's words
   in its words-to-avoid line and no novel-possession exemplar. `composeIdentity` applies the variant of the device the
   identity records (ADR-0084); the variants never reach a prompt. `genre/regression` is capped at v3 for policies that
   do not name v4 (ADR-0073), and v4 without a device compiles to v3's bytes (G7-2).
3. `planning.strip_provenance_tags`: the tags are removed from every string of a designer's or planner's answer
   (requirement interpreter through plan critic) before the workflow stores it; the raw answer stays in the call
   record. Judges and the extractor quote draft spans and are left alone (G7-1).
4. `identity.language_layer: lang/ko@8` = `lang/ko@7` + four `stale_cliche` patterns (`고쳐 (잡|쥐)`, `비릿한 (피|핏)`,
   `훅 (끼쳤|끼쳐)`, `눈을 가늘게 (떴|뜨|뜬)`), minor, with notes the writer reads (C7).

No gate threshold moves.

## Alternatives considered

- **Seed a later relationship as canon from 화 N + 1.** Rejected: `relationship_states` excludes overlapping ranges per
  pair and a supersession ends the old row where the new one begins, so the extractor recording the relationship
  forming inside 화 N would overlap a future-dated seed or invert its range, and the canon commit would fail at
  acceptance. A relationship that has not happened is plan, not canon.
- **Rewrite 원작 in the overlay text at compile time.** Rejected: substitution leaves possession-only devices (quoting
  a line of the 원작, the arrival shock of a changed body) that mean nothing in a regression serial; the variants are
  reviewable data.
- **Stock phrases from one project's drafts.** Deferred: a chapter's revision versions repeat one sentence, so they are
  not independent evidence; four single-project phrases wait for the next pass.

## Consequences

- New projects under v18 read the overlay in their device's words; projects under earlier policies compose v3 as
  before, and pinned identities never change.
- Open, not addressed here (G7-4): the regression chapter's two solo scenes measured 6.3 % and 4.2 % talk against
  planned 20 % and 30 %; the ADR-0084 redraft needs an on-page partner. The structure gate passed at every round.
- Tests: `provenance-tags.test.ts`; `identity-from-intake.test.ts` (v3 by default, v4 by policy, no foreign-device words
  outside the words-to-avoid lines, v4 without a device = v3's bytes); `evaluator-inputs.test.ts` (the dated 호칭
  matrix); `design-output.test.ts` (`since_chapter`); `registry.test.ts` (4.9.0 changes only the cast designer);
  `policy.test.ts` (v18 = v17 + the listed changes, gates unchanged); `novel-ko.integration.test.ts` (a simulated
  regression run under v18: untagged concept and bible facts, the raw call keeps the tag, no relationship seeded before
  it begins, the device-worded overlay and the `lang/ko@8` notes in every writer prompt).
