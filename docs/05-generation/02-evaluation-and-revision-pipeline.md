# Evaluation and Revision Pipeline

## 1. Evaluation model

Two kinds of checks, one issue format:

- **Deterministic checks** (`packages/prose`, `packages/narrative`, `packages/canon`): schema validity,
  truncation, **output-language check** (per manuscript language, ADR-0054), language-aware length
  gate (words for en, characters for ko), Prose Lint (EP-*), Structure
  Lint (ST-*), register check (RG-*), naming/terminology registry, forbidden lexicon, format drift,
  repetition (intra/cross-chapter simhash), status-window grammar, required-scene markers (contract
  `verifiable_by` patterns), numeric consistency for status-window numbers vs facts.
- **Model-based evaluators** (roles): contract compliance, continuity (facts/timeline/location/inventory/
  injury/rank/world & power rules/relationships), knowledge leakage, promise handling, **Prose Judge**
  (English prose quality), **Structure Judge** (Korean-webnovel structural adherence incl. pacing & hook),
  **Genre Judge**, **Voice Judge**, repetition (semantic). Prose and structure are always separate
  evaluations and separate scorecard sections (EVAL-SEPARATION-001).

`Issue` (schema `issue.schema.json`):
```
{ id, source: lint|register|judge:<role>, dimension: prose|structure|genre|voice|continuity|knowledge|
  promise|contract|repetition|length|output_language, kind, severity: blocking|major|minor|note, confidence 0..1,
  claim, chapter_span: { manuscript_version_id, paragraph_ids[], start, end (code points), quote },
  conflicting_canon: [{ kind: fact|event|knowledge|relationship|promise|requirement|plan, id, statement }],
  canon_evidence: [{ manuscript_version_id, chapter_no, quote, start, end }],
  repair: { scope: sentence|paragraph|dialogue|scene|chapter|plan|canon, suggestion, must_preserve_fact_ids[] },
  status: open|patched|overridden|dismissed, override_reason?, resolved_in_version_id? }
```
Issues lacking a resolvable `chapter_span` are capped at `note`. Issues asserting a canon conflict must cite
≥ 1 `conflicting_canon` **and** ≥ 1 `canon_evidence` (or the canon item must be `source=bible/locked`); else
they are downgraded to `minor` with `unsupported=true` (never block on unsupported criticism).

## 2. Evaluator specifications

| Evaluator | Detects | Inputs (pack) | Output specifics |
| --- | --- | --- | --- |
| `contract_compliance_judge` | missing must_happen, present must_not_happen, required scene absence, hook/opening type mismatch, POV violation, emotional movement unmet | contract + chapter text | per criterion: pass/fail + evidence paragraph IDs |
| `continuity_checker` | contradictions with facts (identity, location, injury, inventory, rank, resources, abilities), timeline errors (elapsed time, impossible travel, day/night), world-rule & power-system violations, relationship inconsistency (trust/affection direction, address term, dialogue register vs canon) | chapter text, participant state tables with evidence, locked facts, retrieved older events, timeline position, world rules slice | each issue cites the chapter span and the canonical fact/event + evidence quote |
| `knowledge_leak_checker` | character acts/speaks on knowledge they lack; character unaware of what they know; reader-knowledge violations (spoiling planned reveals) | chapter text, knowledge table for participants, guards, secrets | issue per leak with ledger row IDs |
| `promise_checker` | payoff without setup; planned setup/payoff missing; promise contradicted | contract setups/payoffs, promise ledger slice, extraction pre-pass | status per promise |
| `prose_judge` | English fluency/idiom problems, translation-like syntax, literary or Western diction drift, readability | `judge_rubric_prose` block, text, prose lint report | dimension A scores, drift flags (`translation_like`, `literary`), issues |
| `structure_judge` | late/weak hook, weak ending, exposition drag, scene sag, missing local payoff, cadence loss, Western-novel pacing | `judge_rubric_structure` block, text, structure lint report, contract shape fields | dimension B scores, drift flags (`western_novel`, `serial`), issues |
| `genre_judge` | reader fantasy not delivered, devices misused, vocabulary register off, taboo overuse | `judge_rubric_genre` block, text, terminology compliance | dimension C |
| `voice_judge` | indistinguishable voices, lost verbal habits, register unnatural or inconsistent with policy | register section, utterances with speaker annotations, register digests, voice exemplars, register check | dimension D |
| `repetition_judge` | scene/arc-level repetition vs recent L1/L2 summaries; repeated jokes/beats | chapter L1 (from pre-pass) + last 10 L1s + current arc L2 | issues with references |

Judges are **evidence-first**: output schemas place `evidence` before `verdict/score`.

## 3. Severity policy

| Severity | Examples | Effect |
| --- | --- | --- |
| blocking | **non-English prose segment**; Korean script outside preserve contexts; contradiction with locked fact; knowledge leak of a secret; forbidden development present; content restriction violation; format drift (screenplay); truncation; required scene missing; register error toward royalty/superiors in strict genres | cannot be approved; must patch or regenerate. Override class `never` for objective corruption, `canon_workflow` for locked-fact/hard-requirement conflicts (ADR-0042) |
| major | contradiction with unlocked fact without narrated change; injury/inventory/rank mismatch; timeline impossibility; payoff without setup; register/address-term mismatch; translation-like or Western-novel drift ≥ `policy.gates.drift_flag_scene_repair_ratio` of paragraphs; repeated paragraph; must_happen partially met; unapproved untranslated term | must patch, or `reviewer` override with recorded reason where the override matrix allows it; a fact-bearing override opens a correction proposal (ADR-0042) |
| minor | lint warns; weak ending (judge medium confidence); exposition run; low-confidence continuity doubts | advisory; auto-patched if cheap and safe (lint-only) |
| note | unsupported criticism; suggestions | logged |

Confidence gating: model-based issues below `policy.gates.judge_confidence_caps.minor_below` (starting 0.5) are capped at `minor`; below `note_below` (0.3) at `note`.
Two independent judges agreeing (Premium) raises confidence by fusion.

## 4. Revision (patch-first)

```
Scorecard issues (open) ─► cluster by span (overlapping/adjacent paragraphs; same scene) and by dimension
  ─► order: blocking → major → minor; continuity/knowledge before structure before prose (content, then
     shape, then polish)
  ─► for each cluster: choose reviser role by dominant dimension
        continuity_reviser (facts/timeline/knowledge)  · dialogue_reviser (register/voice)
        structure_reviser (hook/ending/exposition/payoff) · prose_reviser (English prose issues)
        scene_rewriter (scene-scope; prose or structure mode)
  ─► pack.reviser: editor block (both contracts), span ± 1 paragraph (scene plan for scene scope), issues +
     repair hints, must_preserve facts (IDs + statements + quotes), register digests, length budget, registry
  ─► reviser output { span_id, new_text, changed_claims[], preserved_facts_ack[], speaker_annotations[] }
  ─► deterministic gate: output-language check; acks complete; length within ±15% (scene ±10%); registry;
     prose + structure lint on new text; register on new utterances; no new forbidden lexicon
  ─► apply → new manuscript version (parent link, patch record)
  ─► regression: re-run affected checks (see below); compare scorecards; revert patch on regression
  ─► loop until no blocking/major or round limit
```

### 4.1 Which checks re-run after a patch
| Patch scope | Re-run |
| --- | --- |
| sentence/paragraph, `changed_claims=[]` | output-language check; prose/structure lint + register on span±1; repetition intra-chapter |
| sentence/paragraph, `changed_claims≠[]` | + continuity_checker on the span (delta mode: only changed claims), knowledge_leak_checker if any claim involves a proposition |
| dialogue | + voice_judge on changed utterances |
| scene | full deterministic chapter checks + continuity_checker (full) + prose_judge and structure_judge (scene) + contract_compliance (affected criteria) |
| ≥ 3 patches cumulative | prose_judge and structure_judge whole chapter (smoke) + repetition (cross-chapter) |

### 4.2 Limits (Production Policy, ADR-0041)
All limits come from the pinned policy: `policy.revision.max_rounds` (starting values: economy 2 /
standard 3 / premium 4), `policy.revision.max_patches_per_round` (6), `policy.revision.max_scene_rewrites`
(standard 2), `policy.revision.per_span_attempts` (2 → escalate scope), `policy.revision.smoke_after_patches`
(3), `policy.revision.regression_tolerance_points` (3). Files: `examples/production-policies/*.v1.json`.
Exhaustion → `needs_attention` with the residual issues, suggested action (regenerate / approve with an
override permitted by the override matrix, ADR-0042 / edit manually).

## 5. Candidate comparison (when N > 1)

- Same pack, same prompt, different seeds/angles (diversity hint for creative steps only; none for
  evaluators).
- Each candidate goes through steps [2]–[6]; only candidates with no blocking issues are compared.
- `chapter_comparator` receives both texts + both scorecards + contract; asked for per-dimension
  preferences (contract fit, continuity risk, English prose quality, serialized structure, hook, emotional
  impact) with evidence; run in **both
  orders**; consistent winner → pick; inconsistent → third run with shuffled dimension order, majority;
  still tied → higher scorecard; still tied → cheaper (fewer patches).
- Early stop (per dimension, never an aggregate): if a candidate is already auto-approvable and exceeds
  **every** gated dimension's threshold by `policy.candidates.early_stop_margin_points` (starting value 6),
  skip generating further candidates (budget saver).

## 6. Human review integration

Review UI shows: manuscript (mobile view), scorecard with separate prose/structure/genre/voice/continuity
sections, issues (with the evidence links), patch history
(diff per version), candidate comparison, extraction preview (proposed delta). Actions produce signals to
the waiting workflow: `approve`, `request_changes(text)` → `change_request_interpreter` (cheap) converts to
patch tasks (scoped) or, if it invalidates the contract, to a contract edit + regeneration proposal;
`reject(reason)`; `override(issue_ids, reason)`.

## 7. Calibration & regression of evaluators

- Golden fixtures with seeded issues (fixture story traps) → every evaluator prompt version must reach
  recall ≥ 0.9 on blocking traps, precision ≥ 0.8 on major; measured in the prompt regression suite.
- Prose Judge and Structure Judge are calibrated on the five-class contrast set: the `kwn_english` variant
  must score highest on both dimensions; `western_english` must fail structure while passing prose;
  `translation_like` must fail prose (`05-drift-detection-and-repair.md` §7).
- Human override rates per evaluator per kind tracked; > 30% override on a kind → prompt/threshold review.
