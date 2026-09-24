# How a Korean novel is made

This walks one Korean serial through the studio, from the operator's intake to an accepted 화 and on to 화
200. It describes the design. `docs/08-delivery/09-progress.md` is the only place that records what exists and
what has run (ADR-0043). Every numbered step names the policy knob that governs it; the numbers quoted are
starting values of the policy named.

The rule behind every step: **the manuscript is written in Korean, directly** (NO-TRANSLATION-001,
ADR-0054). No English draft is written and translated, and no English appears in the Korean prompts, packs or
evaluator inputs. The structure is Korean serialized web fiction: a hook in the opening lines, one core event
per 화, 사이다 on a cadence, and a 절단 at the end that makes the next 화 a click.

## 1. Intake → story spec → story directions

The operator supplies configuration, never prose: premise, genre, protagonist and cast notes, tone, forbidden
developments, content restrictions, `target_chapters`, `target_characters_per_chapter` (자, counted with
spaces and without line breaks) and `"manuscript_language": "ko"`. Optional fields shape the voice:

- `pov` (first or third person);
- `style_sample` (the operator's own sample, the top exemplar);
- `contrast_pairs` (번역투 → 웹소설체 pairs);
- `platform`, `desired_saida_scenes`, `taboo_overrides`, `protagonist_type` (ADR-0073).

The requirement interpreter turns the intake into a **story spec** of confirmed requirements and labelled
assumptions. The concept generator proposes two **story directions**, and the operator approves one. Nothing
is written before approval.

## 2. The Story Bible

After approval the bible is built in checkpointed steps, each resumable on its own:

- **cast** in three batches — protagonist, core cast, supporting cast — so one long reply cannot sink the
  whole cast (`planning.design_batches`, ADR-0072);
- **world**, **progression system** (ranks, skills, 상태창 conventions), **series blueprint** (seasons, the
  protagonist's arc, the ending, the promises the serial must pay).

The bible's entities, propositions and promises become the **registry** and the first canon. Secrets carry the
earliest chapter in which the reader may learn them. The narrative identity is composed from the project's
profiles: the output-language contract, the Korean-webnovel tradition contract, genre, naming, dialogue
register and terminology, and under `standard@7` the `lang/ko@6` language layer. From here on, every
style-sensitive call carries this identity.

## 3. Arcs

Seasons longer than fifteen 화 are split into arcs of about ten. Before an arc starts, the arc planner turns
the blueprint season into chapter slots: objectives, promises to open, advance or pay, and the arc's exit. It
reads the previous arc's planned exit **and how the last accepted chapter actually ended** — the accepted
text wins (ADR-0061). Under `context.story_memory` it also reads the previous arc's **arc summary** (step 9).

## 4. The chapter contract

For 화 *k*, the chapter planner writes a **contract**: participants and locations from the registry, the core
event, the 사이다 or 고구마 beat, the promises this 화 touches, the knowledge guards (who must not know what),
story time, and the length target. Under `planning.rhythm_directives` it is told to carry a 사이다 when the
last two 화 had none, to keep the first 25 화 denser, and to make the 절단 change the situation. A rhythm check
is recorded (ADR-0073). The contract is **PLANNED**, never canon, and a deterministic plan check stops the 화
before any drafting when the plan contradicts accepted canon (ADR-0063). One example is a dead character on
page.

## 5. The context pack

Every call that needs the story receives a **context pack**, assembled deterministically from accepted canon
only, in tiers:

- **T0** — the active constraints, the contract, the scene plan and, for checkers, the chapter under
  evaluation;
- **T1** — the participants' states, knowledge and relationships, the state ledger (character cards, story
  clock and countdowns, the 호칭/말높이 matrix, the 상태창 format), and the previous 화's summary, 절단 and
  last paragraphs;
- **T2** — promises, the story so far and retrieved older canon.

A tight budget sheds T2 first and compacts T1 by a fixed ladder; T1 is never silently dropped. Korean packs are
measured at one token per 자 (ADR-0059), and `standard@8` sizes the budgets for that (writer 36k,
continuity checker 34k, ADR-0075). The pack's manifest records every item and its source, so any call can be
replayed. `pack:inspect` shows a pack against its budget (ADR-0079).

## 6. Scenes

The scene planner splits the contract into two to four scenes. Each scene has a POV, participants, beats,
entry and exit state, speaker pairs with their 말높이, and a length in 자. The scene writer drafts the scenes
in order; each sees the previous scenes of the 화 verbatim. The writer receives Korean prose instructions, the
identity block (with the operator's style sample and contrast pairs when given), a labelled Korean scene plan
and the pack.

Live Korean drafts overshoot their targets. Under `length.scene_calibration` the writer is asked for 0.8 × the
target, and the scenes still to be drafted absorb what the earlier scenes over- or under-ran. The plan and the
gate keep the real target (ADR-0075).

## 7. Checks and evaluation

The assembled 화 goes through deterministic checks first:

- the output-language check (Korean);
- length in 자;
- the Korean lint: 번역투 calques, sentence-ending monotony, ellipsis and dash density, dialogue share,
  paragraph length, names against the registry, narration against the point of view (`lang/ko@6`);
- the ledgers: countdowns, the 상태창 format, registered address terms.

Then the evaluators, four at a time:

- the contract checker, the continuity checker, the knowledge-leak checker;
- the prose, structure, genre and voice judges;
- the promise checker and the repetition judge.

Their findings enter one scorecard. Each gated dimension (prose, structure, genre, voice) combines the judge's
rubric sub-scores with the deterministic composites, and the pinned policy sets its threshold.

## 8. Revision and approval

A 화 with blocking or major findings is revised, patch-first:

- **Rounds.** Each round targets one dimension. Under `revision.multi_patch` it asks for one patch per
  cluster of that dimension's findings; each patch sees only its own window. The usable patches merge into one
  new version (ADR-0077).
- **Regression check.** A patch must earn its place: its target must improve, no other gated dimension may
  fall beyond the tolerance, and no new kind of major may appear. Under
  `revision.regression_baseline: parent` a protection fails only when the patch makes things worse than its
  parent (ADR-0078). A patch that fails is quarantined, and the round moves on from the parent.
- **Polish.** Under `revision.polish_pass`, one round aimed at the Korean lint's findings runs after the gates.
  It is kept only if the 화 still passes with fewer findings.

The **approval gate** then decides by operating mode. In autopilot a 화 with no blocking or major finding and
every gated dimension at its threshold is approved. Otherwise the run stops `needs_attention` with the reason,
and the operator can regenerate, edit or override.

## 9. Acceptance, memory and the next 화

On approval, the canon commit extracts what the 화 made true — events, facts, knowledge and relationship
changes, promise transitions — each with an evidence quote. It verifies them and commits them **atomically**
together with the version's acceptance. Then:

- the L1 summary and 절단 are written from the accepted text;
- paragraphs, summaries and events are indexed for Korean retrieval (particle-stripped stems, registry
  aliases; ADR-0058);
- when the next arc starts, every earlier arc whose 화 are all accepted gets one **arc summary (L2)** from its
  accepted L1 summaries (`context.story_memory`, ADR-0076).

화 *k+1* cannot start until 화 *k* is accepted; its pack reads the previous 화 and the canon at its start.
Rejected drafts and quarantined patches never reach canon, summaries, retrieval or export.

## 10. Toward 화 200

What keeps a long serial coherent is memory the application holds, not the model:

- **the story so far**: the last 20 accepted 화 as L1 lines and one arc summary per older arc. At 화 200 that
  is about 20k Korean estimator tokens instead of about 80k for every L1 line (ADR-0076);
- **the state ledger and first meetings**: who is where, with what rank, items and wounds; which pairs have
  met; the story clock; countdowns (ADR-0061, ADR-0063);
- **the promise ledger**: every open promise, and every overdue one whoever is on page;
- **retrieval**: older paragraphs and events matched in Korean;
- **`series:audit`**: overdue promises, characters gone missing, story time running backwards, repeated
  openings.

`story:state` and `cost:project` show where a serial stands and what the rest will cost (ADR-0079).

## Where to look

| Question | Look at |
| --- | --- |
| What did the run do, step by step? | `pnpm cli quality:run-report <project>`; `workflow_artifacts` (plans, drafts, scorecards, patches, regression reports) |
| Why did a 화 stop? | the run's `last_error`; the scorecard's blocking/major findings; the regression reports |
| What did a call see? | the pack manifest (`context_packs`), `pack:inspect` |
| What did it cost? | `llm_calls` (tokens, latency, attempts), `cost:project` |
| What is decided and why? | `docs/adr/` (0071–0079 for this roadmap) |
