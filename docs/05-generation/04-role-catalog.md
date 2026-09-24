# Role Catalog

Every LLM role is registered with: purpose, model class, style sensitivity (Narrative Identity Guard),
manuscript-producing flag (post-call output-language check), pack template, output schema, default budget
(Standard tier), candidate/retry policy. Model classes map to concrete models per environment via the
gateway routing table (`docs/06-system/07-model-gateway.md`); the plan never hardcodes a vendor.

Model classes: **R** reasoning-strong · **P** prose-strong — **natural English under Korean-webnovel
structural constraints** (qualified by the benchmark in the gateway doc §3) · **M** mid (fast, good
structured output) · **C** cheap/classification · **E** embeddings.

| Role | Purpose | Class | Identity block | Manuscript | Pack template | Output schema | Max out tokens | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `requirement_interpreter` | Normalize intake (any language) → Story Spec items (hard/soft/assumption) with English working text | M | — | no | pack.requirements | story-spec.items | 4k | never translates into manuscript |
| `assumption_explainer` | One-line rationale per assumption | C | — | no | inline | strings | 1k | |
| `instruction_injection_classifier` | Flag meta-instructions in user/imported text | C | — | no | inline | label+score | 0.2k | security |
| `concept_generator` | Concept candidate from spec + angle seed (in the manuscript language, ADR-0066) | R | planner_compact | no | pack.concept | concept | 3k | N=2/3 |
| `concept_comparator` | Pairwise comparison of concepts | R | — | no | pack.compare | comparison-verdict | 2k | both orders |
| `concept_merger` | Merge selected fields | M | planner_compact | no | pack.concept | concept | 3k | on request |
| `character_designer` | Cast identities/arcs/secrets | R | planner_compact | no | pack.bible | bible.characters | 6k | |
| `register_profile_designer` | Per-character dialogue register toward counterparts (English rendering rules) + voice profile | P | editor_full | no | pack.bible | register-profile[] | 4k | validated vs genre register norms |
| `world_builder` / `power_system_designer` / `faction_designer` / `location_designer` | Bible sections | R | planner_compact | no | pack.bible | bible.* | 4–6k | numbers-as-facts |
| `naming_registry_compiler` | Display names, romanizations, native-script names, short forms, aliases | M | summarizer_min | no | pack.bible | naming-registry | 3k | mostly deterministic |
| `terminology_policy_compiler` | Per-term translate/romanize/gloss/preserve decisions + fixed spellings | M | summarizer_min | no | pack.bible | terminology-policy | 3k | |
| `identity_binder` | Propose user-preference overrides from tone/preferences | M | — | no | pack.bible | narrative-identity.preferences | 1k | cannot alter contracts |
| `bible_consistency_checker` | Cross-section contradictions | R | — | no | pack.bible | issue[] | 3k | |
| `series_architect` | Series Blueprint | R | planner_compact | no | pack.series_architect | series-blueprint | 8k | N=2 |
| `season_planner` | Season outlines | R | planner_compact | no | pack.series_architect | season[] | 6k | |
| `arc_planner` | Arc plan | R | planner_compact | no | pack.arc_planner | arc-plan | 6k | N=2 Standard |
| `repetition_judge` | Structural repetition vs prior arcs / recent chapters | C→M | — | no | pack.repetition | issue[] | 1.5k | |
| `chapter_planner` | Chapter Contract | R/M | planner_compact | no | pack.chapter_planner | chapter-contract | 5k | +1 repair |
| `plan_continuity_checker` | Validate plan vs canon | M | — | no | pack.chapter_planner | issue[] | 2k | |
| `scene_planner` | Scene plans with pre-resolved English register per speaker pair | M | planner_compact | no | pack.scene_planner | scene-plan[] | 3k | |
| `scene_writer` | **English prose** for one scene | P | writer_full + TAIL | **yes** | pack.scene_writer | scene-draft | words×1.6 | sequential per scene |
| `chapter_assembler` | Seam smoothing + English title | M/P | editor_full | yes | pack.line_editor | seam-patches | 2k | |
| `line_editor` | English polish pass (Premium/on request) | P | editor_full | yes | pack.line_editor | paragraph-patches | 6k | must ack facts |
| `contract_compliance_judge` | Must/must-not/hook/POV | M | — | no | pack.continuity_checker (subset) | scorecard.section | 3k | evidence-first |
| `continuity_checker` | Facts/timeline/location/inventory/injury/rank/world/relationship | R | — | no | pack.continuity_checker | issue[] | 4k | most expensive evaluator |
| `knowledge_leak_checker` | Knowledge leaks / dramatic irony violations | M | — | no | pack.knowledge_leak_checker | issue[] | 3k | |
| `promise_checker` | Setup/payoff handling | C | — | no | pack.promise | promise-status[] | 1.5k | |
| `prose_judge` | **Dimension A**: English fluency, idiom, translation-like syntax, literary/Western diction drift, readability | M (≠ writer family) | judge_rubric_prose | no | pack.prose_judge | prose-report | 3k | |
| `structure_judge` | **Dimension B**: hook, payoff, pacing, exposition, dialogue-forwardness, ending pull, cadence, devices | M (≠ writer family) | judge_rubric_structure | no | pack.structure_judge | structure-report | 3k | absorbs pacing/hook judging |
| `genre_judge` | **Dimension C**: genre-profile adherence | C→M | judge_rubric_genre | no | pack.genre_judge | genre-report | 2k | folded into structure_judge in Economy |
| `voice_judge` | **Dimension D**: character voice + register naturalness | C→M | judge_rubric_prose (register section) | no | pack.voice_judge | issue[] | 2k | folded into prose_judge in Economy |
| `prose_reviser` / `structure_reviser` / `dialogue_reviser` / `continuity_reviser` | Span patches for the respective dimension | P | editor_full | yes | pack.reviser | patch | span×1.5 | acks required |
| `scene_rewriter` | Rewrite one scene (prose or structure mode) | P | writer_full + TAIL | yes | pack.scene_writer | scene-draft | words×1.6 | counts as rewrite |
| `chapter_comparator` | Pairwise candidate judging | R (≠ writer family) | — | no | pack.compare | comparison-verdict | 2k | both orders |
| `change_request_interpreter` | Free text (any language) → patch tasks / contract edits | M | — | no | pack.reviser | change-plan | 2k | |
| `extractor_a` | Entity-first canon extraction | M | — | no | pack.extractor | canon-delta | 8k | |
| `extractor_b` | Event-first canon extraction | M (other family if possible) | — | no | pack.extractor | canon-delta | 8k | |
| `extraction_adjudicator` | Resolve conflicts | R | — | no | pack.adjudicator | adjudication | 2k | conflicts only |
| `summarizer_l1` / `_l2` / `_l3` / `_l4` | Hierarchical English summaries | C/M | summarizer_min | no (working text, checked for language anyway) | pack.summarizer | summary | 0.3–1.5k | accepted text only |
| `title_generator` | English chapter title (genre style) | C | writer_full (compact) | yes | inline | strings | 0.2k | folded into assembler by default |
| `retcon_patcher` | Patch text for a described retcon | P | editor_full | yes | pack.reviser | patch | 4k | |
| `dependency_patch_proposer` (Beta) | Propose patches for stale later chapters | P | editor_full | yes | pack.reviser | patch[] | 4k | |
| `feedback_classifier` (Beta) | Classify sanitized reader feedback | C | — | no | inline (untrusted wrapped) | labels | 0.5k | |
| `json_repairer` | Fix invalid structured output | C | — | no | inline | any | = original | |
| `embedder` | Embeddings for search documents | E | — | no | — | vector | — | per embedding set |

## Routing principles

- **Prose (P)** — the highest-leverage choice. A model enters class P only after the **English-under-KWN
  benchmark** (gateway doc §3): native-quality English *and* faithful serialized structure on the five-class
  contrast set, register rendering accuracy, length control in words. Korean-language ability is **not** a
  selection criterion for P. At least two P-capable models are configured for fallback.
- **Judges** use a **different family** from the writer when available (self-preference mitigation);
  Prose Judge and Structure Judge are separate calls in every tier.
- **Extractors A/B** use different prompts and, where budget allows, different families.
- **R** roles are few per chapter to control cost.
- Any role may be re-routed by the gateway on outage; the audit records the actual model.
- The gateway's Guard applies to every row marked with an identity block; the post-call output-language
  check applies to every row marked Manuscript = yes.
