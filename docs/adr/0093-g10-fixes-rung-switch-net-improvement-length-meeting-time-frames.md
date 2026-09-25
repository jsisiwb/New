# ADR-0093: The G10 fixes — the untried rung before any stop, net improvement, the length band, meetings date secrets, `lang/ko@9`, `standard.v21`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (patch regression), ADR-0086 (span attribution), ADR-0087 (the ladder), ADR-0089 (dated
  relationships, C7), ADR-0092 (`standard.v20`), `docs/08-delivery/13-live-run-gemini.md` §10 (G10).

## Context

The `standard@20` checkpoint (G10) confirmed ADR-0092 on live data — no reader-secret finding in any round of either
chapter, the canon lines carrying the schedule's dates, the academy draft on its length (5,319자) with the best
likeness yet (85) — and accepted neither chapter, for reasons in the revision rules again:

- **G10-4.** ADR-0092's `no_repeat` ended both loops early. The academy chapter's r1 scene rewrite was quarantined for one
  new terminology major; r2 would have sent the same targets to the same parent at the scene rung, and the rule stopped
  instead of trying the patch rung — two evaluations out of six. The regression chapter tried a patch (r2) and a
  rewrite (r3), each quarantined for one new finding, and stopped with two rounds left. G10r r2 had removed a blocking
  finding (1 blocking / 2 major → 0 / 3) and was quarantined for the one major it wrote; G9a r2 did the same (2 / 3 →
  0 / 5).
- **G10-2.** G10r's r1 rewrite answered an exposition finding by cutting scene 1 to 2,295자: the chapter fell from
  4,528자 to 3,966 (−25 % against 5,300) and the regression check passed, because a length finding carries no quote and
  span attribution never counts a quoteless finding as introduced.
- **G10-3.** The length finding was then untargeted in every later round: no rung writes 1,300 more characters.
- **G10-1.** A cast secret ("실기 평가에서 아델에게 참패한 뒤, 밤마다 몰래 아델의 움직임을 흉내 내며 맹훈련하고 있다") describes the
  aftermath of a meeting that happens in 화 1, yet was seeded as known from before 화 1; the knowledge checker then
  demanded that the character already know the hero's strength (a blocking finding at r0).
- **C7 refresh (STEP 4.4).** `corpus:stock-phrases` over the live drafts through G9 finds eight figures in drafts of three or
  more projects that the operator's 656 chapters never use (below).

## Decision

`standard.v21` = `standard.v20` + the knobs below. No gate threshold moves; every knob is opt-in, so every earlier policy
replays byte-identically.

1. **`revision.ladder.switch_rung` (G10-4).** On the parent and targets of a quarantined attempt a round takes the rung not
   yet tried there — a patch round after a failed rewrite, a rewrite after a failed patch round while rewrites remain;
   once both failed it retries the one that introduced fewer findings, every rejection reason in the writer's note or on
   each patch target's claim. Rounds end at `max_rounds`, never earlier.
2. **`revision.convergence.net_improvement { blocking_weight: 2, major_weight: 1 }` (G10-4).** A revision whose open
   blocking and major findings weigh less than its parent's is kept even when it wrote a new finding; that finding is the
   next round's target. The hard protections still fail it: output language, the translation, Westernization and
   register kind guards, the length band, a regressed or missing gated dimension. Weights are starting values: a
   blocking finding stops approval on its own and usually takes a rewrite, a major one patch.
3. **`revision.convergence.length_protection` (G10-2).** A revision whose parent's length section passed fails its check
   (protection `length`) when its own fails.
4. **`revision.ladder.length_to_scene` (G10-3).** An open length finding is answered by rewriting the scene furthest from its
   planned length (below it for a short chapter, above it for a long one), the writer told the target and the current
   length in 자.
5. **`planning.meeting_time_frames` (G10-1).** With time frames, a secret whose statement names a character its owner first
   meets in 화 N (the dated register of ADR-0089) is true, and known, no earlier than 화 N + 1 unless the designer dated it
   later (`secretMeetingFloors`).
6. **`lang/ko@9` (C7 refresh).** `lang/ko@8` + eight stale-figure patterns found in drafts of three or more projects and in none
   of the operator's 656 chapters: `파르르 떨렸다` (5 projects), `귓가를 때렸다`, `경첩이 비명을`, `공기를 갈랐다`, `귀를 찢는`,
   `숨소리조차 들리지`, `지진이라도 난 듯`, `끔찍한 고통이` (3 each). Premise words the same intakes share (`2026년 4월`, `첫
   게이트가`, `근력 민첩`) and plain phrases (`조금 전까지`, `어이없다는 듯`) are not figures and stay out.

## Alternatives considered

- **Keep ADR-0092's stop.** Rejected: it saves one or two rounds of calls and forfeits the rounds that G9r r3 showed can
  reach 0 blocking / 2 major; the retry is no longer identical (the other rung, then the reasons).
- **Lexicographic improvement (fewer blocking first).** Rejected: 0 blocking / 7 major would beat 1 / 0. A weighted count
  keeps both in view and the weights live in the policy (rule 8).
- **Drop `new_blocking_or_major_issue` outright.** Rejected: a patch that makes the chapter heavier still fails, and the kind
  guards stay hard — a new 번역투 or register finding is never excused by fixing something else.
- **Date the objective truth of the secret too.** Deferred: knowledge and the reader date move with the floor; the
  proposition's truth stays as the bible states it (ADR-0086's model), which no G10 finding contradicted.

## Consequences

- A chapter uses its rounds; a live checkpoint may cost one or two rounds more than G10 (about 0.5 points each).
- Open: G10-5 — canon lines name a secret's owner outside the pack's registry by its raw id (hex letters in a Korean
  prompt); the owner's name needs the registry lookup other sections use.
- Tests: `convergence.test.ts` (G10r r2 replayed: quarantined under v20, kept under v21; a heavier revision and a new
  register finding still fail; a revision that leaves the length band fails under v21), `ladder.test.ts` (`nextRung`),
  `story-plan.test.ts` (`secretMeetingFloors`), `policy.test.ts` (v21 = v20 + the knobs, gates unchanged), `compiler.test.ts`
  (`lang/ko@9` listed), `commands.test.ts`.
