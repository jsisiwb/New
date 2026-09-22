# Plan Audit

Self-audit of the planning package after the **English-manuscript correction** (ADR-0026). Part 1 audits
the five governing requirements; Part 2 re-audits the original fifteen hard questions; Part 3 records the
contradiction review and gap review; Part 4 cross-checks invariants. Each answer names the mechanism, the
document, the schema and the test.

## Part 1 — Governing requirements

### OUTPUT-LANG-001 — Reader-facing manuscripts are composed directly in the project manuscript language (en or ko, ADR-0054).
- **Mechanism:** the Output-Language Profile (`lang/en`) renders the Output-Language Contract first in
  every Narrative Identity Block; manuscript-producing roles are flagged and their outputs pass a
  deterministic output-language check (English ≥ 0.99 on prose segments, registry romanizations excluded)
  before any other evaluation; `manuscript_versions.language` is constrained to `en`; the scene-draft
  envelope carries `language: "en"`.
- **Docs:** `02-narrative-identity/01` §2–5; `05-generation/01` §4 step 2; `06-system/07` §1.
- **Schema:** `common.manuscriptLanguage`, `scene-draft.language`, `llm-call-record.output_language_check`.
- **Test:** §2 language-id unit tests; §4 failure path (Korean mock output discarded → regenerate →
  reroute); §5 `scene_writer` 20/20; §7 long-form zero failures.

### STYLE-KWN-001 — Manuscripts use Korean serialized-webnovel conventions regardless of language.
- **Mechanism:** the Narrative-Tradition Profile (`tradition/kr-webnovel`) carries the language-neutral
  structure rules (hook timing, local payoff, cadence, exposition control, dialogue-forwardness, ending
  pull, serial devices) and the Narrative-Tradition Contract; planners consume the compact block so contract
  shape fields (hook/opening/ending types, payoff, scene count) are validated before drafting; Structure Lint
  and the Structure Judge score adherence as dimension B.
- **Docs:** `02-narrative-identity/01` §3.2, §6; `02` §2; `03-genre-catalog`; `03-story-planning/01`.
- **Schema:** `narrative-identity.tradition`; `chapter-contract` shape fields; `scorecard.sections.structure`.
- **Test:** §2 structure lint on `western_english`/`weak_serial`; §5 structure_judge goldens; §6 contrast sets.

### STYLE-GUARD-001 — Every style-sensitive call receives both contracts.
- **Mechanism:** the Narrative Identity Guard rejects style-sensitive calls unless the block manifest
  carries both contract hashes, the block hash matches the compiler, and the header is embedded; the pack
  validator checks `both_contracts_present` before the call; both hashes are persisted per call.
- **Docs:** `02-narrative-identity/01` §5; `06-system/07` §1; `04-memory-canon/04` §2.7. **ADR:** 0027.
- **Schema:** `context-pack-manifest.narrative_identity_block`, `llm-call-record` contract hash fields.
- **Test:** Guard unit tests (missing either contract rejected); pack validation tests.

### EVAL-SEPARATION-001 — English fluency and structural adherence are separate dimensions.
- **Mechanism:** Prose Judge (dimension A) and Structure Judge (dimension B) are separate calls with separate
  rubrics in every tier (Economy folds genre into structure and voice into prose, never prose into
  structure); scorecards have separate sections and separate gates; issues and patches carry a `dimension`;
  revisers are dimension-specific; regression forbids cross-dimension regression.
- **Docs:** `02-narrative-identity/01` §6; `05` §1–4; `05-generation/02`.
- **Schema:** `common.qualityDimension`; `scorecard.sections` (prose + structure required); `issue.dimension`.
- **Test:** §5 goldens; §6 dimension-targeted repair; contrast set expectations (`western_english` passes A,
  fails B; `translation_like` fails A).

### NO-TRANSLATION-001 — No Korean prose is generated and translated.
- **Mechanism:** all prompts are English and ask only for English; no role, workflow step or fallback
  produces non-English manuscript text; the post-call output-language check catches any violation;
  translation-like English is itself a detected drift class; the repository validator scans for
  contradictory statements.
- **Docs:** `05-generation/01` §1, §4; `05-generation/03` §2, §7. **ADR:** 0026, 0027.
- **Test:** §4 failure path; §5 assertions; `tools/validate-planning-package.py` contradiction scan.

## Part 2 — The fifteen questions (re-audited after correction)

| # | Question | Mechanism (unchanged unless noted) | Docs |
| --- | --- | --- | --- |
| 1 | Remember previous chapter exactly | T1 verbatim tail (~400 words) + L1 + hook + committed deltas; tail hash validated | `04-memory-canon/04` §4 |
| 2 | Retrieve from hundreds of chapters ago | structured state + English FTS with registry thesaurus + pgvector (per-model sets) + graph hops; evidence quotes | `04-memory-canon/05` |
| 3 | Know what each character knows | knowledge ledger (knower × proposition × stance × source × validity) | `04-memory-canon/03` |
| 4 | Truth/belief/suspicion/lies/secrets | stances + `lie` frame + secrets; **truth per timeline** (ADR-0031) | `04-memory-canon/03` §2 |
| 5 | Future plans vs completed events | plan tables labelled `[PLANNED]`; extraction confirms hypotheses; no future validity | `04-memory-canon/02` §3 |
| 6 | Rejected drafts never enter canon | `assert_extractable`, quarantine tables, allowlists, FKs, nightly assertion | `04-memory-canon/02` §7 |
| 7 | Approved chapter updates memory | A ∥ B ∥ pre-pass → reconcile → adjudicate → verify → atomic commit → post-commit (+ edge promotion) | `04-memory-canon/02` §5 |
| 8 | Conflicting extractions resolved | deterministic match → adjudicator → human queue | `04-memory-canon/02` §5.2 |
| 9 | Earlier chapter changes propagate | **material** dependency edges → stale; contextual → review-suggested (ADR-0032) | `04-memory-canon/02` §8–9 |
| 10 | Every relevant call preserves the narrative identity | Narrative Identity Guard with **both** contracts; IDENTITY_TAIL; planners get structure rules | `02-narrative-identity/01` §3–5 |
| 11 | Detect drift | English Prose Lint + Structure Lint + register check + Prose/Structure/Genre/Voice judges; five-class contrast set | `02-narrative-identity/04`, `05` |
| 12 | Repair locally | dimension-targeted patch-first revision with regression | `02-narrative-identity/05` §3 |
| 13 | Reliability | Temporal, idempotency, leases, budgets, chaos suite; output-language failure path added | `06-system/04` |
| 14 | Cost | hard limits, tiers, caching, early stop; cost per 1,000 words | `06-system/05` |
| 15 | Another agent can begin | handoff guide (reading order starts with ADR-0026), roadmap, backlog, schemas, English fixture | `08-delivery/05` |

## Part 3 — Contradiction review (resolved during the correction)

| Found (first plan) | Resolution |
| --- | --- |
| "output always Korean", "natively Korean prose", Korean prose model benchmark | Replaced by OUTPUT-EN-001; P-class benchmark = natural English under Korean-webnovel constraints |
| `text_ko`, `summary_ko`, `statement_ko`, `canonical_name_ko`, … in schemas/docs/examples | Renamed to language-neutral fields; `language`/`text_en` metadata where language varies; `display_name`/`native_script_name`/`romanization` for entities |
| English treated as leakage (`KL-LANG-01`, `english_leakage`) | Removed; `EP-LANG-01` now blocks **non-English**; `EP-TERM-03` blocks Korean script outside preserve contexts |
| Korean lint (sentence-ending repetition, pronoun omission, honorific morphology, Korean punctuation) applied to manuscripts | Replaced by English Prose Lint (EP-*), Structure Lint (ST-*) and an English register check (RG-*) |
| Korean speech-level enforcement (`speechLevel`, `speech_profiles`) | Replaced by abstract Dialogue-Register Policy rendered in English (`dialogueRegister`, `register-profile`) |
| Korean character counts (5,500 chars, 공백 포함), cost per 1,000 Korean characters | Language-neutral length model; words as author-facing unit (2,500 default); cost per 1,000 words; no mechanical conversion (ADR-0034) |
| Korean NLP sidecar (Kiwi/MeCab) | Removed; `packages/prose` + optional English grammar service (ADR-0028) |
| Korean-only fixture prose, Korean UI-first, Korean editor panel | English fixture (*Second Awakening*) with English names via the naming policy; English UI first; bilingual reviewer panel on two scales |
| Single global `truth_value` | `truth[]` per timeline (ADR-0031) |
| Ambiguous evidence offsets | Unicode code-point addressing across runtimes (ADR-0030) |
| Undifferentiated dependency edges | material vs contextual (ADR-0032) |
| Raw hard-requirement list in T0 | Active Constraint Set with cap (ADR-0033) |
| Fixed `vector(1024)` column | per-model embedding sets (ADR-0035) |
| Broad MVP | vertical slice (ADR-0036) |
| Thresholds stated as truths | starting values with calibration status (ADR-0029) |
| Glossary "Style Block/Style Guard" naming | Narrative Identity Block / Guard throughout; superseded ADRs annotated |

The repository validator (`tools/validate-planning-package.py`) now fails on any reintroduction of these
patterns outside the ADRs and audit documents that describe the change.

## Part 4 — Gap review

| Potential gap | Status |
| --- | --- |
| Genre with Western-style names (romance fantasy) still needing Korean-webnovel structure | Covered: Naming Profile `western` + tradition contract unchanged; genre judge notes warn against Regency pastiche |
| Korean cultural behaviors (seniority deference) in English | Covered: Setting profile `preserve_behaviors_localize_language`; register policy renders deference via titles/tone, not grammar |
| Korean craft terms in prompts confusing the model into Korean output | Covered: terms appear glossed and only in the identity block/registry; output-language check is the backstop |
| Users asking for Korean output via directions | Covered: contracts are configuration; such directions are rejected at intake (`05-generation/03` §7) |
| Word-count calibration for "episode feel" | Covered as an implementation requirement (ADR-0034), not a fixed conversion |
| Grammar checking precision without a service | Covered: heuristics + Prose Judge in MVP; optional service in Beta (ADR-0028) |
| Multi-POV and reader-knowledge union | Covered (unchanged) |
| Ensemble casts exceeding pack budgets | Covered (degradation ladder) |
| Legal review of genre profiles' abstract conventions | Recommended before Beta (open item) |

## Part 5 — Invariant cross-check

| Invariant | Design | Schema/DB | Test |
| --- | --- | --- | --- |
| English output, composed directly | `02-narrative-identity/01` §3.1, §5 | `manuscriptLanguage`; DB CHECK; language check record | §2, §4, §5, §7 |
| Both contracts on every style-sensitive call | `02-narrative-identity/01` §5 | manifest + llm_calls hashes | Guard tests |
| Separate prose/structure evaluation | `05-generation/02` | `qualityDimension`; scorecard sections | §5, §6 |
| No translation step | `05-generation/01` §1 | `manuscript_producing` flag; language check | §4; validator scan |
| Canon from accepted only | `04-memory-canon/02` §4, §7 | `assert_extractable`; partial unique accepted | T16 |
| Atomic commit | `02` §5.4 | `canon.commit_delta` | fault injection |
| Evidence-backed, code-point offsets | `02` §1.1 | evidence trigger | conformance vector |
| Planned ≠ happened; frames; truth per timeline | `02` §3, §1.6; `03` §2.1 | `realityFrame`; `proposition.truth[]` | T7, T8, T15; P5 tests |
| Quarantine | `02` §7 | quarantine tables; FKs | T16 |
| Prompt versioning | `05-generation/03` | `prompt_version_id` | registry tests |
| Pack snapshots + Active Constraint Set | `04` §1, §2.5, §2.7 | manifest validation fields | determinism tests |
| Durable checkpoints | `06-system/04` | idempotency keys | chaos suite |
| Material dependency edges | `02` §8 | `materiality`, `basis` | R1 |
| Calibrated thresholds | `02-narrative-identity/02` §11 | `calibration` | Phase 4 calibration round |
| Tenancy | `06-system/06` §3 | RLS | RLS matrix |
| Korean as terminology only | AGENTS.md; `02-narrative-identity/02` §7 | terminology registry; `EP-TERM-03` | T26, T27 |

## Part 6 — Confirmation

Implementing the revised plan produces **English-language novels**, composed directly in English, whose
structure, pacing, hooks, payoff cadence, dialogue-forwardness, exposition control and genre conventions
follow the **Korean serialized-webnovel tradition** — with no Korean prose generated at any stage and no
translation step. This is enforced at generation (both contracts on every style-sensitive call), at the
gateway (fail-closed Guard + output-language check), at evaluation (separate prose and structure gates), at
repair (dimension-targeted patches), in the schemas (English manuscript language, language-neutral fields),
in the fixture (English prose in Korean-webnovel form), and in the repository validator (contradiction
scan).
