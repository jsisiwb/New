# ADR-0086: Plan-level prevention and converging revision — the reveal schedule, talk partners and countable talk targets, the cut as the last beat, time frames, the plan critic, findings attributed to the patch, `standard.v15`

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the roll-up PR)
- **Relates to:** ADR-0014 (patch regression), ADR-0063 (plan check), ADR-0074 (POV secrets), ADR-0077 / ADR-0078
  (multi-patch rounds, parent baseline), ADR-0083 (the operator's bands), ADR-0084 (`standard.v14`), ADR-0085 (checkpoint
  economy), `docs/08-delivery/13-live-run-gemini.md` §5 (G5).

## Context

The `standard@14` checkpoint (G5, both projects) accepted neither chapter 1. Its scorecards name nine defects
(G5-1 … G5-9, §5 of the live-run record). Seven come from the plan or from the revision rules, not from the prose a
patch could change:

- **G5-1:** the hero's own device ("미래에서 돌아온 회귀자다", owner and only knower the narrator, not before 150) was a
  blocking reader secret in chapter 1 of a 회귀물. The bible has one reveal chapter per secret, so "the other characters
  learn it in 150" and "the reader learns it in 150" were the same number; ADR-0074's POV rule removed it from one
  checker input while the knowledge section still labelled it "150화 이전 공개 금지".
- **G5-2:** the regression contract put nobody but the hero on page (no plan repair could add a partner) and a scene
  forbade talking in the fight; the academy plan asked for 25–45 % talk and the writer returned 19–26 % per scene.
  Measured on the drafts: 29 and 23 quoted dialogue lines (4.9 and 3.9 per 1,000자) against the operator's median of
  9.2 and p10 of 5.3 per 1,000자 (656 chapters), and 13 quoted 속마음 lines in the academy draft against the operator's
  p90 of 11 per chapter.
- **G5-3:** all six patched rounds were quarantined — a passing dimension "regressed" far above its gate (genre 100 →
  90 against 72 while structure rose 77.5 → 88), findings the re-run judges raised in paragraphs no patch touched were
  charged to the patch, continuity and knowledge findings were never a round's target while a gated dimension
  failed, and a dimension failing by score with no major finding (academy prose 75.4) was never revised or re-judged.
- **G5-4 / G5-5 / G5-6:** one explanation in every scene; the last scene continuing past the contract's cut; bible
  states that become true later (a professor who "already" practises what he only sees in chapter 1) read as present.

## Decision

`standard.v15` = `standard.v14` + the knobs below + prompt family 4.7.0 (`prompts.max_version`). No gate threshold
moves (rule 5); every knob is opt-in, so every earlier policy replays byte-identically.

1. **Reveal schedule (U1, `planning.reveal_schedule { hint_budget }`).** Every bible secret has a reader date, a date for
   the other characters and a knowledge layer (`packages/workflows/src/reveal-schedule.ts`): the first-person narrator's
   own secrets are the reader's from 화 1; other secrets keep their reveal chapter; a bible may set
   `reader_reveal_chapter` explicitly; the layer (current timeline, 회귀 전 기억, 원작·게임 지식) comes from the bible or the
   statement's own words. The chapter planner, the scene planner, the writer and the knowledge-leak checker read
   renderings of this one schedule: what the reader knows (not a leak), what may be revealed now, and what may only be
   hinted — `hint_budget` oblique hints per hidden secret per 화 (1: the operator's books let the reader hold the hero's
   knowledge and withhold other characters' secrets behind the 착각, never behind a stated fact; set from the reading in
   `operator-voice-analysis.md` §7, not measured). The hero may think and decide with prior-life and source-work
   knowledge. The contract lists the chapter's hidden secrets as `reader_guards` (filled by the workflow); a contract in
   which a first-person narrator learns a hidden secret loses that knowledge delta (`PLAN-REVEAL-01`).
2. **Talk at the plan's source (U6, `planning.dialogue_floor`).** `partner_in_contract`: a contract with no one beside
   the POV character on page goes back to the chapter planner once with that finding (`PLAN-PARTNER-02`).
   `strip_talk_bans`: scene lines that forbid talking are removed (`PLAN-DLG-02`). `line_targets`: each scene tells the
   writer how many quoted lines to write — the operator's median density (9.2 per 1,000자) scaled by the scene's planned
   share against the operator's median share (0.234), never below the p10 density (5.3) — and caps quoted 속마음 at the
   operator's p90 density (2.1 per 1,000자). `scene_redraft_ratio` 0.6: a scene with a partner that returns below 60 % of
   its planned share is re-drafted once, besides the absolute 12 % floor.
3. **The cut as the last beat (U5, `planning.cut_design`).** The planner picks the 절단 from the operator's menu (decision,
   threat, comic punchline, emotional line, reveal, arrival, reversal, irony); the final scene's last beat is the
   contract's hook (appended when the plan ends elsewhere, `PLAN-CUT-01`); the writer of the last scene is told to stop
   on it with no line after it.
4. **Time frames (U3, `planning.time_frames`).** The character designer (4.7.0) keeps `background` to what is true
   before 화 1, puts later changes in turning points with their chapters, and dates secrets that become true later
   (`true_from_chapter`). The bible commit dates their knowers' knowledge from that chapter, so a pack for an earlier
   chapter does not present it; the schedule never lets the reader learn a secret before it is true.
5. **Plan self-consistency and the plan critic (U7, U8, `planning.plan_critic { max_repairs }`).** Before any drafting
   call the scene plans are checked against their contract (partner on page, dialogue beats where a partner stands, the
   cut last, no talk bans) and read by a `plan_critic` call (new family, not style-sensitive) with the contract, the
   plans, the schedule, the participants' state and the operator's structure targets. Blocking and major findings send
   the scene plan back to the scene planner with the findings (at most `max_repairs`, 1); everything is recorded with the
   plan (`plan_findings`, `plan_critic`).
6. **Revision that converges (V2, `revision.convergence`).** `span_attribution`: a blocking/major finding counts against
   a patch only where the patch changed the text (a line diff; every paragraph is one line, ADR-0081); findings on
   unchanged text stay open and become next round's targets. `threshold_protection`: a protected dimension regresses only
   when the patch leaves it below its gate. `round_scope: all_open`: a round patches every open blocking/major finding,
   of any dimension, clustered by span. `score_targets`: a dimension failing by score with no major finding gets its
   judge's weakest passages as minor targets, and that judge re-runs after every patch. `confirm_full`: a version
   approvable on a targeted re-evaluation is approved only after every evaluator re-runs on it.
7. **Prompt family 4.7.0** (`tools/ko_prompts/v4_7_0.py`): `chapter_planner` and `scene_planner` (schedule, plan
   feedback, partner, cut, one explanation per scene, 1–3 scenes, talk 0.2–0.4, quoted 속마음 0.01–0.04, the chapter's
   time span, the hero's current limits), `scene_writer` (countable talk, few quoted 속마음, mixed sentence endings, stop on
   the cut, the stock figures G5 repeated), `knowledge_leak_checker` (the schedule decides reader visibility; layers),
   `character_designer` (time frames, reader dates), `plan_critic` (new).

## Alternatives considered

- **Keep one reveal date and exempt the narrator everywhere.** Rejected: it fixes the premise case but still cannot say
  "the reader learns it at 30, the rival at 60", and gives the checker no way to tell a hint from a statement.
- **A deterministic partner insertion into the contract.** Rejected: choosing who is present is a story decision; the
  planner decides it with the finding in front of it, once, and a second miss is recorded rather than invented around.
- **Share targets only (the ADR-0084 floor).** Rejected by G5: planned 25–45 %, measured 19–26 %. A line count is an
  instruction a writer can check against its own output; the share stays in the plan.
- **A best-version selection by an overall distance instead of attribution.** Considered: comparing a patched version
  with its parent by open-finding counts still charges judge variance on shared text to the patch. Attribution uses the
  one fact both versions share — identical lines — so a finding on them cannot be the patch's doing.
- **Full re-evaluation every round.** Rejected for cost (about twice the judge calls); `confirm_full` spends it once, on
  the version about to be approved.
- **Lowering `gates.major_max` or any threshold.** Forbidden (rule 5).

## Consequences

- A chapter costs one to three more calls (the critic; a contract or scene-plan repair when needed; a full confirmation
  before approval). Live checkpoints record them.
- Patched versions stay on the path to acceptance when they repair what they targeted and break nothing they touched;
  open findings on unchanged text still block approval until a round repairs them.
- Tests: `reveal-schedule.test.ts`, `plan-prevention.test.ts`, `convergence.test.ts` (G5a r3 replayed: kept under v15,
  quarantined under v14), `policy.test.ts` (v15 = v14 + the knobs, gates unchanged), `registry.test.ts` (4.7.0 adds exactly
  six families), `output-shapes.test.ts` (4.7.0 shapes are renderer fixed points), `novel-ko.integration.test.ts` (a
  simulated run under v15: schedule in both planners, the critic, countable targets, the cut, reader guards, no talk ban
  left, no English in any prompt).
- Not decided here: the escalation ladder beyond one scene redraft (scene rewrite and chapter regeneration by finding
  kind), N candidate patches, a fix-rate table (STEP 3), and the operator's 3인칭 cutaways.
