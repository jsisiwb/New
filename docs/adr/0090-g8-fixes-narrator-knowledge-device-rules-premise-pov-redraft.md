# ADR-0090: The G8 fixes — the narrator's present knowledge, the operator's own device words, the 먼치킨 premise, a per-scene POV redraft, pronouns inside the operator's band, writer 4.10.0, `standard.v19`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0073 (point of view), ADR-0081 (judge calibration), ADR-0084 (the device lexicon), ADR-0088
  (narrator knowledge), ADR-0089 (`standard.v18`), `docs/08-delivery/13-live-run-gemini.md` §8 (G8).

## Context

The `standard@18` checkpoint (G8) confirmed ADR-0089 live — no copied provenance tag, every register dated, no
relationship seeded before it begins, the device-worded overlay in the writer's prompt — and ran both chapters to rest
unaccepted. The academy chapter reached 0 blocking findings in two rounds (r2, r5) with three majors each; the
regression chapter never recovered from its first draft. What the findings show:

- **G8-1 (academy r0, two blocking):** the hero's entrance recollections ("원작 초반, … 약물을 몰래 빨아 대던 백작가의
  차남") told the reader two secrets the bible dates for readers at 화 8 and 15. The designer listed the hero among
  their knowers (4.8.0 working), but the statements carry no game words, so they read as the present-timeline layer, and
  ADR-0088 gives the reader only prior-life and source-work knowledge.
- **G8-2 (academy r0 two majors, r1 blocking):** the genre judge flagged a bare `원작` in a game-possession serial. The
  ADR-0084 device rule forbids it outright; the operator's game-possession book calls the game the 원작 17 times in 16
  chapters (`원작 게임에서`, `원작대로라면`) against 476 uses of 게임, and `KO-DEVICE-01` already allows it.
- **G8-3 (academy r0 major; G7r r3):** the writer pasted the cast card's example lines (`대사 예`) into the chapter; and
  a character called another by name before any introduction (academy r0 major, r1 and r3 blocking; G7r).
- **G8-4 (academy r2; G7a r2, r3, r5):** the genre judge called the hero's cost-free power a forbidden development;
  the operator's intake names a 먼치킨 hero, and no prompt carried that.
- **G8-5 (regression r0, r4, r5 — blocking):** scenes 1 and 2 of the first-person chapter came back narrated in the third
  person ("진혁은 …", ten times each, ‘나’ once) and scene 3 in the first person. `KO-POV-01` reads the whole chapter and
  found ‘나’; no patch can rewrite two scenes, and the chapter never recovered.
- **G8-6 (G7r r0, r2, r3; G8r r0, r1):** the unawakened regression hero kicked steel doors off their hinges.
- **G8-7 (academy r4, r5; regression r1):** the prose judge raised single 그/그녀 uses as majors. The academy chapter's
  last version has two narration pronouns, 0.33 per 1,000자, below the operator's first-person p10 (0.66); two of its
  last three majors were these.

## Decision

`standard.v19` = `standard.v18` +:

1. `planning.reveal_schedule.narrator_current_knowledge`: a present-timeline secret the first-person narrator knows at
   the start is the reader's from 화 1 as well, unless the bible gives it a reader date; the other characters keep the
   bible's date (G8-1).
2. `identity.device_rules: 2`: a new project records `story_device_rules` 2, and a game-possession serial's device rule
   lets it call the game the 원작 (`원작 게임에서는`, `원작대로라면`); `원작 주인공` and `원작 소설` stay foreign (G8-2).
3. `identity.protagonist_type`: a new project records `protagonist_type` from the intake (먼치킨 → `munchkin`); writers,
   editors, planners and the genre and structure judges read a 주인공 유형 section: overwhelming power is the premise,
   tension comes from misunderstanding, relationships and stakes, the bible's own costs still hold (G8-4).
4. `drafting.pov_redraft`: in a Korean first-person project, a scene whose narration names the POV character as subject
   or object at least three times and says ‘나’ at most once is re-drafted once with that measure; the redraft is kept
   only when it no longer drifts (`pov_redraft`, G8-5).
5. `evaluation.pronoun_band_cap`: in a chapter whose measured 그/그녀 rate is below the language layer's pronoun warn
   threshold (the operator's p90: `KO-PRN-RATE-1P` 2.57 in first person), a prose-judge finding about those pronouns is
   recorded as minor; at or above it the judge's severity stands (G8-7).
6. Prompt family 4.10.0 (`scene_writer` only): the cast card's 대사 예 show the voice and are never copied; a character
   names someone met for the first time only after an introduction, and the hero's game or prior-life knowledge of a
   name stays in narration and 속마음; an unawakened or low-level body does what it can and wins by experience,
   knowledge, vital points, tools and the first move (G8-3, G8-6).

No gate threshold moves.

## Alternatives considered

- **Ignore pronoun findings outright.** Rejected, as in ADR-0088: stacked pronouns are a defect. The cap applies only
  below the band's upper edge, which is the operator's own p90 and already the lint's warn threshold, so no new number
  is introduced (rule 8).
- **Tighten `KO-POV-01` to a per-scene rule in a new language layer.** Deferred: a lint finding after evaluation leaves
  the revision loop with a drift no patch can repair; the redraft prevents it before evaluation.
- **Edit `genre/regression@4` or the ADR-0084 device text in place.** Rejected: pinned identities read those bytes.
  The new wording is recorded per identity (`story_device_rules`) and the writer line lives in a new prompt version.

## Consequences

- A drifted scene costs one more writer call; the remaining changes cost none.
- Open: G7-4 (solo scenes planned at 20–40 % talk; G8r's two solo scenes were again raised to the floor by
  `PLAN-DLG-01`) — the structure gate passed in every G7 and G8 round.
- Tests: `reveal-schedule.test.ts` (present knowledge), `identity-from-intake.test.ts` (device rules 2, the 주인공 유형
  section and its roles), `ko-style-v6.test.ts` (`thirdPersonDrift`), `pronoun-cap.test.ts`, `registry.test.ts`
  (4.10.0 changes only the writer and sorts after 4.9.0), `policy.test.ts` (v19 = v18 + the listed changes, gates
  unchanged), `novel-ko.integration.test.ts` (a simulated first-person run under v19: drifted scenes re-drafted once
  and the first-person redraft kept; the 먼치킨 premise in writer, planner and genre-judge prompts).
