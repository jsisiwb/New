# ADR-0110: A scene with no one beside its POV character is not raised to the dialogue floor, `standard.v30`

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0084 (the dialogue floor and the scene partner), ADR-0086 (countable talk targets, the talk
  redraft), `docs/10-corpus/operator-voice-analysis.md` (POV architecture), `docs/08-delivery/13-live-run-gemini.md` §7.

## Context

- **G7-4.** The regression chapter's two solo scenes came back at 6.3 % and 4.2 % talk against planned 20 % and 30 %.
  The talk redraft rightly skips them (it needs someone on stage to talk to), so the plan and the draft disagreed in
  every round.
- **Where the 20 % came from.** `applyDialogueFloor` raises every scene planned below `chapter_min` (0.2) to it — a
  scene where the POV character is alone included — and `sceneLineTargets` gives every scene a quoted-line minimum (at
  least two lines and the operator's p10 density). A scene with nobody to answer is told to produce dialogue, and the
  writer either invents it or ignores the quota.
- **What the operator does.** In the operator's first-person chapters the hero's time alone is carried by action,
  narration and a little 속마음 (the operator's 속마음 cap is about two quoted lines per 1,000자), and the talk sits in
  the scenes with other people — or in 3인칭 cutaways through them (`operator-voice-analysis.md`, POV architecture).

## Decision

`standard.v30` = `standard.v29` + **`planning.dialogue_floor.solo_scenes`** (with `solo_max`, starting value 0.05):

1. A partner required by `partner_required` is placed first, as before, so a scene given one is not solo.
2. A scene with no one beside its POV character (`isSoloScene`) keeps the planner's dialogue target, at most
   `solo_max`; it is never raised to the floor (`PLAN-DLG-04`).
3. The scenes with a partner carry the chapter's floor: each is raised to `chapter_min`, then all of them together until
   the length-weighted talk share of the chapter reaches `chapter_min` (at most 0.6 each; `PLAN-DLG-01`).
4. The writer's note for a solo scene (`soloLineTargetNote`) sets no quoted-line quota: nobody is there to talk to, the
   scene moves by action and narration, and 속마음 stays under its cap. A scene rewrite of a solo scene gets the same
   note.

The chapter-level floor, the talk redraft of scenes with a partner, the contract's partner rule and every gate are
unchanged.

## Alternatives considered

- **Always give a solo scene a partner.** Rejected: it rewrites the plan's intent (the hero alone at D-10 is the
  point of such a scene) and puts bystanders on stage to satisfy a metric.
- **3인칭 cutaways** (a scene through another character after a `* * *` break, as the operator does). Deferred: it needs
  a scene point of view other than the chapter's, knowledge and pronoun checks per scene, and a planner rule for when to
  cut away. This ADR removes the contradiction a cutaway would otherwise have to work around.

## Consequences

- A solo scene is planned and briefed as the operator writes one; the chapter still reaches its talk floor through the
  scenes with people in them.
- Tests: `dialogue-floor.test.ts` (without the flag every scene is raised; with it the solo scenes stay at the solo band
  and the paired scene carries the floor; a placed partner makes a scene paired), `plan-prevention.test.ts` (the solo
  note: no quota, the 속마음 cap, Korean only), `policy.test.ts` (v30), `commands.test.ts`.
