# Canon and Temporal-State Architecture

## 1. Core objects

### 1.1 Manuscript versions (immutable)
`manuscript_versions { id, project_id, chapter_id, version_no, origin: assembled|revision|candidate|retcon|
imported, status: working|approved|accepted|superseded|retconned|rejected, language: 'en', text (NFC),
length_json (words, code_points, paragraphs, sentences, est_tokens, est_reading_seconds; ADR-0034),
content_hash, parent_version_id, created_by_job_id }`. `origin` is content provenance; `status` is the
lifecycle (ADR-0037) — the two are orthogonal (a `candidate` can become `approved`; a `revision` can be
`rejected`). Text is never edited in place; a patch creates a new version. **Exactly one** version per
chapter may be `accepted` at a time (partial unique index). `approved` means *approval-locked for
extraction*: the gate froze this version as the only input to canon extraction; `accepted` is set inside the
atomic canon commit. Evidence spans reference `(manuscript_version_id, start, end, quote, quote_hash)`
where `start`/`end` are **Unicode code-point offsets** into the NFC text (ADR-0030); on write the DB trigger
verifies `substring(text from start+1 for end-start) = quote` (PostgreSQL `substring` on `text` is
code-point based) and that the version's status is one of `approved | accepted | superseded | retconned`.

### 1.2 Entities
`entities { id, project_id, type: character|location|organization|item|ability|term|event_anchor|
timeline, display_name (English manuscript name), native_script_name?, romanization?, short_forms[],
aliases[], status: active|retired|merged_into, created_from (bible|extraction|user) }`. Entity **versions** carry editable descriptive fields; identity is the ID. Merging entities
(duplicate detection) rewrites references in a canon commit.

### 1.3 Facts (bitemporal)
```
facts {
  id, project_id, timeline_id, entity_id, attribute, value_json, value_text (English rendering),
  valid_from  StoryClock, valid_to  StoryClock | null,      -- story time
  asserted_at_version int, retracted_at_version int | null, -- canon version (system time)
  source: bible|extraction|user_correction|retcon, confidence, locked bool,
  frame: canonical|flashback|prior_loop|alternate_timeline|source_story,  -- fact-bearing frames only (ADR-0039)
  evidence_span_ids[] (≥1 unless source=bible), commit_id, superseded_by_fact_id
}
```
Attribute families (extensible enum): `identity.*` (name, age, gender, appearance), `status.location`,
`status.injury`, `status.condition`, `status.alive`, `power.rank`, `power.level`, `power.stat.*`,
`power.ability.*`, `inventory.item` (value = item entity + qty), `resource.*` (money, mana), `affiliation.*`,
`role.*`, `world.rule.*`, `relation.*` (mirrored in relationship_states), `register.*` (dialogue-register facts:
formality/address terms/titles per pair).

**Validity semantics** (ADR-0038): `valid_to = null` = still true; a new fact for the same
`(entity, attribute[, key])` closes the prior one at `valid_from` of the new (story time) **and** records
`superseded_by` — this is a **transition** and the prior row stays asserted (history is preserved: "as of
chapter 14" still returns the ch.10 injury after it heals in ch.18). Facts are never deleted; only
corrections, retcons, rollbacks and system-time retractions set `retracted_at_version` (system time) so "as
of canon version v" queries work. Extraction may never emit a retraction for an in-story change.
An extracted fact asserted without its own `valid_from` is valid from its item's `story_clock`, the clock a
`close` uses; a fact with neither is rejected by the verifier (ADR-0105).

### 1.4 Story clock (ADR-0040)
`StoryClock { chapter_no: int, ordinal: int (< 1,000,000), calendar?: gregorian|relative_days|era:<name>,
world_date?: string, precision: exact|approx|unknown, uncertainty_days?: number }`.
- **Narrative order** `(chapter_no, ordinal)` is total within a timeline and is the authoritative sort key;
  the derived column `ord = chapter_no × 1,000,000 + ordinal` backs indexes and range constraints.
- **World order** (`calendar` + `world_date`) is partial: comparable only within one calendar and only when
  neither clock is `unknown`; `approx` clocks with overlapping uncertainty windows are unordered. It serves
  duration reasoning (travel, healing windows, "the next morning"); a check that needs an unknown clock
  reports `clock_unknown` as a continuity risk instead of guessing; cross-calendar checks report
  `calendar_incomparable` and fall back to narrative order.
- **Flashbacks** carry the clock of when the event *happened* (possibly `chapter_no = 0`, pre-story) and
  `narrated_at` for where the manuscript tells it.
- **Simultaneity**: equal `(timeline, chapter_no, ordinal)` = simultaneous/unordered; deterministic
  tie-break for rendering is item id. Two simultaneous changes to one `(entity, attribute, key)` are a
  verifier conflict.
- **Cross-timeline** comparison works only through the child timeline's `divergence_clock`; `source_story`
  timelines have none and are never compared with `main`.
Elapsed-time facts (`world.time.elapsed_since_prev`) are extracted where prose states them.

### 1.5 Events
`events { id, project_id, timeline_id, clock_start, clock_end, narrated_at?, frame, summary, type,
location_id, participants[] (entity, role), asserted_at_version, retracted_at_version, evidence_span_ids[],
source_chapter_id, narrated_in_chapter_ids[] }`.

### 1.6 Reality frames (ADR-0007)
| Frame | Mutates objective state? | Who may know it | Typical extraction cue |
| --- | --- | --- | --- |
| `canonical` | yes | anyone present / informed | ordinary narration |
| `flashback` | yes (at its own past story time) | as canonical at that time | recollection, past-tense framing ("Ten years ago…") |
| `dream` | no | dreamer (as dream) | dream framing, waking cue |
| `hallucination` | no | experiencer | hallucination/auditory cues |
| `lie` | no; creates knowledge stance `believes_false` for deceived hearers if they believe it | speaker knows truth; hearers per outcome | dialogue asserting a non-fact |
| `hypothetical` | no | thinker | "if … then", imagined scenes |
| `prediction` | no | thinker | forecasts, premonitions |
| `plan` | no | planner | (from plan tables, not extraction) |
| `prior_loop` | yes on the prior timeline; no on main | regressor only (plus anyone told) | "last time", "in my first life" |
| `alternate_timeline` | yes on that timeline | per timeline | branch scenes |
| `source_story` | yes on the `source_story` timeline; no on main (ADR-0039) | possessor (as `source_story` knowledge) | "in the original story…", "in the novel…" |
| `non_canonical_draft` | never stored in canon | — | quarantine only |

Rule enforced by verifier: **only `canonical` and `flashback` (current timeline), and `prior_loop`,
`alternate_timeline` and `source_story` (each only on a timeline of the matching kind) may produce facts or
state changes** (`FRAME_VIOLATION` otherwise; ADR-0039). `lie` produces knowledge
stances, never facts. `dream/hallucination/hypothetical/prediction` produce knowledge items for the
experiencer only and may open promises (e.g., prophetic dream → promise type `mystery`).

### 1.7 Timelines (ADR-0023)
`timelines { id, project_id, name, parent_timeline_id, divergence_clock, kind: main|prior_loop|alternate|source_story }`.
A `source_story` timeline (possession/villainess/transmigration) has no parent and no divergence clock: it
is a parallel reference whose facts reach `main` only as the possessor's `source_story` knowledge; divergence
is computed exactly as for prior loops by comparing per-timeline truth (ADR-0039). Reincarnation's previous
life is a `prior_loop` timeline diverging at rebirth (there is no separate frame for it).
Facts/events carry `timeline_id`. Regression: the story starts with `prior_loop` timeline populated by
extraction from the regressor's recollections (frame `prior_loop`), and `main` from chapter 1. Queries for
"what is true now" use `main`; "what does the protagonist expect" joins `prior_loop` facts as knowledge with
stance `knows` (source: memory of prior loop) and adds `diverged=true` when a `main` event contradicts.

## 2. Canon version and commits

`canon_commits { id, project_id, version (monotonic per project), parent_version, source: bible|
chapter_acceptance|user_correction|retcon|rollback|merge_entities, chapter_id?, manuscript_version_id?,
delta_json (forward), inverse_json, actor (job/user), created_at, item_counts }`. `projects.canon_version`
is updated in the same transaction with an optimistic check (`WHERE canon_version = parent_version`).

## 3. Planned ≠ happened

- Plans live in `plan_*` tables; the assembler renders them under an explicit heading `[PLANNED — has not
  happened yet]` and never in the "current state / what has happened so far" sections.
- Extraction is forbidden from reading plans (its context has none) — it only sees the accepted text,
  glossary, and entity registry. So it cannot "confirm" a planned event that the text did not realize.
- After commit, `PlanningHorizonWorkflow` compares the delta against the contract's planned deltas and
  marks each planned item `realized|partially_realized|unrealized` — explicit, never inferred.
- Facts have no `future` validity: `valid_from` must be ≤ the chapter's `story_time.end`. Predictions are
  frame `prediction` knowledge items. In-chapter ordinals follow paragraph order, which the planner cannot know,
  so a window planned inside the chapter's own story-present ends no earlier than its last paragraph (ADR-0104).

## 4. Chapter lifecycle (state machine; ADR-0037)

```
planned ─► drafting ─► drafted ─► evaluating ─► revising ─► review_pending ─► approved ─► extracting
   ─► reconciling ─► verifying ─► committing ─► accepted ─► (stale | superseded | retconned)
                      │ (blocking issues after policy.revision.max_rounds) └► needs_attention
rejected (any pre-accepted state via user) → versions quarantined
```
- `approved` = the human or policy gate passed and the manuscript version is **approval-locked**: immutable,
  the only legal input to extraction, **not yet canon**. Gates *approve*; only the commit *accepts*.
- `accepted` is set inside the atomic commit transaction together with the canon version bump. If
  extraction/verification/commit fails, the chapter stays `approved` with the failure recorded and a retry
  available; canon is untouched. Nothing requires a chapter to be `accepted` before the extraction that
  makes it accepted (the version is `approved` at that point).
- Semi-automatic and Autopilot differ from Assisted only in *who approves*: the policy approves when every
  deterministic criterion passes, `blocking_count = major_count = 0`, and every gated dimension meets its
  own threshold (`policy.gates`, ADR-0041). Policy approval is still approval; acceptance is the commit's job.
- Only `accepted` versions feed packs, summaries, indexes and exemplars.

## 5. Extraction, reconciliation, verification

### 5.1 Extraction (two independent passes)
Inputs: accepted text (with paragraph IDs), glossary + entity registry (IDs, canonical names, aliases),
chapter contract **planned deltas as hypotheses labelled PLANNED — verify** (allowed here because the extractor
must return `realized/unrealized` per hypothesis with evidence — but the extractor's own output is the
source of truth, not the plan), knowledge guards, story clock of the chapter, deterministic pre-pass output
(registry-name mentions with offsets, status-window numbers, utterance speaker/register annotations).

Output (`canon-delta.schema.json`): candidate items each with `type`, payload, `frame`, `story_clock`,
`evidence[] {paragraph_id, quote}`, `confidence`. Extractor A and B use different prompts (A: entity-first
sweep; B: event-timeline-first sweep) and, when routing allows, different model families.

### 5.2 Reconciliation (deterministic first)
Items are canonicalized (entity IDs resolved via aliases, values normalized, story clocks compared) and
matched by `(type, entity/proposition/pair, attribute/kind, story_clock window)`:
- **Agreed** (same value, compatible evidence) → accepted with `confidence = max`.
- **Only-in-one** with confidence ≥ `policy.extraction.single_source_min_confidence` (starting value 0.8) and
  verifiable evidence → kept as `single_source` (flagged in UI); below → adjudicate.
- **Conflict** (same key, different value) → adjudicator call with the exact spans of both claims and the
  surrounding paragraphs; adjudicator must pick or reject with evidence; still unresolved → **human queue**
  (commit blocked for that item only if it is `major`; `minor` items dropped with record).
- Importance: items touching locked facts, knowledge of secrets, injuries/death, rank, inventory, and
  relationship level changes are `major`.

### 5.3 Verification (deterministic)
- Every evidence quote must be found at the given paragraph (exact after NFC; fallback fuzzy ≥
  `policy.extraction.fuzzy_anchor_min_ratio`, starting value 0.98, with re-anchoring, else reject item).
- Entity IDs must exist or be in `introduces[]`; unknown names → proposed new entity requiring approval in
  Assisted mode (auto in Autopilot with `provisional=true`).
- Frame rules (§1.6) enforced per timeline kind (`FRAME_VIOLATION`); `plan`-frame items forbidden; validity
  must not start in the future; `retract` ops forbidden in chapter-acceptance deltas (ADR-0038).
- Consistency pre-check against current canon: contradictions with **locked** facts → blocking (the chapter
  should not have been approved; this is the last line of defense and returns the chapter to
  `needs_attention`); contradictions with unlocked facts → recorded as `supersedes` (state change) if the
  chapter narrates a change, else flagged as `unexplained_contradiction` (major → human queue).
- Knowledge leak check: any `knows` stance created for a character w.r.t. a secret they are guarded from,
  without a channel event in this chapter → blocking.

### 5.4 Commit
Single transaction: insert facts (closing superseded), events, knowledge states (closing superseded),
relationship states, promise updates, propositions, new entities, L1 summary, evidence spans; write
`canon_commits` with delta + inverse; bump version with optimistic check; write dependency edges (chapter →
every canon item read by its pack at the recorded version); set manuscript version `accepted`; set chapter
status `accepted`. Any failure → rollback → chapter remains `approved`, job `needs_attention`.

## 6. Queries the system must answer (and how)

| Query | SQL sketch |
| --- | --- |
| Current state of entity E at story clock C on timeline T (as of latest canon) | `facts WHERE entity=E AND timeline=T AND valid_from<=C AND (valid_to IS NULL OR valid_to>C) AND retracted_at_version IS NULL` |
| Same, as canon stood at version V | add `asserted_at_version<=V AND (retracted_at_version IS NULL OR retracted_at_version>V)` |
| Injury history | facts with `attribute LIKE 'status.injury%'` ordered by valid_from |
| Who was where at C | facts `status.location` valid at C |
| Events involving E in arc range | events join participants, `story_clock BETWEEN` |
| Contradiction check for new fact F | overlapping-validity facts with same key and different value not marked superseded |

## 7. Isolation of rejected drafts (hard guarantees)

1. Extraction activities accept only a `manuscript_version_id` whose `status='approved'` and whose chapter
   is in state `approved`; the DB function `assert_extractable(version_id)` raises otherwise.
2. Working versions (`status='working'`, any origin) that are rejected are moved to `quarantine_versions`
   (same shape, different table) by the workflow with `status='rejected'`; the context
   assembler's source allowlist contains no quarantine tables and no non-accepted versions except the
   **current chapter's own prior scenes** during drafting (explicitly scoped by job).
3. Search documents/embeddings are only built from accepted versions and canon items; a nightly job
   asserts no `search_documents` row references a non-accepted version.
4. Exemplar bank rows require `manuscript_version.status='accepted'` (FK + check).
5. Tests: fixture includes a rejected draft containing a distinctive false fact ("Do-yoon's left arm was
   severed");
   the suite asserts that fact never appears in facts, summaries, packs, or exemplars.

## 8. Dependencies, staleness, propagation

- `dependency_edges { dependent_kind: chapter|plan|summary|pack, dependent_id, canon_item_kind, canon_item_id,
  canon_version_read, materiality: material|contextual, basis: contract_anchor|t0|t1_state|claim_reference|
  retrieved_t2 }` written at commit (for chapters) and at plan/pack creation (for plans/packs). **Material**
  edges come from T0/T1 items, contract anchors, and T2 items the writer's `claims[]`/extractor evidence show
  were relied upon; everything else retrieved into T2 is **contextual** (ADR-0032).
- On any canon commit, the commit's touched item IDs are joined to `dependency_edges`; dependents with a
  **material** edge and `canon_version_read < new_version` get `stale=true` with `stale_reasons` (item +
  change kind); dependents with only contextual edges get a `review_suggested` mark (not stale). Users can
  promote a contextual edge to material from the inspector.
- **Stale job detection**: a running job re-checks before commit that no intervening commit touched its
  dependency set (`SELECT ... FROM canon_commits WHERE version > read_version AND items && deps`); if so,
  it re-validates the contract (cheap) and either continues (no conflict) or restarts from planning.
- **Conflicting parallel jobs**: `target_leases (project_id, target_kind, target_id, job_id, expires_at)`
  taken before drafting; batch runs are sequential by design.
- **Propagation modes**: mark-only (MVP default) → user reviews stale list; auto-revalidate (Beta) runs
  `plan_continuity_checker` on stale contracts and `continuity_checker` on stale accepted chapters, producing
  patch proposals.

## 9. Change classes: transition, correction, retcon, rollback, retraction (ADR-0038)

| Class | Trigger | Story time | System time | Commit `source` |
| --- | --- | --- | --- | --- |
| **Transition** | the story moves on (heal, rank up, move, register milestone) | new row asserted; prior row `valid_to` closed + `superseded_by`; prior row stays asserted | untouched on the prior row | `chapter_acceptance` |
| **Correction** | a row is wrong (extraction error; user fixes a fact with `justification`) | replacement carries the originally intended validity | wrong row `retracted_at_version = v` | `user_correction` |
| **Retcon** | an accepted manuscript is changed and re-accepted | old-version rows retracted; new rows extracted from the retcon version | old rows retracted at `v`; old version `status = retconned` | `retcon` |
| **Rollback** (MVP: latest) | undo a commit | `inverse` re-opens closed `valid_to`, restores retracted rows, retracts inserted rows | inserted rows retracted at `v` | `rollback` |
| **System-time retraction** | out-of-story removal (entity merge, rights, regeneration superseding a version) | untouched | `retracted_at_version = v` | `merge_entities`, `regeneration`, `user_correction` |

- **User correction**: edit canon item → commit `source=user_correction` (evidence optional; `justification`
  required) → dependency propagation → optional manuscript patch task if the text now contradicts canon
  (continuity checker on the source chapter span).
- **Retcon**: new manuscript version (`origin=retcon`) of an accepted chapter → gate → `approved` →
  extraction diff against items sourced from the old version → commit that retracts old items and inserts
  new ones → old version `status=retconned`, new version `accepted` → propagation.
- **Rollback (MVP)**: apply `inverse` of the latest commit in one transaction (new commit
  `source=rollback`, version bumped once, never decremented); the chapter and its version return to
  `approved` (not `accepted`). `inverse` records, per touched row, the exact prior `valid_to`,
  `superseded_by` and `retracted_at_version` so nothing is inferred. Beta: arbitrary version = sequential
  inverse application with conflict detection.
- **Regeneration**: `ChapterProductionWorkflow(supersedes=version)`; on acceptance the commit retracts all
  canon items sourced from the superseded version in the same transaction and sets that version
  `status=superseded`.
- A `retract` op in a `chapter_acceptance` delta is rejected by the verifier (transitions only).

## 10. Special narrative structures

| Structure | Handling |
| --- | --- |
| Flashback chapter | Events frame `flashback` with story clock in the past; facts valid from that past time; contract marks `story_time` accordingly; knowledge items for the narrating character unaffected |
| Dream sequence | frame `dream`; knowledge for dreamer only; may open promises |
| Hypothetical/imagination | frame `hypothetical`; no facts |
| Lies | `lie` event + knowledge stances (`believes_false` for deceived hearers) + speaker `knows` truth |
| Predictions/prophecy | frame `prediction` knowledge; promise opened |
| Regression loop restart | new timeline `prior_loop_n` created from `main` at divergence; `main` reset semantics documented in ADR-0023 (rare; default: one prior loop) |
| Possession / villainess "original story" | `source_story` timeline with its own facts and truth entries; possessor gets `knows` stances with `source.kind=source_story`; `diverged` when main truth differs (ADR-0039); fixture `examples/fixture/source-story.micro.json` |
| Alternate POV retelling of a known event | event `narrated_in_chapter_ids` appended; new knowledge for the new POV character extracted |
| Hidden identity | proposition "X is Y" with secret knower set; extraction of any `knows` for others requires a channel event |
