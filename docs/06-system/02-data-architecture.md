# Data Architecture

Postgres 16 + pgvector is the single system of record (ADR-0002). Every tenant table has `workspace_id`
(RLS), `id uuid` (UUIDv7), `created_at timestamptz`, and where mutable `updated_at`. Text columns are NFC;
all offsets are Unicode code points (ADR-0030). Text fields are language-neutral; fields whose language
may vary carry a `language` code. Manuscript text is English.
Schemas below are logical; column types abbreviated. JSON Schemas in `schemas/` define the shape of JSONB
payloads and API objects.

## 1. Tenancy & access

- `workspaces(id, name, plan, settings_json, data_key_ref)`
- `users(id, email, name, locale, mfa_enabled)`
- `memberships(workspace_id, user_id, role: owner|editor|viewer)`
- `sessions`, `api_keys(workspace_id, hashed_key, scopes, expires_at)`
- `audit_log(id, workspace_id, actor_user_id|actor_job_id, action, target_kind, target_id, payload_json,
  created_at)` append-only.

## 2. Project & requirements

- `projects(id, workspace_id, title, status, operating_mode, quality_tier, settings_json (horizons,
  tolerances, length_target_json {unit:'words', value, tolerance_ratio}), canon_version int, prompt_set_id,
  narrative_identity_version_id, output_language 'en', spelling_locale, current_spec_version)`
- `story_spec_versions(id, project_id, version, created_by, summary)`
- `requirements(id, project_id, spec_version_from, spec_version_to|null, kind: hard|soft|assumption,
  category, text, language (code of the original text), text_en (English working paraphrase when the
  original is not English), structured_json, provenance: user|system_default|model_inferred,
  confirmed_by_user bool, scope_json)`
- `active_constraint_sets(id (content-addressed UUIDv8 of content_hash), project_id, chapter_no, spec_version,
  content_hash, rendered_text, item_ids[], token_count, hard_count)` — compiled per chapter, immutable
  (ADR-0033, ADR-0045)
- `directions(id, project_id, text, language, text_en, kind, scope_json, effective_from_chapter, spec_version)`
- `content_restrictions(project_id, rating, forbidden_themes[], lexicon_ref)`

## 3. Bible & entities

- `entities(id, project_id, type, display_name, native_script_name|null, romanization|null, short_forms text[],
  aliases text[], status, created_from, merged_into_id)`
- `entity_versions(id, entity_id, version, fields_json, bible_version, created_by)` (descriptive fields;
  canonical *state* lives in `facts`)
- `register_profiles(id, character_id, version, profile_json)` (dialogue-register & voice baseline; dynamic
  changes are `register.*` facts / relationship_states)
- `terminology_terms(id, project_id, source_term, source_language, decision: translate|romanize|
  gloss_first_use|preserve_script, english, romanized, gloss, preserve_contexts[], aliases[], entity_id)`
- `bible_versions(id, project_id, version, approved_by, approved_at, checker_report_json)`
- `narrative_profile_versions(id, project_id|null (global for language/tradition/genre), kind: output_language|
  tradition|genre|setting|naming|register_policy|terminology|preferences|composed, profile_json,
  content_hash, parent_refs[], calibration_json)`
- `narrative_block_cache(hash pk, identity_version_id, role, budget, text, manifest_json,
  output_language_contract_hash, tradition_contract_hash)`
- `exemplars(id, project_id, function_tag, text, language 'en', source: accepted_chapter|user_owned|licensed|synthetic,
  manuscript_version_id|null (FK, must be accepted), provenance_json, score, active)`

## 4. Plans

- `series_blueprints(id, project_id, version, blueprint_json, status, approved_at)`
- `seasons(id, project_id, blueprint_version, ordinal, plan_json, status)`
- `arcs(id, project_id, season_id, parent_arc_id|null, kind: major|minor, ordinal, plan_json, status,
  chapter_range_est int4range, stale bool, stale_reasons_json)`
- `chapter_contracts(id, project_id, chapter_id, version, contract_json, status, canon_version_planned_at,
  validation_json, stale bool, stale_reasons_json)`
- `scene_plans(id, contract_id, version, plan_json)`
- `promises(id, project_id, type, statement, importance, status, opened_chapter_id|null, opened_plan_ref,
  due_min_chapter, due_max_chapter, arc_ref, related_entity_ids[], related_proposition_ids[])`
- `promise_events(id, promise_id, kind: opened|advanced|paid|abandoned|rescheduled, chapter_id,
  evidence_span_ids[], commit_id, note)`

## 5. Chapters & manuscripts

- `chapters(id, project_id, number, title, status, accepted_version_id|null, current_contract_id, lease_job_id)`
- `manuscript_versions(id, chapter_id, version_no, origin: assembled|revision|candidate|retcon|imported,
  status: working|approved|accepted|superseded|retconned|rejected, language 'en', text, length_json (words,
  code_points, paragraphs, sentences, est_tokens, est_reading_seconds), content_hash, parent_version_id,
  created_by_job_id, scorecard_id, approved_at, approved_by, accepted_commit_id, meta_json)` (ADR-0037)
  — partial unique index `(chapter_id) WHERE status='accepted'`; `approved`/`accepted`/`superseded`/
  `retconned` rows are immutable (trigger rejects UPDATE of `text`; `status` may only advance along the
  lifecycle).
- `quarantine_versions(...)` same shape with `status='rejected'`; receives rejected working versions (moved
  by workflow); no FKs from canon tables may point here (enforced by FK targets).
- `patches(id, from_version_id, to_version_id, span_json, issue_ids[], reviser_call_id, regression_json)`
- `evidence_spans(id, manuscript_version_id, start int, end int, quote, quote_hash)` — `start`/`end` are
  code-point offsets; trigger validates quote equality (ADR-0030).

## 6. Canon

- `timelines(id, project_id, name, kind: main|prior_loop|alternate|source_story, parent_timeline_id|null,
  divergence_clock_json|null)` — `source_story` timelines have no parent/divergence (ADR-0039)
- `canon_commits(id, project_id, version, parent_version, source, chapter_id, manuscript_version_id,
  delta_json, inverse_json, actor_json, item_counts_json)` unique `(project_id, version)`.
- `facts(id, project_id, timeline_id, entity_id, attribute, key text|null, value_json, value_text,
  valid_from_json, valid_to_json|null, valid_from_ord bigint, valid_to_ord bigint|null (derived narrative
  ordering keys `chapter_no × 1,000,000 + ordinal`, ADR-0040), asserted_at_version int, retracted_at_version
  int|null, source, confidence, locked bool, frame,
  commit_id, superseded_by_fact_id|null)`
  indexes: `(project_id, entity_id, attribute, valid_from_ord)`, partial `WHERE retracted_at_version IS NULL`.
- `fact_evidence(fact_id, evidence_span_id)`
- `events(id, project_id, timeline_id, clock_start_json, clock_end_json, narrated_at_json|null, clock_ord bigint, frame, type,
  summary, location_id, asserted_at_version, retracted_at_version, commit_id, source_chapter_id,
  narrated_in_chapter_ids[])`
- `event_participants(event_id, entity_id, role)`
- `event_evidence(event_id, evidence_span_id)`
- `propositions(id, project_id, statement, kind, secret_json|null, linked_fact_ids[], linked_event_ids[],
  created_commit_id)`
- `proposition_truths(id, proposition_id, timeline_id, value: true|false|unknown, valid_from_json|null,
  valid_to_json|null, valid_from_ord, valid_to_ord, asserted_at_version, retracted_at_version, commit_id)`
  — truth is per timeline (ADR-0031); unique `(proposition_id, timeline_id, valid_from_ord)` among
  non-retracted rows
- `knowledge_states(id, project_id, timeline_id, knower_id (entity or pseudo), proposition_id, stance,
  believed_value, pretend_target_ids[], certainty, source_json, valid_from_json, valid_to_json,
  valid_from_ord, valid_to_ord, asserted_at_version, retracted_at_version, commit_id)`
- `knowledge_evidence(knowledge_state_id, evidence_span_id)`
- `relationship_states(id, project_id, timeline_id, from_entity_id, to_entity_id, type, axes_json (trust,
  affection, respect, hostility, dependency), power_dynamic, register_json (formality, deference, familiarity,
  intimacy, directness, contractions, public_variant), address_terms[], titles[], valid_from…,
  asserted…, commit_id)`
- `relationship_evidence(...)`
- `summaries(id, project_id, tier: L1|L2|L3|L4, scope_kind, scope_id, chapter_from, chapter_to,
  manuscript_version_id (L1: required, must be accepted — trigger), text, ending_hook, language 'en',
  canon_version, prompt_version_id, content_hash)` — one L1 per accepted version
- `dependency_edges(id, project_id, dependent_kind, dependent_id, canon_item_kind, canon_item_id,
  canon_version_read, materiality: material|contextual, basis: contract_anchor|t0|t1_state|claim_reference|
  retrieved_t2|promoted_by_user)` index on `(project_id, canon_item_kind, canon_item_id, materiality)`
  (ADR-0032).
- `stale_marks(id, project_id, target_kind, target_id, reason_json, created_commit_id, resolved_at)`
- `target_leases(project_id, target_kind, target_id, job_id, expires_at)` PK `(project_id, target_kind, target_id)`.

## 7. Search & retrieval

- `search_documents(id, project_id, kind: chapter_paragraph|summary_l1|event|proposition|evidence_quote,
  ref_kind, ref_id, ref_key, chapter_no, clock_ord, timeline_id, entity_ids[], importance, text, language 'en',
  tsv tsvector (generated), manuscript_version_id|null (must be accepted — BEFORE trigger; rows are deleted
  when the version leaves `accepted`), canon_version_added)` unique `(project_id, kind, ref_id, ref_key)`;
  indexes: GIN(tsv), GIN(entity_ids), btree(project_id, clock_ord). `tsv` uses the `english` configuration;
  a per-project thesaurus dictionary for registry names/terms follows (ADR-0045). Functions
  `canon.index_accepted_version(version)` (idempotent) and `canon.reindex_project(project)`.
- `embedding_sets(id, project_id, model_id, provider, dimension int, status: building|active|retired,
  created_at)` — exactly one `active` per project (partial unique index) (ADR-0035)
- `search_document_embeddings(embedding_set_id, search_document_id, embedding vector)` — partitioned by
  `embedding_set_id`; each partition's `vector(n)` typmod equals its set's dimension; HNSW index per
  partition; `embedding_pending` handled by absence of the row.
- `edges(project_id, from_kind, from_id, rel, to_kind, to_id)` index both directions.
- `analysis_cache(text_hash pk, analyzer, analyzer_version, result_json)` — prose lint / grammar-service results

## 8. Jobs, calls, budgets

- `jobs(id, project_id, workflow_id, run_id, kind, target_kind, target_id, status, progress_json,
  canon_version_read, prompt_set_id, quality_tier, spend_cents, budget_cents, started_at, finished_at,
  failure_json, parent_job_id)`
- `context_packs(id (UUIDv8 of pack_hash), project_id, job_id, template, template_version, role, canon_version,
  pack_hash unique, manifest, token_counts, rendered_system_hash, rendered_user_hash, rendered_ref (object
  storage key), degraded, created_at)` — append-only; rendered text never stored here (ADR-0045)
- `llm_calls(id, workspace_id, project_id, job_id, activity_id, idempotency_key unique, role,
  prompt_version_id, prompt_hash, pack_id, narrative_identity_version_id, narrative_block_hash,
  output_language_contract_hash, tradition_contract_hash, output_language_check_json, model_id, provider,
  params_json, input_ref, output_ref, input_tokens, output_tokens, cached_tokens, cost_cents numeric,
  latency_ms, attempt, status, error_json, finish_reason, schema_valid bool, created_at)`
- `budgets(id, workspace_id, project_id|null, scope: project|chapter|workflow|workspace, hard_limit_cents,
  soft_limit_cents, period, spent_cents)`; per-chapter budgets stored on `jobs.budget_cents`.
- `cost_snapshots(project_id, date, by_role_json, by_model_json, accepted_chapters, accepted_words,
  cost_per_chapter, cost_per_1k_words)` (words are the author-facing unit, ADR-0034; code points are kept only
  in `length_json` for evidence addressing)
- `llm_concurrency_leases(workspace_id, slot, job_id, expires_at)`

## 9. Quality

- `scorecards(id, manuscript_version_id, overall_json, sections_json, created_at)`
- `issues(id, project_id, scorecard_id, manuscript_version_id, issue_json (schema issue), status,
  override_user_id, override_reason)`
- `lint_reports(manuscript_version_id, report_json)`
- `evaluator_calibration(prompt_version_id, fixture_id, result_json)`

## 10. Prompts

- `prompt_families(name, description, style_sensitive, identity_block_role, manuscript_producing)`
- `prompt_versions(id, family, version, content_hash, templates_json, output_schema_json, params_json,
  routing_policy_json, status, regression_result_json)`
- `prompt_sets(id, name, mapping_json, status)`

## 11. Imports & feedback (Beta)

- `imported_documents(id, project_id, kind, source, sanitized_text, raw_ref, injection_flags_json,
  rights_confirmation_json)`
- `feedback_signals(id, project_id, chapter_range, labels_json, weight, source_document_id)`

## 12. Integrity rules (DB-enforced where possible)

1. `evidence_spans` trigger: `substring(mv.text from start+1 for end-start) = quote` (code-point semantics on
   `text`) and `mv.status IN ('approved','accepted','superseded','retconned')` (all immutable statuses;
   never `working`/`rejected`).
2. Canon tables' `commit_id` NOT NULL; canon inserts only through `canon.commit_delta()` SQL function
   executed inside one transaction that also checks `projects.canon_version = parent_version`.
3. `manuscript_versions` partial unique accepted per chapter.
4. `exemplars.manuscript_version_id` must reference `status='accepted'` (trigger).
5. `search_documents.manuscript_version_id` must be accepted (trigger); nightly assertion job.
6. `facts`: `valid_from_ord <= chapter's clock` at insert (checked in commit function); `frame` must match
   the timeline's `kind` (`canonical`/`flashback` on any timeline; `prior_loop`/`alternate_timeline`/
   `source_story` only on a timeline of that kind) — `FRAME_VIOLATION` otherwise (ADR-0039).
6b. Transitions never set `retracted_at_version`; `retract` ops are refused for `source='chapter_acceptance'`
   commits (ADR-0038). Every commit stores a complete `inverse`.
7. `knowledge_states` with stance `knows` for a secret proposition require `source_json.event_id` or
   `source_json.kind IN ('prior_loop_memory','source_story')` (commit function check).
8. RLS policies on all tables: `workspace_id = current_setting('app.workspace_id')::uuid`.
9. `manuscript_versions.language = 'en'` CHECK constraint in MVP/Beta/Production (relaxed only by a future
   ADR that adds another output language).
10. `proposition_truths`: no overlapping validity for the same `(proposition, timeline)` among non-retracted
    rows (exclusion constraint on the ordinal range).

## 13. Bitemporal query helpers

SQL functions: `canon.state_at(project, entity, attribute, clock, as_of_version default null)`,
`canon.knowledge_at(project, knower, proposition, clock, as_of_version)`, `canon.relationship_at(...)`,
`canon.events_between(project, timeline, clock_a, clock_b, entity_ids)`, `canon.contradictions(project,
entity, attribute, key, clock_from, clock_to, value)`.

## 14. Sizing (3,000-chapter project)

Manuscript text ≈ 7.5M words ≈ 45 MB; facts ≈ 300k rows; events ≈ 60k; knowledge ≈ 200k; search docs ≈
400k (one active embedding set, e.g., 1024-d float16 ≈ 0.8 GB; a migration temporarily doubles this);
llm_calls ≈ 60k rows (payloads in object storage). Comfortable
for a single Postgres instance; partition `llm_calls` and `search_documents` by project hash when
workspace counts grow (Production).

## 15. Migrations

Forward-only SQL migrations (`packages/db/migrations`), reviewed; down migrations for the last 3; migration
tests on a fixture DB (`docs/07-quality/01-testing-strategy.md`).
