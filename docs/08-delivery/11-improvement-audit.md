# Improvement audit — Korean webnovel programme, Step 0

- **Audited revision:** `d357099` on `hoplite/ainos-1ac771f8` (merged Korean webnovel craft engine,
  ADR-0056 §1–14; `scene_writer` / `chapter_planner` / `scene_planner` at v4.2.0, judges and checkers at
  v4.1.0, `arc_planner` / `targeted_reviser` at v4.0.1).
- **Date:** 2026-09-23.
- **Purpose:** the improvement request of 2026-09-23 lists findings from a review of `8b5f839` plus
  ADR-0056 §14. Before any change lands, every finding is checked against the code as it is now and
  recorded as **confirmed**, **already fixed** or **different** (the finding's premise does not match the
  code), with `file:line` evidence. The code wins over the finding text.
- **Status rule (ADR-0043):** this document records what the audited code does. It claims nothing about
  what later workstreams build; `09-progress.md` records that.

Line numbers refer to `d357099`. "Korean pack" / "Korean prompt" means a project whose manuscript language
is `ko`. Paths without a package prefix are under `packages/workflows/src/`.

## 0. Baseline

`pnpm install --frozen-lockfile && pnpm check` on `d357099` against a local PostgreSQL 16.14
(`DATABASE_URL` pointing at a disposable `yeonjae_test` database, `CI=true`). The result is in §13.

The first attempt stopped inside `pnpm lint` with `FATAL ERROR: … JavaScript heap out of memory` at the
~2 GiB default V8 heap of a sandbox with a 2 GiB memory reservation. That is an environment limit, not a
repository defect (CI runners start Node with a larger default heap). The recorded run sets
`NODE_OPTIONS=--max-old-space-size=6144`.

## 1. Workstream 1 — structured-output reliability

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1.1 | Output-shape examples are hand-written, not generated from `schemas/` | **Confirmed** | Prompts are immutable folders `packages/prompts/families/<family>/vX.Y.Z/{prompt.json,system.md,user.md}` (`packages/prompts/src/registry.ts:1-6`). Shape notes are string literals in the generators, e.g. `tools/ko_prompts/v4_1_0.py:38-40` (`QUOTE_NOTE`, `SCORE_NOTE`, `KIND_NOTE`). Every judge and checker, `scene_planner` and the bible designers declare `output_schema: null` in `prompt.json`: **no schema in `schemas/` describes their output**, so there is nothing to generate those examples from yet. |
| 1.2 | No CI test that shape examples validate, or that enum values named in prompts exist | **Confirmed** | `packages/prompts/src/registry.test.ts:163-180` checks Korean labels and single-brace placeholders only; `:182-258` pin individual strings of single versions (`repetition_check`, `changed_claims`, v4.1.0/v4.2.0 wording). No test parses a shape example or cross-checks enum values. |
| 1.3 | No native structured output; `json_repairer` fallback | **Different** | OpenAI-compatible live providers already send `response_format: {type: 'json_object'}` whenever a schema ref or `params.json_schema_mode` is set (`packages/gateway/src/live-providers.ts:16`, `:208-209`); Anthropic has no equivalent. There is **no per-provider capability flag** and no JSON-*schema* response format. There is **no `json_repairer` role**: "bounded repair" regenerates the same request on the same route twice, then moves to the next route (`packages/gateway/src/gateway.ts:786-793`); the validation error is not fed back. |
| 1.4 | The ADR-0056 §11–12 normalizers carry no metric | **Confirmed** | `anchoring.ts:35` `locateQuote`, `:54` `foldQuoteMarks`, `:102` `anchorSpan`, `:113` `anchorEvidence`, `:146` `normalizeSceneDraft`; `plan-normalize.ts:149` `normalizeContractOutput`, `:514` `normalizeScenePlans`; `judge-normalize.ts:54` `normalizeDriftFlags`, `:69` `normalizeDimensionScores`, `:95` `normalizeRepair`, `:123` `anchorIssueQuote`; `revision.ts:93` `normalizePatchFields`. None records that it changed its input. The only structured-output counter is the gateway's `yeonjae_provider_repairs_total` (`gateway.ts:788`, `packages/domain/src/metrics.ts:239`). |
| 1.5 | `must_not_happen.lexical_patterns` compiled with a bare `new RegExp` | **Confirmed** | `evaluation.ts:318` `new RegExp(pat, 'i')` on model-supplied contract text, without `try`: an invalid pattern throws out of the deterministic checks. Other data-driven sites: `packages/prose/src/ko-style.ts:110-118` (profile patterns; guarded, but a bad pattern is dropped silently), `packages/prose/src/platform-format.ts:194` (guarded), `:401`, `:406` (profile-authored, unguarded). |

## 2. Workstream 2 — Korean retrieval, token estimation, localization

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 2.1 | Lexical search is English on both sides | **Confirmed** | Query: `packages/db/src/retrieval.ts:228`, `:249` `websearch_to_tsquery('english', $2)`; retriever name `packages/context/src/retrievers.ts:50` `'postgres_fts_english'`. Index: `packages/db/migrations/0003_context_retrieval.sql:74` `tsv … to_tsvector('english', text)`. `canon.index_accepted_version` (`0003:158-217`) never sets `language`, so Korean paragraphs are stored with the `'en'` default (`0003:73`; migration 0020 relaxed only the CHECK). Reproduced on PostgreSQL 16.14: `to_tsvector('english','레온은 검을 들었다.') @@ websearch_to_tsquery('english','레온')` is **false**; only the exact eojeol `레온은` matches. On the local PG 16 and the CI `postgres:16` image, `pg_trgm` 1.6 (contrib) is available; `pg_bigm`, PGroonga and `pgvector` are not installed. Migrations create only `btree_gist` (`0001_canon_core.sql:13`). |
| 2.2 | No Korean query normalization | **Confirmed** | `packages/db/src/thesaurus.ts` normalizes surfaces (NFC, case, whitespace) and expands registry aliases with bounded, ranked terms; nothing strips particles or endings. `lexicalSearch` splits the query on whitespace only (`retrieval.ts:221-224`). |
| 2.3 | No Korean retrieval fixture / recall@k | **Confirmed** | `packages/db/src/retrieval-readiness.integration.test.ts` is English-only (`:626` documents the English stopword behaviour). |
| 2.4 | Token estimator is English (1.3 × whitespace words) | **Confirmed** | `packages/context/src/hash.ts:33-41` `TOKEN_ESTIMATOR_ID = 'english_estimator_v1'`, `estimateTokens = ceil(countWords × 1.3)`, recorded in the manifest (`packages/context/src/assemble.ts:419`). The identity compiler budgets with its own English estimator (`packages/narrative/src/compiler.ts:81`, `:415-432`), which decides which Korean identity sections — exemplars included — are shed. Korean prose has roughly one eojeol per 3–4 자, so word-based estimates undercount Korean tokens several-fold. |
| 2.5 | Lengths are English words | **Different (partly)** | The chapter length gate already counts 자 for `ko`: the contract target is `unit: 'characters'` (`chapter-production.ts:428-435`) and `measure().characters` counts code points without line breaks, spaces included (`packages/prose/src/length.ts:49`, `:82`). Still word-based or English-named: `SceneDraftRef.words` / `english_confidence` (`drafting.ts:289-290`, `:359-362`); `english_confidence` in `DeterministicChecks` and the scorecard's `output_language` section (`evaluation.ts:132`, `:344`, `:691`); the previous-chapter tail walks whitespace words (`packages/context/src/tail.ts:19-51`); tail floors and the summary cap are words in the policy (`examples/production-policies/standard.v1.json` `context.previous_tail_words` 400, `previous_tail_floor_words` 250, `l1_summary_max_words` 120); the reviser's `length_budget_words` splits on whitespace (`revision.ts:233`); export records `words` (`export-package.ts:128`, `:433`). The Korean output-language threshold reuses `output_language.min_english_confidence` (`evaluation.ts:165`). |
| 2.6 | English leaks in Korean canon rendering | **Confirmed**, with one correction | `eventLine` has no Korean branch: `ch.`, ` at `, English `clockLabel` (`packages/context/src/fetch.ts:530-535`; `packages/context/src/render.ts:13-17`). `committedDeltaLine` has no Korean branch: `register:`, `promise`, `proposition`, `is … on timeline`, `entity`, `alias`, English `clockLabel` and `registerLabel` (`fetch.ts:651-701`, `render.ts:48-61`), and every line is prefixed `Committed from chapter N (canon vX)` (`fetch.ts:848`). ` — CONTINUITY ANCHOR` (`fetch.ts:270`, `:273`). Knowledge lines embed `believes:` / `certainty` and ` by <informer>` **inside the Korean branch** (`fetch.ts:355`, `:373-382`). The TIMELINE POSITION section is English-only (`fetch.ts:1316-1324`). Soft-preference lines append `(unconfirmed assumption)` and `{scope: …}` (`fetch.ts:1298`). **Correction:** section titles are already localized — `SECTION_TITLES_KO` (`packages/context/src/templates.ts:646-699`) through `sectionTitle` (`:701`, used at `assemble.ts:171`). No test renders the templates for a Korean project and fails on Latin-script words. |
| 2.7 | The local embedder is lexical only | **Confirmed** | `packages/prose/src/local-embeddings.ts:9-12` ("It captures lexical overlap, not meaning"). `packages/db/src/hybrid-retrieval.ts` implements the vector path over `embedding_sets` (migration 0016) and degrades to lexical-only without an active set; chapter production passes only `PgLexicalRetriever` (`drafting.ts:109`). |

## 3. Workstream 3 — evaluator wiring, missing evaluators, speed

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 3.1a | `knowledge_leak_checker` gets canon state as both table and secrets, timeline position as guards | **Confirmed** | `evaluation.ts:501-503`. |
| 3.1b | `continuity_checker` gets timeline position as locked facts | **Confirmed** | `evaluation.ts:486`. |
| 3.1c | `voice_judge` compiles the prose rubric; no voice rubric, voice cards or 호칭 matrix | **Confirmed** | `evaluation.ts:586` `block: compileFor(ctx, 'judge_rubric_prose')`; its inputs are the chapter text and `register_digests` (`:578-584`). `schemas/register-profile.schema.json:62` already defines `voice_exemplar_ids`, never filled. |
| 3.1d | `genre_judge` terminology report is a one-line count | **Confirmed** | `evaluation.ts:563-566`. |
| 3.2 | `promise_checker` and `repetition_judge` missing | **Confirmed** | Neither is among the 25 families in `packages/prompts/families/`; the pipeline lists both (`docs/05-generation/01-generation-pipeline.md` §4 step [5] and §4.1). |
| 3.3 | Evaluators run sequentially | **Confirmed** | Seven sequential `await modelCall` (`evaluation.ts:422`, `:480`, `:495`, `:513`, `:530`, `:557`, `:574`); `schemas/production-policy.schema.json` has no concurrency knob. |
| 3.4 | Gates read a model-chosen 0–100 number | **Confirmed** | `evaluation.ts:594-597` `clamp(prose.output.judge_score ?? 0)` etc.; v4.1.0 teaches it (`tools/ko_prompts/v4_1_0.py:39` "judge_score는 0~100점"). The design composes each dimension from the judge **and** a deterministic composite by `policy.gates.dimensions.<d>.judge_weight` (`docs/02-narrative-identity/05-drift-detection-and-repair.md` §2; `schemas/production-policy.schema.json:197`); no code reads `judge_weight`. |
| 3.5 | Every evaluator re-runs after a patch | **Confirmed** | `chapter-production.ts:541-548` calls the full `evaluateVersion`. |

## 4. Workstream 4 — long-story memory

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 4.0 | The writer sees mostly chapter k−1, capped events and promises, lexical T2 | **Confirmed** | Recent events `limit: 12` (`packages/context/src/fetch.ts:565`); promises only when they share an entity with the participants or their due window overlaps k ± 3 (`fetch.ts:488`, `packages/db/src/retrieval.ts:518-544`), so an **overdue** promise that shares no participant is invisible; previous chapter L1 + verbatim tail + committed delta (`fetch.ts:703-866`). |
| 4.1 | Only an L1 write path | **Confirmed** | `summaries.tier IN ('L1','L2','L3','L4')` (`0003_context_retrieval.sql:19`); the only writer is `upsertL1Summary` (`packages/db/src/retrieval.ts:110`, called at `acceptance.ts:435`). |
| 4.3 | No state ledgers | **Confirmed** | Canon holds facts, events, knowledge, relationships (with register) and promises. There is no character state card, story-clock/countdown ledger, first-meeting ledger, 호칭/말높이 matrix, status-window format ledger or place/direction ledger. |
| 4.4 | The precedence rule lives only in the writer prompt | **Confirmed** | `tools/ko_prompts/v4_2_0.py:48`; nothing checks the plan deterministically before drafting. |
| 4.5 | No overdue-promise enforcement | **Confirmed** | `schemas/promise.schema.json` has `due_window`; no code computes overdue promises (and see 4.0). |
| 4.6 | Arcs chain from the previous arc's planned exit | **Confirmed** | `chapter-production.ts:764-773` joins the previous arc plan's `exit_state_assertions`, rendered at `story-plan.ts:1151`. |
| 4.7 | No series audit | **Confirmed** | No such workflow in `packages/workflows/src`. |
| 4.8 | No character voice cards | **Confirmed** | `voice_exemplar_ids` (see 3.1c) is never filled. |
| 4.9 | The contract is last in the pack | **Different** | The writer template renders identity → **contract (T0)** → preferences, registry, previous chapter, states, knowledge, relationships, promises (T1) → world rules, retrieval (T2) (`packages/context/src/templates.ts:178-289`): the contract is second, and dynamic previous-chapter text precedes stable rules. |
| 4.10 | No retcon path | **Different** | Canon correction and impact libraries exist (`packages/canon/src/correction.ts`, `impact.ts`), exposed through the API; there is no "edit an accepted chapter → new version → re-extract → list conflicting chapters" flow. |

## 5. Workstream 5 — prose quality (웹소설체, anti-번역체)

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 5.1 | Exemplars are shed early | **Confirmed** | `packages/narrative/src/compiler.ts:362-381`: exemplars priority 50, below structure 90, participants 88, register 85, naming 80, terminology 75, avoid 72, genres 70, cadence 60; only preferences 40 and setting 30 go first — and the budget is measured with the English estimator (2.4). |
| 5.2 | No user style samples | **Confirmed** | `allow_user_exemplars` exists in the identity schema (`packages/domain/src/generated/narrative-identity.ts:281`); no intake field or code path fills it. |
| 5.3 | The contrast corpus is unused by prompts | **Confirmed** | `examples/fixture/contrast-sets.seed.json` (100 sets × 5 variants) feeds `packages/eval` only. |
| 5.4 | No polish pass | **Confirmed** | `targeted_reviser` (윤문 wording, `packages/prompts/families/targeted_reviser/v4.0.1/system.md:1`) runs only inside revision, after evaluation. |
| 5.5 | Lint gaps | **Confirmed** | `packages/prose/src/ko-style.ts`: dialogue share counts only “…”/"…" (`:125-131`), not ‘…’; KO-END-01 is a single regex (`:322-340`); exemplar copying is a verbatim line of ≥ 14 code points (`:342-360`); every Latin run of 4+ letters outside the allowlist is `major` (`:103`, `:236-252`). No ending-monotony, overuse-rate, sentence-length, cross-chapter repetition or mobile-format checks. |
| 5.6 | No spelling/spacing check | **Confirmed** | None in the repository. |
| 5.7 | No speech-level classifier | **Confirmed** | Register data is numeric axes plus address terms (`render.ts:36-61`); nothing classifies 하십시오체/해요체/반말 from endings. |
| 5.8 | No naming check | **Confirmed** | None. |
| 5.9 | No best-of-N in chapter production | **Confirmed** | `comparison.ts` / `selection.ts` implement position-swapped comparison and candidate selection; `chapter-production.ts:69` imports only `patchRegression` / `regressionArtifact` from them. |
| 5.11 | No continuation or trim | **Confirmed** | `judgeLength` only judges (`packages/prose/src/length.ts`); a short draft becomes a `length_out_of_range` issue for the reviser. |
| 5.12 | Plain join; English export headings | **Confirmed** | `drafting.ts:578` joins scenes with a blank line; `apps/api/src/export.ts:119`, `:139`, `:169` write `Chapter N` / `## Chapter N`. |
| 5.13 | 1인칭 hard default | **Confirmed** | `tools/ko_prompts/v4_0_0_prose.py:32` ("1인칭 주인공 시점을 기본으로"), `v4_common.py:64`, `v4_0_0_planning.py:23`; no intake POV field (6.2). |
| 5.14 | Long prohibition lists in prompts | **Confirmed** | `tools/ko_prompts/v4_common.py:52-64` (`PROSE_RULES`). |
| 5.15 | No per-role sampling | **Different** | Sampling is pinned per prompt version (`prompt.json` `params`: `scene_writer@4.2.0` 0.85, `prose_judge@4.1.0` 0.1, `targeted_reviser@4.0.1` 0.5) and forwarded by `modelCall` (`runtime.ts:510`). It is not in the policy and cannot vary by call purpose (opening candidate vs continuation). |

## 6. Workstream 6 — planning and user input

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 6.1 | English concept angles and "World rules" entity | **Confirmed** | `story-plan.ts:252-257` (`ANGLES`), `:651` `addEntity('term', 'World rules', …)`. |
| 6.2 | Missing intake fields | **Confirmed** | `schemas/story-intake.schema.json` has `target_chapters`, `target_characters_per_chapter`, `desired_tropes`, `forbidden_developments`, `target_audience`, `prose_preferences`; no POV, platform, reader base, wanted 사이다 scenes, voice sample or style sample. |
| 6.3 | Genre taboos are not spec items | **Confirmed** | e.g. `examples/narrative-profiles/genre-harem.v2.json:99-104` (`taboos`) render into prompts only. |
| 6.4 | No contract approval before drafting | **Confirmed** | The contract locks inside chapter production; `stage: 'contract_and_pack'` stops after the pack but has no approval flow. |
| 6.5 | No per-chapter direction | **Confirmed** | None. |
| 6.6 | No 고구마/사이다 rhythm ledger | **Confirmed** | Nothing in the policy or the workflows. |
| 6.8 | `planScenes` accepts 1–5 scenes | **Confirmed** | `drafting.ts:243-247` ("a plan, not a gate: 1–5 grounded scenes are accepted"). |
| 6.9 | `ARC_WINDOW = 10` | **Confirmed** | `story-plan.ts:1055`, `:1075-1080`. |
| 6.10 | The writer gets JSON | **Different (partly)** | The contract reaches the writer as labelled Korean text (`renderContractKo`, `packages/context/src/render.ts:254`); the **scene plan** is `JSON.stringify(scene)` (`drafting.ts:317`). There are no dedicated opening / 절단 slots. |

## 7. Workstream 7 — revision strategy

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 7.1 | Structural failures go to patches | **Confirmed** | `revision.ts` has one path (`reviseVersion` → one patch). The production policy already carries `revision.max_scene_rewrites: 2` (`standard.v1`) and the design routes serial/Western drift to scene rewrites (`05-drift-detection-and-repair.md` §2); neither is implemented. |
| 7.2 | One patch per round over a union span | **Confirmed** | `revision.ts:180-197`: an issue without a span widens the window to the whole chapter. The production policy's `revision.max_patches_per_round: 6` (`standard.v1`) is unused. |
| 7.3 | `PATCH_REGRESSED` stops the run | **Confirmed** | `chapter-production.ts:585-604` throws; the job becomes `needs_attention` (`:729-735`). |
| 7.4 | `language !== 'ko'` single-round branch | **Confirmed** | `chapter-production.ts:609`. |
| 7.5 | No reader panel | **Confirmed** | None. |
| 7.6 | No failing Korean simulated fixture | **Confirmed** | `simulated-model.ts` writes approvable Korean scenes only; no test asserts that bad Korean prose fails. |

## 8. Workstream 8 — benchmarks and calibration

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 8.1 | No Korean gold set | **Confirmed** | The contrast corpus is synthetic; no human-rated chapters exist (calibration status `uncalibrated`, ADR-0029). |
| 8.2 | No judge–human agreement | **Confirmed** | `packages/eval/src/review-packet.ts` builds blinded packets; no judgment has been recorded. |
| 8.3 | No A/B harness | **Confirmed** | None. |
| 8.4 | No long-run quality tracking | **Confirmed** | Scorecards are artifacts; nothing aggregates them across 화. |

## 9. Workstream 9 — prompt architecture

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 9.1 | Versions are built by exact-match edits | **Confirmed** | `tools/ko_prompts/v4_1_0.py:31-33` `edit()` asserts one occurrence and replaces it over v4.0.0; v4.2.0 edits v4.1.0 the same way. |
| 9.2 | No rendered prompts checked in | **Confirmed** | No `prompts/rendered/`. |
| 9.3 | No prompt lint | **Different (partly)** | `registry.test.ts:163-180` already fails v3/v4 prompts on English labels, English sentences and single-brace placeholders, and the registry rejects undeclared `{{variables}}` at load. Missing: every template variable supplied by its workflow, shape validation (1.2), a "never ask the model to count" rule. |
| 9.4 | Retired lineages still active | **Confirmed** | Every version of every family has `status: "active"`; `activeSet()` picks the highest semver (`packages/prompts/src/registry.ts:213-227`). |

## 10. Workstream 10 — performance, cost, operations

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 10.1 | No per-role routing in the policy | **Confirmed** | Models are chosen per class R/P/M/C from environment variables (`packages/gateway/src/live-config.ts:5-6`, `:82`); the policy has only `judge_families_differ_from_writer`. |
| 10.2 | No cost/time projection | **Confirmed** | None at intake. |
| 10.3 | No speculative pipelining | **Confirmed** | Chapters run strictly in sequence. |
| 10.4 | Bindings merged from every job | **Confirmed** | `chapter-production.ts:338-345` reads `progress` of every job of the project at each chapter start. `makePlanContext` (`story-plan.ts:98`) duplicates the pin/identity/job setup of `makeContext` (`chapter-production.ts:220`). |
| 10.5 | Observability gaps | **Confirmed** | Gateway counters exist (`packages/domain/src/metrics.ts:209-240`); there is no per-role latency/cost series, normalizer counter or lint time series. |

## 11. Workstreams 11–12 — utilities and documentation

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 11 | Missing CLI utilities | **Confirmed** | `apps/cli/src/commands.ts` has project/novel/chapter/job commands; none of `inspect-pack`, `story-state`, `lint-ko`, `continuity-report`, `bench`, `estimate`, platform `export`, `edit-chapter`. |
| 12.1 | README outdated | **Confirmed** | `README.md:3-9` (Phase 4 status, `jsisiwb/New` PR links, "the gateway contains no HTTP client" although live providers exist), `:42` ("English prose"), `:87`, `:107`; `package.json:5` ("English manuscripts"). |
| 12.2 | Pipeline doc outdated | **Confirmed** | `docs/05-generation/01-generation-pipeline.md` §2.1 ("interpreted into English working text"), §4 step [2] ("text (English)", "length (words)"), §8 (JSON envelope for prose). |
| 12.3 | Progress log too long | **Confirmed** | `docs/08-delivery/09-progress.md` is 1,510 lines of checkpoint history with the current state at the top. |

## 12. Findings not in the request

1. **Korean documents are indexed as English** (2.1): `index_accepted_version` never sets
   `search_documents.language`.
2. **The identity block budget uses the English estimator** (2.4), so exemplar shedding in Korean blocks
   is decided by word counts.
3. **Production-policy knobs without implementation:** `policy.gates.dimensions.*.judge_weight` (see
   3.4), `policy.revision.max_patches_per_round` (see 7.2), `policy.revision.max_scene_rewrites` (see 7.1).
4. **English defaults in Korean evaluator and reviser inputs:** `evaluation.ts:486`, `:501-503`, `:580`
   and `chapter-production.ts:535` pass a literal `'(none)'`, bypassing the language-aware default of
   `runtime.ts:470`; `toIssue` defaults an absent claim to English (`evaluation.ts:111`); the reviser's
   length budget is whitespace words (`revision.ts:233`).
5. **Overdue promises disappear from packs** unless they share an entity with the chapter's
   participants (4.0).
6. **Gateway repair repeats the identical request** without the validation error (1.3).
7. **The planning validator still encodes the English-manuscript era.** `CONTRADICTION_PATTERNS` in
   `tools/validate-planning-package.py:131-167` still fail doc lines that pair "Korean" with prose
   quality or benchmarks, that name a Korean speech-level identifier, or that mention Korean
   morphological tooling, with explanations from ADR-0026/0028 ("prose roles write English", "use
   dialogue register … rendered in English"). ADR-0054 superseded that premise, so Workstreams 5.6–5.7
   need an ADR that retires those patterns before their design text can land.
8. **A Korean project reuses English-lineage policy fields:** `output_language.language` is `"en"` and
   the Korean confidence threshold is `min_english_confidence` in every pinned policy
   (`examples/production-policies/standard.v1.json`), read at `evaluation.ts:165`.

## 13. Baseline result

`pnpm check` on `d357099` (PostgreSQL 16.14, Node 24.19, pnpm 10.26, `NODE_OPTIONS=--max-old-space-size=6144`):
**green**. Every stage passed:

| Stage | Result |
| --- | --- |
| `check:types-fresh` | generated types fresh (33 schemas) |
| `typecheck`, `lint`, `format:check` | clean |
| `test` (vitest) | 126 files, 1,868 tests passed |
| `test:replay-120` | 18 tests; 120 chapters accepted, final canon version 122, no live provider call |
| `test:chaos` | 6 files, 109 tests; 49 deterministic scenarios |
| `drill:restore` | 2 files, 83 tests; 40 invariants on PostgreSQL 16.14 at schema `0020_manuscript_language.sql` |
| `test:security` | 11 files, 180 tests; 16 scenarios |
| `test:costs` | 2 files, 21 tests; 14 scenarios (synthetic replay basis) |
| `build:web` | compiled |
| `validate:planning` | `RESULT: ALL OK` (0 contradiction hits) |
| `validate:contrast` | 2,000 evaluations, 0 false positives, 0 false negatives; calibration `uncalibrated` |

No live provider was called; every model call in the suites is replayed. Nothing in this baseline is
evidence of the quality of live-model 웹소설체.
