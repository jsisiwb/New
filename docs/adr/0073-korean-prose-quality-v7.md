# ADR-0073: Prose quality for Korean manuscripts — lint v6, point of view, style sample, contrast pairs, serial rhythm, a polish round (`standard.v7`)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0025 (exemplars), ADR-0056 (Korean craft engine), ADR-0062, ADR-0065 (Korean lint),
  ADR-0063 (plan check), ADR-0064 (revision), ADR-0072 (`standard.v6`), ADR-0074 (Phase A defects)

## Context

Phase K asks for prose that reads as native 웹소설체: 번역투 and Western habits caught deterministically, the
project's point of view held, the operator's own voice sample and contrast pairs used, the serial rhythm
(사이다, 고구마, the 25-chapter funnel, a 절단 that changes the situation) planned rather than hoped for, and an
editor pass after the gates. The live Phase A chapter (ADR-0074) also showed the name lint producing false
majors. Every new behaviour must be a new version and opt-in (pinned layers and policies replay byte for byte).

## Decision

1. **`lang/ko@6`** adds, each only when the layer carries its threshold: `KO-PUNCT-ELL`/`KO-PUNCT-DASH`
   (ellipses and dashes per 1,000자), `KO-IDIOM-01` (the layer's `calque_phrases`: 어깨를 으쓱, 한쪽 눈썹을
   치켜 …), `KO-ORDER-01` (narration stacking three or more unmistakable adnominal forms before a noun),
   `KO-NAME-03` (transposed, split and doubled full names), `KO-NAME-04` (replaces `KO-NAME-02`, ADR-0074) and
   `KO-POV-01` (narration against the project's point of view). Repeated endings, 그/그녀, ~에 의해,
   ~되어지다 and ~것이다 were already covered (KO-END-02, TRN-KO-05/08/11/14, KO-PRN-RATE, KO-OVR-01).
2. **The newest layer is opt-in.** A new Korean project composes the newest `lang/ko` up to `@5` as before;
   a newer one only when its pinned policy names it (`identity.language_layer`).
3. **Intake → identity preferences:** `pov` (first / third_limited / third_omniscient), `style_sample`
   (≤ 3,000자) and operator-supplied `contrast_pairs` travel with the composed identity. The POV is a hard
   section of writer, editor and voice-judge blocks and holds every contract's and scene plan's POV person;
   the style sample is the top exemplar under its own header, and like the studio's its lines of 14+ 자 are
   never copied (EXEMPLAR-COPY); three contrast pairs rotate per chapter in writer and editor blocks. The
   studio authors no sample and no pair; empty preferences leave every block's bytes unchanged. The intake
   also takes `platform`, `desired_saida_scenes`, `taboo_overrides` and `protagonist_type`, which reach the
   requirement interpreter with the rest of the intake.
4. **Serial-rhythm directives** (`planning.rhythm_directives`): from the accepted contracts, a chapter is told
   to carry a 사이다 (`local_satisfaction: satisfaction`) when the last two had none, inside the first 25 화
   when the last one had none, and always to end on a 절단 that changes the situation. The directives join the
   planner's hard constraints; the returned contract is checked and a `rhythm_check` artifact records
   PLAN-RHYTHM-01..03 (it does not block). Status windows keep the existing `KO-WIN-LINE` / FMT-WINDOW checks.
5. **A Korean polish round** (`revision.polish_pass`): after a Korean chapter passes its gates, one editor
   round on the lint's 번역투 / ending / dialogue-share / paragraph findings; the polished version is kept only
   if it still passes and the lint finds fewer of them, else quarantined (`polish_rejected`); a
   `polish_report` artifact records the counts.
6. **`standard.v7`** = `standard.v6` + `identity.language_layer: lang/ko@6` + `planning.rhythm_directives` +
   `revision.polish_pass` + `evaluation.pov_secrets_reader_visible` (ADR-0074).
7. **Not in this change:** best-of-N chapter drafts (K2) — the chapter comparator and winner selection exist
   for operator selection, but the autopilot path would double every chapter's calls and needs the
   winner-only guard wired into production; length continuation/trim (K3) beyond measuring (a continuation
   call and a safe scene-boundary trim need their own prompts); pipeline-generated contrast pairs.

## Alternatives considered

- **Auto-selecting `lang/ko@6` for new projects** — rejected: it would change what new projects are gated by
  without an opt-in (rule 6 of the programme).
- **Blocking a chapter on a rhythm finding** — rejected for now: the directive is the lever; the record lets
  calibration decide.
- **Studio-written contrast pairs** — rejected: manuscript-like content must come from the operator or the
  pipeline.

## Consequences

- New Korean projects opt into all of the above by pinning `policy/standard@7`.
- The polish round costs one reviser call and a targeted re-evaluation per chapter that has lint findings.
- K2, K3 and pipeline-generated pairs stay open.
