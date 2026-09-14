# ADR-0045: Context packs are pure functions of pinned inputs; lexical retrieval is synchronous and accepted-only; vector retrieval is an interface until an embedder exists

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** engineering agent (Checkpoint 4), following ADR-0010, ADR-0011, ADR-0033, ADR-0035

## Context
Checkpoint 4 implements `packages/context`. Three points in the plan needed a concrete decision that the
design documents left open or described only as intent:

1. **Where the pack id comes from and what the pack hash covers.** `context-pack-manifest` has `pack_id`
   (UUID) and `pack_hash`; the plan requires identical pinned inputs → identical bytes and hash, and packs
   that are cached and deduplicated (FR-8.4).
2. **How the lexical index stays clean** (FR-7.17: rejected drafts and non-accepted versions must never enter
   retrieval indexes) when the plan says "commit tx writes `search_documents` rows synchronously; embeddings
   async" (`docs/04-memory-canon/05` §7).
3. **Whether to add pgvector now.** ADR-0011/0035 describe hybrid retrieval with embeddings, but there is no
   embedder adapter or live provider yet, and the Checkpoint 4 brief says vector infrastructure should land
   only if it materially improves the fixture test.

## Decision
1. **Pure assembly, content-addressed ids.** `assemblePack(input)` is a pure function: no I/O, no clock, no
   randomness. `pack_hash = sha256(canonical(manifest without pack_id/pack_hash/validation) ‖ system ‖ user)`,
   and `pack_id` is a UUIDv8 derived from the first 122 bits of that hash. The same holds for Active
   Constraint Sets (`id = uuid8(content_hash)`). Consequences: re-assembly is idempotent, `context_packs`
   is keyed by `pack_hash` with `ON CONFLICT DO NOTHING`, and any change of canon version, Narrative
   Identity bytes, Production Policy pin, template version, contract version or retrieval outcome changes
   the hash. Every rendered section carries its own hash; every item carries `source{kind, ref, version,
   manuscript_version_id, manuscript_status, timeline_id, project_id}`, its provenance label, tier, rank
   score, token estimate and — when excluded — the reason.
2. **Accepted-only lexical index enforced in SQL, synchronous with acceptance, removed on de-acceptance.**
   Migration 0003 adds `summaries` and `search_documents` with BEFORE triggers that refuse any row citing a
   manuscript version whose status is not `accepted` (a quarantined version does not exist in
   `manuscript_versions` at all, so it cannot be cited) and any canon-derived row whose event/proposition is
   not live, non-secret canon. `canon.index_accepted_version(version)` is idempotent (one row per
   `(project, kind, ref, key)`, upserted) and is called inside the acceptance transaction by the workflow
   (Checkpoint 5) and by `pnpm cli summary:set` / `search:index` today; `canon.reindex_project` repairs.
   An AFTER UPDATE trigger on `manuscript_versions` deletes the version's search documents and summaries
   when it stops being `accepted` (rollback, supersession), so async indexing can never leave a de-accepted
   version discoverable. Lexical retrieval uses PostgreSQL `english` full-text search (`websearch_to_tsquery`,
   `ts_rank_cd`) with OR-ed content words for recall and total ordering (rank, chapter, id) for determinism;
   the per-project name thesaurus of `05-retrieval-and-indexing.md` §3 is deferred to Checkpoint 6 (entity
   tagging via `canon.entities_mentioned` covers names, short forms and aliases in the meantime).
3. **Vector retrieval is an interface, not infrastructure.** `VectorRetriever` (same shape as
   `LexicalRetriever`) and the `embedding_sets` registry table (ADR-0035: one `active` set per project) ship;
   no `search_document_embeddings` partition and no pgvector extension are created until the first embedder
   adapter exists. Packs report `degradation.vector = not_configured`. The fixture recall tests pass with
   structured + lexical retrieval alone, which is the material-improvement bar the brief set.
4. **Degradation ladder is explicit and asymmetric.** Structured canon queries are authoritative: any failure
   raises `STRUCTURED_RETRIEVAL_UNAVAILABLE` and blocks generation. Lexical/vector sources are optional: an
   error or timeout omits their T2/T3 candidates and records `degradation.{lexical,vector} ∈ {ok,
   unavailable, not_configured, timeout}` plus a note. A missing accepted chapter k−1 raises
   `PREVIOUS_CHAPTER_NOT_ACCEPTED` for templates that require it; a draft is never substituted.
5. **Per-template input budgets live in the Production Policy.** `policy.context.input_budget_tokens`
   (`pack.chapter_planner`, `pack.continuity_checker`, `pack.extractor`) joins `writer_input_budget_tokens`
   (`pack.scene_writer`), so no budget is a code constant (ADR-0041). The three shipped policies get new
   content hashes; their `version` stays 1 because no project pins them yet (planning data, ADR-0043).

## Alternatives considered
- **Random UUIDv7 pack ids with a separate content hash** — breaks "same inputs → same bytes" at the id
  level and makes the store non-idempotent; rejected.
- **Application-side filtering of drafts at query time** — one missed `WHERE status = 'accepted'` would leak
  a draft; the trigger makes the invariant a property of the table.
- **Adding pgvector now** — a schema with no writer and no reader is untestable and would need a second
  migration once the embedding dimension is known; the interface keeps Checkpoint 6 free to add it.
- **AND-ed full-text queries** — precise but brittle on paraphrased contract text; recall on the fixture
  (ch.3 compass purchase from a ch.10 contract) required OR semantics with rank ordering.

## Consequences
- `schemas/context-pack-manifest.schema.json` gains `project_id`, `production_policy_version`, `sections[]`,
  `degradation`, `previous_chapter`, `active_constraint_set`, `items[].source/provenance/signals` and four
  more validation flags; `schemas/production-policy.schema.json` gains `context.input_budget_tokens`.
- New tables (migration 0003): `summaries`, `search_documents`, `active_constraint_sets`, `context_packs`,
  `embedding_sets`. `context_packs` stores manifest + hashes only; rendered text stays in the artifact store
  the workflow owns (same rule as `llm_calls`).
- `createManuscriptVersion` now numbers versions across `manuscript_versions ∪ quarantine_versions`, so a
  quarantined v1 and its replacement never share a number (defect found while seeding the fixture).
- Follow-ups: per-project thesaurus dictionary (B-1-13, Checkpoint 6); embedder adapter + partitions
  (Checkpoint 6/7); dependency-edge writes from stored packs (ADR-0032, Checkpoint 5 commit workflow).
