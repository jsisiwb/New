# Risk Analysis

Likelihood (L) / Impact (I): 1 low – 3 high. Owner = subsystem.

| # | Risk | L | I | Mitigation (planned) | Residual / trigger to revisit |
| --- | --- | --- | --- | --- | --- |
| R1 | Prose model produces **translation-like English** (calques, dropped articles, honorific morphemes) when pushed toward Korean-webnovel form | 3 | 3 | Output-Language Contract first in every block; EP-TRN/EP-HON lint + Prose Judge; prose_reviser; P-class benchmark requires natural English on the contrast set; exemplar bank of accepted English passages | If `prose_score` median < 75 after exemplar bank ≥ 50 items → routing review |
| R2 | Prose model drifts to **Western-novel pacing** (slow openings, literary interiority, reflective endings) when asked for fluent English | 3 | 3 | Narrative-Tradition Contract; structure lint + Structure Judge as a separate gate; structure_reviser; planner enforces hook/ending types; contrast set includes `western_english`/`literary` | If `structure_score` median < 75 → tradition profile/prompt work |
| R3 | Judges conflate dimensions (reward polish, forgive pacing; or vice versa) | 2 | 3 | Separate Prose/Structure judges with separate rubrics; different model family from writer; five-class contrast set; bilingual reviewer panel on two scales | Spearman < 0.7 on either scale → rubric revision |
| R4 | Model emits Korean or mixed-script prose | 2 | 3 | Deterministic output-language check (blocking); regenerate-then-reroute; registry allowlist for romanized terms | any occurrence investigated; > 1% → routing change |
| R5 | Extraction misses or hallucinates canon items | 2 | 3 | two extractors + deterministic pre-pass; evidence verification (code points); adjudication; human queue for majors; fixture recall tests | disagreement > 25% → prompt work / model change |
| R6 | Context pack misses a critical old fact | 2 | 3 | T1 structured states from canon for participants; hybrid retrieval; evidence quotes; continuity checker as second net; recall tests | recall@pack < 0.9 on fixture → ranker tuning / reranker |
| R7 | Token budgets too small for ensemble casts / long constraint sets | 2 | 2 | degradation ladders; Active Constraint Set cap with `CONSTRAINTS_OVERFLOW`; contract size limits | frequent overflows → raise budgets/model ctx |
| R8 | Cost per chapter exceeds expectations | 2 | 2 | tiers; caching; early stop; hard limits; prediction calibration in words | cost > 1.5× tier envelope for 10 chapters → routing review |
| R9 | Provider outages/rate limits stall batches | 2 | 2 | ≥ 2 providers per class; circuit breakers; pause/resume | — |
| R10 | Temporal operational complexity | 2 | 2 | Temporal Cloud option; dev server for local; rehydrate-from-artifacts fallback | — |
| R11 | English register rendering feels stilted or inconsistent (formality expressed unnaturally) | 2 | 2 | Dialogue-Register Policy rendering rules + anti-patterns; register check; Voice Judge; register cases in the contrast set; reviewer feedback | register violation rate > 2/100 utterances → policy/prompt work |
| R12 | Over-rigid planning produces dull chapters | 2 | 2 | rolling horizon; candidates for arcs; repetition judge; directions; reader feedback (Beta) | reviewer "fun" ratings low → planner prompt work |
| R13 | Knowledge ledger too granular → extraction noise | 2 | 2 | propositions limited to contract/secret-relevant + extractor thresholds; dedupe by embedding + adjudication | ledger growth > 100 props/chapter → tighten rules |
| R14 | Retcon propagation overwhelming users (too many stale items) | 2 | 2 | material vs contextual dependency edges (ADR-0032); grouped stale reasons; MVP mark-only; Beta patch proposals | stale count per retcon > 20 → tune promotion rules |
| R15 | Prompt injection via requirements/imports (incl. attempts to switch output language) | 1 | 3 | classifier; untrusted wrapping; contracts are configuration, not free text; gates on outputs consuming untrusted text | — |
| R16 | Copyright exposure (similarity to existing works or their English translations) | 1 | 3 | provenance-only exemplars; no imitation instructions; similarity screening (Beta); trope-level genre profiles | — |
| R17 | Data breach of unpublished manuscripts | 1 | 3 | RLS; envelope encryption; secret manager; audit; provider privacy allowlist | — |
| R18 | Schema churn destabilizes generated types | 2 | 1 | schema-first discipline; versioned schemas; contract tests | — |
| R19 | Regression/possession timeline semantics confuse extraction | 2 | 2 | explicit frames + timeline IDs + per-timeline truth (ADR-0031); genre-specific extractor guidance; fixture traps T7/T8/T15 | — |
| R20 | Human review becomes the bottleneck | 2 | 2 | Semi-auto per-dimension gates (ADR-0041); keyboard-first queue; policy approval for clean chapters | — |
| R21 | Model updates change behavior silently | 2 | 2 | pinned model versions in routing; regression suite (incl. contrast sets) on model change | — |
| R22 | Length control drift (chapters too long/short (words for en, characters for ko)) | 2 | 1 | scene-level word targets; tolerance; continuation protocol; length model calibration | — |
| R23 | Thresholds treated as truths and never calibrated | 2 | 2 | calibration status on every threshold (ADR-0029); Phase 4 calibration round; UI shows status | any `uncalibrated` threshold in Production → flag |
| R24 | Offset mismatch across runtimes corrupts evidence/highlights | 1 | 3 | single code-point addressing standard + conformance vector in every runtime (ADR-0030) | — |
| R25 | Embedding provider change breaks retrieval | 1 | 2 | per-model embedding sets with atomic active flip (ADR-0035) | — |
| R26 | Bilingual reviewers (native English judgment + Korean webnovel literacy) are scarce | 2 | 2 | two-scale protocol allows separate reviewer pools per scale if needed; contrast sets reduce dependence on panels | — |
