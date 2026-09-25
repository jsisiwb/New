# ADR-0084: Upstream prevention and revision convergence — dialogue floor, reader secrets in the plan, device lexicon, re-judging open majors

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the PR chain)
- **Relates to:** ADR-0014 (bounded revision), ADR-0060 (targeted re-evaluation), ADR-0063 (plan check),
  ADR-0064 (discard and continue), ADR-0077 / ADR-0078 (multi-patch rounds, parent baseline), ADR-0083 (the
  operator's talk-share bands), `docs/08-delivery/13-live-run-gemini.md` §3 (G3b).

## Context

The live `standard@12` checkpoint G3b ran chapter 1 through every revision round the policy allows and was not
accepted. The scorecards show why no number of rounds could have accepted it:

1. **A structural finding was never re-judged (G3-1).** Targeted re-evaluation (ADR-0060) re-runs the targeted
   dimension's evaluator, the claim checkers after a claim change, and any evaluator whose carried findings no
   longer anchor. The structure judge's blocking (\"dialogue share 2 %, no exchange between characters\") and its
   two majors quoted nothing, so they always \"anchored\" and were carried: structure scored 68 with the same
   blocking in all four scorecards, from one structure-judge call. The gate allows no open major
   (`gates.major_max`, starting value `standard.v1`), so a carried major is permanent.
2. **Every round went to a dimension that already passed.** `pickRevisionDimension` counts blocking/major issues
   with a span twice; prose (many quoted lint and judge findings) won every round, including after prose passed at
   r1, while failing structure (unquoted findings) waited.
3. **The plan made the blocking inevitable (G3-2).** The chapter was planned with the hero alone and its scenes at
   about a tenth of talk; the draft came back at 5 % dialogue and 속마음 against the operator's first-person median
   of 23 % (25 % in 화 1–25). A patch cannot add a scene partner the plan never put on stage.

4. **The writer never sees what the reader must not learn (A-4, G3-3).** The knowledge-leak checker judges a draft
   against the bible's secrets whose reveal chapter is later than this one; the writer's pack carries only the
   contract's knowledge guards (who must not know what). In G3b the hero recited future knowledge for fourteen
   paragraphs; in G4 (`standard@13`, §4 of the live-run record) the draft revealed a secret scheduled for 화 50 in
   the hero's inner narration — a blocking finding in both runs.
5. **A regression serial speaks of a 원작 (G-1).** The `possession`, `regression` and `reincarnation` genres all map
   to one 회빙환 overlay whose vocabulary is 원작, 원작 주인공, 원작 비틀기. The genre judge flagged "원작" in a
   regression chapter as a major in G4; the operator's own game-possession serials speak of the game (게임, 공략,
   회차, 퀘스트, 특성) and use 원작 once in 335 chapters.

## Decision

1. **`revision.convergence.rejudge_open_majors`:** after every patch, each evaluator whose findings on the parent
   include an open blocking or major issue re-runs on the new text; minors and notes are still carried. A finding
   that blocks acceptance is re-checked, never assumed.
2. **`revision.convergence.prefer_failing_dimension`:** a round targets a dimension whose gate failed whenever such
   a dimension has open blocking/major issues; among them the old weighting decides. With none, the old choice.
3. **`planning.dialogue_floor` {`chapter_min`, `partner_required`}:** after the scene plan validates, a scene whose
   `dialogue_density_target` is below `chapter_min` is raised to it (the writer reads \"대사 비중 목표\"), and when no
   scene puts anyone beside its POV character on stage, the longest scene gets the contract's first on-page
   participant who is not that POV character. Each change is a recorded finding in the scene-plan artifact
   (`PLAN-DLG-01`, `PLAN-PARTNER-01`, with `repaired`) and a normalization counter (`dialogue_floor`,
   `dialogue_partner`); a contract with no one else on page is reported, not invented around.
4. **`drafting.reader_secrets_in_plan` (U1):** every scene plan the writer reads ends with the secrets the reader must
   not learn yet — produced by the same function that builds the knowledge-leak checker's list (reveal chapter
   later than this one; under `evaluation.pov_secrets_reader_visible` the POV character's own secrets are left out),
   so what the writer is told and what the checker judges are one source.
5. **`identity.device_lexicon` (U2):** novel start records the premise device from the intake
   (`preferences.story_device`: regression, reincarnation, game possession or novel possession, told apart by the
   genres and the premise's own words). Writers, editors, planners and the genre judge get that device's vocabulary
   (a Korean `device` section that is never shed), and every evaluated version is checked for the other devices'
   words (`KO-DEVICE-01`, a major genre finding with its quote: 원작 and 빙의 in a regression or reincarnation serial,
   원작 주인공 or 원작 소설 in a game-possession serial, 지난 생 or 회귀 전 in a novel-possession serial).
6. **`standard.v14`** = `standard.v13` + `revision.convergence` {both true} + `planning.dialogue_floor` {`chapter_min`
   0.2, `partner_required` true} + `drafting.reader_secrets_in_plan` + `identity.device_lexicon`. 0.2 sits between the
   operator's first-person p10 (12.6 %, the lint's warn line) and median (23.2 %). No gate threshold changes.

## Alternatives considered

- **Full re-evaluation every round** (`evaluation.reevaluation: full`): re-runs every evaluator, including the ones
  with nothing open; roughly twice the judge calls of the targeted rule for the same convergence.
- **Re-draft the scene for a structural finding** (the unused `revision.max_scene_rewrites`): the right remedy for a
  chapter whose structure fails after the plan is fixed, but it adds a drafting path with its own checkpoints and
  regression rules. Deferred until a live run shows structure failing with a plan that meets the floor.
- **Block the plan (PLAN_INCONSISTENT) instead of repairing it:** stops a paid run for a defect the plan can fix
  deterministically from its own contract.
- **Lowering `gates.major_max`:** forbidden (a quality gate is never lowered to reach acceptance).

## Consequences

- A round now costs one more judge call per evaluator with an open major; live runs record the calls.
- A planned chapter always carries talk targets inside the operator's band, and a scene partner whenever the
  contract has one on page. The chapter planner still decides who is on page (its planner block carries the
  operator's rule that every 화 has someone to talk to, ADR-0083).
- The chapter planner still does not read the reveal schedule; the writer is now told, and the checker judges, from
  one list. A secret the plan itself schedules too early is still a plan-level defect.
- Open, not decided here: the operator's POV cutaways (1인칭 hero with 3인칭 scenes) and structural re-drafting.
