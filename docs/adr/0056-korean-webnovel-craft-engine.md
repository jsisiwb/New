# ADR-0056: Korean webnovel craft engine — exemplar-anchored identity, prose-only writer, style lint

- **Status:** Accepted
- **Date:** 2026-09-23
- **Deciders:** product owner
- **Relates to:** ADR-0014 (patch-first revision), ADR-0025 (exemplar policy), ADR-0027 (Guard), ADR-0029
  (calibration), ADR-0051 (providers), ADR-0053 (pinned resume), ADR-0054, ADR-0055,
  docs/02-narrative-identity/, docs/05-generation/

## Context

ADR-0055 made a Korean project's whole prompt surface Korean. The product owner still reports prose that
reads as Western fiction or AI text rather than a Korean serialized webnovel (노벨피아·카카오페이지·문피아).
Research into how those serials are written, and a review of what the model is asked to do, found four
structural causes that no amount of rule wording fixes:

1. **Rules without a voice.** Every craft instruction was abstract ("짧은 문단", "사이다"). Models copy
   rhythm from concrete text far more reliably than from rules, and the only concrete text they saw was
   their own training prior — which, for "Korean fantasy prose", is heavily translated Western fiction.
2. **Prose inside a JSON envelope.** The scene writer had to emit its manuscript as an escaped JSON string
   with per-utterance speaker offsets and per-sentence claims. Nothing downstream consumes those
   annotations (normalization recomputes the paragraph table; extraction reads the approved text), but the
   bookkeeping competes with the prose for the model's attention.
3. **Scenes written as self-contained stories.** Each scene was drafted without knowing its place in the
   episode, so every scene tended to wrap itself up with a reflective closing line — the Western/AI habit
   the tradition contract forbids — instead of pushing into the next scene and ending the 화 on a 절단.
4. **Nothing measured the diction the contract forbids.** The Korean language layer listed 번역투 markers,
   but no deterministic check read them; judges saw only an output-language confidence and a length.

The operator also runs a Notion AI bridge (`/v1/complete` protocol, pooled workspaces) whose workspaces
can answer HTTP 200 with an empty completion.

## Decision

1. **Korean craft layers v3 as data.** `tradition/kr-webnovel@3`, `lang/ko@3`, `genre/academy@3`,
   `genre/regression@3` (회빙환·엑스트라 빙의) and a new Korean-only `genre/harem@2` (with `harem` added to the
   intake genre ids) encode the serial episode (첫 세 문장 훅, 한 화 한 사건, 사이다 cadence, 절단), the
   genre engines (서열 역전, 착각 연출, 원작 지식·카운트다운·분기, 히로인 첫 등장·질투 코미디·헌신) and the
   taboos readers punish (NTR, 우유부단, 대가 없는 원작 지식, 이유 없는 첫눈 반함). Korean projects compose
   from the newest Korean version of each layer at novel start; the composed document is pinned, so an
   existing project never drifts (ADR-0053).
2. **Studio exemplars as voice anchors.** Genre and tradition layers may carry `style_exemplars`:
   short, original, studio-authored passages (ADR-0025 permits studio-synthetic exemplars). The Korean
   compiler renders at most three — genre layers first — into `writer_full` and `editor_full` blocks
   only, framed as rhythm references whose names, events and sentences must never be reused; they are the
   first section shed under budget pressure after preferences. Planners and judges never see them.
3. **One source for forbidden diction.** The language layer's 번역투 markers and stale-cliché patterns
   (with replacement notes) render into writer, editor and prose-judge blocks as "쓰지 않는 문장", and the
   same lists drive a deterministic **Korean webnovel style lint** (`@yeonjae/prose` `lintKoreanWebnovel`):
   per-hit spans for markers and clichés; rate gates for 번역투 density, cliché count, 그/그녀 density,
   simile density, long narration paragraphs, over-long paragraphs, dialogue share and sentence-initial
   conjunctions; format drift; Latin script outside the allowlist; a summary/reflective final paragraph;
   and verbatim reuse of an exemplar line. Rate breaches, format drift, reflective endings and exemplar
   copies are `major` (they gate and drive revision); single hits are `minor` evidence. Thresholds live in
   `lang/ko@3` `lint_thresholds` and are starting values (ADR-0029). The prose and structure judges
   receive the lint digest as evidence.
4. **Prose-only scene writer.** `scene_writer@4.0.0` is a text-mode prompt that returns the manuscript
   itself; the workflow strips assistant chatter (preambles, fences, sign-offs, unmistakable labels) and
   builds the scene-draft envelope deterministically (paragraphs recomputed, no annotations). JSON drafts
   from older versions and recorded fixtures take the existing path unchanged.
5. **Episode position is explicit.** Each scene call receives `scene_total` and `scene_role` (first /
   middle / last): only the last scene closes on the contract's 절단; earlier scenes end mid-tension.
6. **v4.0.0 prompt families.** All 25 families get a v4.0.0 rebuilt around the serial market (daily
   5,000~5,500자 mobile episode, 초반 25화 funnel, 캐빨 cast and heroine-route design, 떡밥 ledger with
   due windows, anti-Western planning engines). Variable surfaces and output shapes are the v3.0.0 ones
   except the scene writer (item 4); v3.0.0 stays registered for pinned jobs.
7. **Korean runs may revise more than once.** A Korean project's chapter loop may take further revision
   rounds up to the pinned policy's `revision.max_rounds`, each targeting the dimension with the most open
   blocking/major issues and each passing the ADR-0014 regression check. The English lineage keeps the
   single representative round so its recorded fixtures replay byte-identically.
8. **Notion bridge provider mode.** `YEONJAE_PROVIDER_MODE=notion` routes every class to the operator's
   Notion AI bridge (`YEONJAE_NOTION_URL`, bearer `YEONJAE_NOTION_TOKEN`). An empty completion is a
   `retryable_provider` failure, and each class carries fallback routes, so the gateway retries on the
   next route (another pooled workspace) instead of spending JSON repairs.

9. **Seasons are planned as 에피소드 arcs.** A season longer than 15 chapters is split into arcs of about
   ten chapters (`ARC_WINDOW`), each planned when its first chapter is reached, with the previous arc's
   exit state carried into the brief across season boundaries. The live run showed that one 50-chapter arc
   plan is too coarse to pace 사이다 and too large for a single planning call; short seasons (fixtures)
   remain one arc, so their arc ids and recordings are unchanged.
10. **Arc planners read the complete design as labelled text.** The arc planner's canon state carries the
   complete bible design (ADR-0052) rendered as labelled Korean text instead of a raw JSON dump; fields
   without a label are rendered verbatim as JSON, so nothing is dropped. The live bridge repeatedly failed
   the 43k-character JSON form of the same content.
11. **Live-run output fixes extend ADR-0051 §6.** Offsets the model cannot count and shapes the prompts
   themselves mis-taught are normalized; no claim changes. The arc plan's `repetition_check` /
   `cadence_check` may arrive as prose (kept in their `notes`); the contract envelope fills `version`.
   A revision patch is anchored by its `original_quote` exactly like extractor evidence: offsets are kept
   only when the parent text at them equals the quote, otherwise the quote's occurrence (inside the
   revision window first) supplies them, and a quote absent from the text still fails `PATCH_UNANCHORED`.
   A patch without a span rewrites the whole window it was shown (and must be at least half its length);
   `dimension` is the round's, not the model's echo; `changed_claims` pairs become `before → after`
   lines, a boolean `regression` is dropped and prose in `preserved_facts_ack` is dropped so the
   acknowledgement check still decides. `arc_planner@4.0.1` and `targeted_reviser@4.0.1` correct the
   output-shape notes that taught those shapes (the reviser now asks for the exact quote, never offsets).

## Alternatives considered

- More and longer rules in the prompts — rejected: the v3 prompts already stated the rules; the missing
  ingredient is a concrete voice and a measurement of the forbidden diction.
- Few-shot excerpts from published webnovels — rejected: ADR-0025 forbids commercial works and named
  authors as style targets; the exemplars are original studio text.
- An LLM "humanizer" pass after drafting — rejected: an unconstrained rewrite drifts meaning and cannot be
  anchored; the lint-driven targeted revision fixes spans with the existing patch and regression rules.
- Keeping the JSON envelope but dropping the annotation fields — rejected: escaping multi-thousand-character
  Korean prose inside JSON still costs quality and failure modes for no downstream consumer.

## Consequences

- Schemas: `story-intake` genre id `harem`; `narrative-identity` `style_exemplars` (genre, tradition).
  Generated types regenerated.
- New profiles; the registry gains 27 versions (283 total): the active set moves to v4.0.0, with
  `arc_planner` and `targeted_reviser` at v4.0.1.
- Korean scorecards carry `lint:ko_style` issues; the Korean simulated model's scene text is
  dialogue-forward so the deterministic e2e run stays approvable.
- Exemplar copy detection is lexical (a verbatim line of ≥ 14 characters), not semantic.
- Lint thresholds and exemplar effect are uncalibrated until reviewed Korean chapters exist (ADR-0029).
