# ADR-0097: The pronoun redraft and device rules 3, `standard.v25`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0083 (the operator's bands), ADR-0084 (the premise device's vocabulary), ADR-0090 (device rules 2,
  the POV redraft), ADR-0096 (the pronoun band lint), `docs/08-delivery/13-live-run-gemini.md` §13.

## Context

- **G14-1: a first draft far above the pronoun band.** G14a's first draft wrote 4.41 그/그녀 per 1,000자 — above the
  first-person fail line (3.78; the warn line, the operator's p90, is 2.57) — with more than twenty 그녀 for the heroine of
  its duel scene. The lint's rate major and more than twenty per-hit minors took the prose composite to 0 and prose to
  18. The revision loop brought prose to 81.8 by r2, spending two of its five rounds on pronouns. ADR-0096's band lint
  does not apply above the band, and should not.
- **G14-2: the possessor's words in other characters' mouths.** In the same draft two in-world characters called someone
  an ‘엑스트라’ aloud. The knowledge-leak and continuity checkers flagged it as a leak (one blocking and one major in r0,
  three majors in r2, the best version). The device rule (ADR-0084, wording 2 of ADR-0090) tells the writer which words
  the hero uses for the game, but not that only the hero knows it is a game. The academy premise is a possession into a
  game's 엑스트라, so the word will be in the hero's narration in every chapter.

## Decision

`standard.v25` = `standard.v24` +:

1. **`drafting.pronoun_redraft`.** In a Korean project, a scene whose measured 그/그녀 rate is at or above the language
   layer's pronoun warn line (`pronounThreshold`: `KO-PRN-RATE-1P` in first person when the layer has it, else
   `KO-PRN-RATE`) is re-drafted once with its measure (`pronounRedraftNote`); the redraft is kept only when its rate is
   lower (`pronoun_redraft`). This is the same prevention as ADR-0084's talk redraft and ADR-0090's POV redraft.
2. **`identity.device_rules: 3`.** A new possession project records `story_device_rules` 3: wording 2, and for the game-,
   novel- and unspecified possession devices, only the hero knows the world is a game or a novel (unless the bible names
   other knowers). Their meta words (게임, 플레이어, 공략, 엑스트라, NPC, 원작 …) stay in the hero's narration and
   속마음, never in another character's line. The regression and reincarnation wordings are unchanged.

No gate threshold moves. Policies are pinned per project, so G14a and G14r keep `standard@24`.

## Alternatives considered

- **Replace 그녀 with the character's name in code.** Rejected: choosing between a name, a title and a dropped subject is
  the writer's job, and the redraft costs one call per affected scene.
- **A deterministic lint for meta words in dialogue.** Deferred: a quoted line's speaker is not known deterministically,
  and the hero may say 게임 aloud where the bible allows it. The checkers already quote the line; the gap was prevention.

## Consequences

- A pronoun-heavy scene costs one more writer call; an in-band scene costs nothing.
- Tests: `novel-ko.integration.test.ts` (a simulated v25 run: each pronoun-heavy first draft is re-drafted once and the
  redraft kept), `pronoun-band-lint.test.ts` (the redraft instruction), `identity-from-intake.test.ts` (wording 3 in the
  writer's and the genre judge's blocks; wording 2 unchanged), `normalizers.test.ts`, `policy.test.ts` (v25).
