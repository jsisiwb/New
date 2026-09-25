# ADR-0083: The operator's voice — corpus-calibrated Korean lint, voice profile, the operator's passages as exemplars, likeness

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** engineering (autonomous run; the operator reviews through the PR chain)
- **Relates to:** ADR-0029 (calibration), ADR-0062 (exemplar priority), ADR-0065 / ADR-0073 (`lang/ko@5`, `lang/ko@6`),
  ADR-0073 (style sample, point of view), ADR-0081 (prompt ceilings, one paragraph per line), ADR-0082 (the corpus,
  copy detection), `docs/10-corpus/operator-voice-analysis.md`, `docs/10-corpus/corpus-stats.md`.

## Context

ADR-0082 put the operator's two Korean serials (656 main-story chapters) in the permanent database and measured
them with the lint's own code. Measuring the lint *against* them showed:

1. **The Korean lint fails the operator.** Under `lang/ko@6`, 75.9 % of the operator's own chapters carry at least
   one major lint finding: `KO-DLG-SHARE` on 43.6 % (straight quotes are not counted — defect C-1 — and the 25 %
   floor sits above the operator's first-person median), `SP-02` on 36.3 % (the operator's `* * *` scene breaks
   and hyphen lines such as `-챙!` read as outline drift), `KO-IDIOM-01` on 1.7 % (\"빌어먹을\", one of book 1's
   tics, is on the calque list). A gate that fails the target voice pushes drafts away from it.
2. **The thresholds were never calibrated.** `lang/ko@6` values were set from contrast pairs and live drafts; the
   operator's distribution is now known per rule and per point of view (first-person chapters differ: talk share
   median 23.2 %, 그/그녀 1.5 per 1,000자 against 2.1 overall).
3. **Judges flag the operator's conventions.** In the live `standard@12` checkpoint (G3b,
   `13-live-run-gemini.md` §3) the prose judge called \"빌어먹을\" a translated Western curse (major).
4. **The writer never reads the operator.** Exemplars are studio-written synthetic passages (ADR-0062); an intake
   may carry one style sample (ADR-0073). The model copies rhythm from concrete text more reliably than from rules.
5. **There is no measure of \"reads like the operator\".** Gates measure defects, not closeness to this voice.

## Decision

1. **`lang/ko@7`, calibrated on the corpus** (`calibration.status: corpus_calibrated`, a new enum value). For every
   rule whose value is a property of the text (`corpus:calibrate`): warn at the operator's p90 and fail at p99.5
   (rules where low fails: p10 and p0.5). `KO-TALK-SHARE` counts dialogue in curly *or straight* quotes plus
   속마음 and replaces `KO-DLG-SHARE` and the legacy `KO-DLG-LOW` (C-1); first-person chapters are measured against
   `KO-TALK-SHARE-1P` (warn 12.6 %, fail 5.9 %) and `KO-PRN-RATE-1P`. Calques, patterns and outline-drift markers
   the operator uses are removed. Result: 11.0 % of the operator's chapters carry a major finding (from 75.9 %).
   Rules that depend on the project (names, point of view, exemplars) keep their `lang/ko@6` values.
2. **Operator voice profile `voice/operator@1`** (`examples/voice-profiles/`, `voice-profile.schema.json`): Korean
   rule lines taken from the analysis — openings, the dialogue band and beat rhythm, the inner voice, line and
   sentence rhythm, endings, punctuation, figures, 만담, 착각, 사이다, 절단, one core event per 화 — for three
   audiences: `writer` (writer and editor blocks), `planner` (planner blocks), `judges` (prose, structure and voice
   judges: the operator's conventions that are not defects). A policy names it (`identity.voice_profile`); novel
   start copies the lines into the composed identity (`preferences.operator_voice`), so a project reads frozen
   bytes. Identities without it compile byte for byte as before (the sections are empty).
3. **The operator's own passages as exemplars.** A deterministic tagger `passages@1` stores candidate passages in
   `corpus.passages` (`corpus:passages`): the opening lines of 화 1–3 (`hook`), the last lines before any author's
   note (`cliffhanger`), dialogue-led windows of eight to fourteen lines with narration beats (`banter`), and
   bracketed key–value system lines with two lines of context (`status_window`; spirit voices in brackets are not
   system lines). A policy names the functions and the count (`identity.operator_exemplars`); novel start pins
   that many passages per function, preferring chapters in the project's point of view, in a stable per-project
   order (SHA-256 of project id and passage id). Pinned passages replace the studio's synthetic exemplars; the
   writer is told they are the author's earlier work whose names, settings, events and sentences are never
   reused; the passage's source is provenance only and never reaches the model. The corpus copy check
   (`CORPUS-COPY-01`, ADR-0082) and `EXEMPLAR-NEAR` guard against copying.
4. **C8 likeness, not a gate.** `operatorLikeness`: the share of 20 style metrics (paragraph and sentence
   rhythm, dialogue and 속마음, punctuation, 번역투 markers, pronouns, similes, conjunctions, ending classes) inside
   the operator's p10–p90 band; `corpus:likeness --project=|--file=` reports it with the metrics outside the band,
   beside the distribution of the operator's own chapters (p10 65 / p50 85 / p90 95). It is reported for every
   live checkpoint and never gates: it has not been calibrated against acceptance.
5. **C7 stock-phrase mining, candidates only.** `corpus:stock-phrases` lists word n-grams that recur across the
   pipeline's first drafts and that the operator's chapters do not use. A phrase becomes a lint pattern only
   through a new language layer, after review.
6. **`standard.v13`** = `standard.v12` + `identity` {`lang/ko@7`, `voice/operator@1`, operator exemplars
   for `hook`, `banter`, `status_window`, `cliffhanger`, one each} + `evaluation.corpus_copy` {`min_chars`: 14}. No
   gate threshold changes; prompts stay at 4.6.0 (the voice reaches the model through the identity block).

## Alternatives considered

- **A narrative-profile layer kind `voice`** (a ninth layer in the lineage): cleaner in the abstract, but every
  composer, schema lineage and conflict rule would change for one optional section. The voice is a project
  preference with a versioned source; copying it into `preferences` keeps the eight-layer model.
- **Warn at p90, fail at p98** (the first calibration run): by construction each of the 19 calibrated rules alone
  would fail 2 % of the operator's chapters; at p99.5 each fails 0.5 %, so the failure line sits where the
  operator almost never is.
- **LLM structure annotations (C2) and pipeline-made contrast pairs (C6) now:** both spend model calls on the
  corpus (656 chapters) while the bridge budget is the binding constraint (`09-progress.md`); the deterministic
  tagger covers the scene functions the exemplars need. Deferred, not dropped.
- **Masking character names in the passages:** Korean has no reliable name detector without a model call; the
  writer instruction, the copy check and the continuity checker cover the risk, and the live checkpoints report
  any leaked name.

## Consequences

- New projects under `standard@13` compose `lang/ko@7`, read the operator's voice lines and passages, and every
  evaluated version is checked against the corpus. Projects on earlier policies are unchanged (pinned identity
  and policy; `lang/ko@7` is opt-in like `lang/ko@6`, ADR-0073).
- The first-person dialogue floor question (A5) is answered by the corpus: a first-person chapter fails below 5.9 %
  talk share (the operator's p0.5), warns below 12.6 % (p10).
- The operator's point-of-view architecture (1인칭 hero with 3인칭 cutaways) is recorded in the analysis but not
  enabled: contracts and the POV lint still hold one person per chapter. That change belongs to Phase U.
- `corpus.passages` holds 1,850 `passages@1` rows in the permanent database (hook 6, cliffhanger 640, banter
  1,183, status window 21); a new tagger version adds rows beside them.
