# ADR-0081: Gemini baseline and same-model judging — prompt ceilings per policy, `standard.v12`

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering (autonomous run; the operator reviews through the PR chain)
- **Relates to:** ADR-0060 (rubric-composed gates), ADR-0073 (prose quality for Korean manuscripts), ADR-0075 (scene length
  calibration), ADR-0078 (`standard.v11`), ADR-0080 (provider readiness),
  `docs/08-delivery/13-live-run-gemini.md` §1–§2.

## Context

The G1 baseline ran chapter 1 of a fresh Phase A project on `standard.v11`, unchanged, with every role on
Gemini (`13-live-run-gemini.md` §1). Compared with the same policy on the previous model (§8.4 of
`12-live-run-ws1-7.md`), four findings are driven by the model, not the pipeline:

1. **Length.** The chapter came back at 3,965자 against 5,300 (−25 %). Scene 1 returned 1.07 of its requested
   length, scene 2 0.86. `length.scene_calibration.request_ratio` 0.8 was calibrated on the previous model's
   +27 % overshoot (ADR-0075); Gemini undershoots long scenes.
2. **Line layout.** Gemini breaks lines inside blocks and separates blocks with a blank line. Read by blank
   lines, blocks of 14–24 short lines became three "paragraphs" of 436–702자: four of the twelve majors
   (`KO-PARA-CHARS` ×3, `KO-PARA-LONG`) and the prose judge's paragraph finding were this artifact. Re-linted
   with one paragraph per line, the longest paragraph is 77자 and both rules pass.
3. **Inner voice register.** The first-person narrator's 속마음 came out in 존댓말 (하십시오체/해요체): three majors
   (genre judge once, voice judge twice).
4. **Stock figures.** "뱀 같은 눈" twice and "입꼬리가 비릿하게 말려 올라갔다" (prose judge, major). Mined
   systematically in Phase C7.

The pipeline-driven findings repeat the previous model's: a planned secret stated early (A-4, blocking), the
draft against the bible's own trait and world-rule timing (continuity, two blockings), a 14 % dialogue share
(the scene planner planned 10 % dialogue for the opening scene), all of which Phase U addresses upstream.

Same-model judging: every judge now grades its own model's prose. G1 shows the judges are not uniformly
lenient — the prose rubric was 56.3 against a lint composite of 1 — but the structure judge rated a chapter
25 % short with two scenes at 90 (rubric) because length does not enter the structure composite at all.

A second constraint surfaced: **prompt versions are not pinned by the policy.** Every new job pins the newest
active version of every family, whatever its policy, so adding a prompt version would change the behaviour
of new `standard.v11` projects and make every later A/B against v11 (Phase B) meaningless.

## Decision

1. **Prompt ceilings per policy.** `production-policy.prompts.max_version`: a job's prompt set is the newest
   active version per family at or below it (`PromptRegistry.activeSet(maxVersion)`,
   `promptCeilingOf(policy)`). A policy without the field gets `4.5.0` (`LEGACY_PROMPT_CEILING`), the newest
   version when the field was introduced, so every earlier policy keeps exactly its prompts. Chapter jobs,
   story-plan jobs and the contrast regression runner use it.
2. **Prompt family 4.6.0** (Korean, base texts read from explicit version folders so the module can be re-run):
   - `prose_judge`, `structure_judge`, `voice_judge`, `genre_judge`: an adversarial order (quote the three
     weakest passages of the dimension in `weakest_passages` first, then score) and an anchored 1–5 rubric per
     sub-score with concrete Korean failure descriptions; a sub-score cannot exceed 4 when one of the weakest
     passages is its defect, and cannot exceed the band the deterministic report supports. The answer schema
     gains the optional `weakest_passages`.
   - `scene_writer`: 속마음 in 반말 monologue only; a blank line at every line break (one line = one paragraph).
3. **Deterministic defences** (policy-gated):
   - `drafting.paragraph_per_line`: every line break of a prose draft becomes a paragraph break (words
     untouched; counted as the `paragraph_per_line` normalizer).
   - `evaluation.length_in_structure`: the length finding counts against the structure composite.
   - `evaluation.judge_calibration.max_gap_points`: a rubric may exceed its dimension's deterministic
     composite by at most this many points; above it the rubric is capped there and the cap is recorded on
     the scorecard section (`judge_calibration`). Scores are only ever lowered.
4. **Korean claims.** The length, output-language and fallback claims of a Korean project are written in
   Korean: they reach the reviser's prompt, and the English `… characters vs target …` claim was a Latin leak
   into a Korean evaluator input.
5. **`standard.v12`** = `standard.v11` + `prompts.max_version 4.6.0`, `drafting.paragraph_per_line`,
   `provider_retry.refusal { max_retries 2, detect_text }` (ADR-0080), `length.scene_calibration.request_ratio
   1.1` (from 0.8), `evaluation.length_in_structure`, `evaluation.judge_calibration.max_gap_points 30`, and the
   structure dimension's `judge_weight` from 0.65 to 0.5. No threshold changes; no gate is lowered.

## Alternatives considered

- **Leave prompts unpinned and compare against v11 anyway.** Rejected: a v11 project created after this change
  would silently use the new judges; B2's "final policy vs v11" would compare two variants of the new prompts.
- **Rewrite the lint's paragraph segmentation instead of the draft's layout.** Rejected for now: paragraph
  ids anchor every finding and patch, and the operator's own books render one paragraph per line (book 1
  with a blank line between, book 2 one `<p>` per line). Changing the text's layout once, at the draft,
  keeps every downstream consumer consistent. The corpus statistics (Phase C1) use the same segmentation.
- **A separate judge model.** Not available: every role must run on the configured model (the run's rule).
  The defences above are what a single-model setup allows; order swaps on pairwise comparisons already exist
  in `chapter_comparator` and are required by every pairwise measure added later (C8, Q1).
- **Raise judge weights' deterministic share across all four dimensions.** Only structure has evidence of a
  judge far above a deterministic signal (90 for a −25 % chapter). Prose tracked lint in all four G1 rounds
  (56.3/1, 75/68, 87.5/80, 81.3/84); the calibration cap covers a future drift without moving its weight.
- **Request exactly the target (ratio 1.0).** Rejected by the G1 numbers: scenes returned 0.86–1.07 of the
  request; 1.1 with redistribution lands the chapter within the warn band on those numbers.

## Consequences

- Pinned policies replay byte-identically: v1–v11 keep their prompt sets (`registry.test.ts` asserts the
  legacy set at the 4.5.0 ceiling and that 4.6.0 adds exactly five families); v11's file is unchanged.
- The Korean simulated run under `standard.v12` (`novel-ko.integration.test.ts`) pins the 4.6.0 judges and
  writer, turns line-broken drafts into one paragraph per line, and passes the Latin-leak scan over every call.
- Live evidence: `13-live-run-gemini.md` §1 (G1 baseline), §2 (G1 vs §8.4), §3 (the v12 checkpoint).
- A judge that stops tracking lint is visible per section (`judge_calibration` on the scorecard) instead of
  hidden in the composite.
