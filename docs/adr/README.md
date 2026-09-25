# Architecture Decision Records

| ADR | Title |
| --- | --- |
| [0001](0001-typescript-monorepo-with-python-nlp-sidecar.md) | TypeScript monorepo (optional English grammar service) |
| [0002](0002-postgres-single-system-of-record.md) | Postgres 16 + pgvector as the single system of record |
| [0003](0003-temporal-for-durable-workflows.md) | Temporal for durable, resumable workflows — *staged after the MVP core loop by 0044; adopted at Checkpoint 7 with the orchestration granularity set by 0047* |
| [0004](0004-provider-independent-model-gateway.md) | Provider-independent model gateway with role-based routing |
| [0005](0005-fail-closed-style-guard.md) | Fail-closed guard on every style-sensitive call — *superseded by 0027* |
| [0006](0006-bitemporal-facts-with-evidence.md) | Bitemporal facts with mandatory evidence spans |
| [0007](0007-reality-frames.md) | Reality frames on events and derived facts — *fact-bearing list amended by 0039* |
| [0008](0008-proposition-centric-knowledge-ledger.md) | Proposition-centric knowledge ledger |
| [0009](0009-accepted-only-canon-with-atomic-commit.md) | Canon from approval-locked extraction and accepted-on-commit, two-extractor reconciliation, atomic commit — *lifecycle wording clarified by 0037* |
| [0010](0010-tiered-context-packs.md) | Tiered, manifested, deterministic context packs |
| [0011](0011-hybrid-retrieval.md) | Hybrid retrieval: structured + lexical + vector + graph |
| [0012](0012-rolling-horizon-hierarchical-planning.md) | Rolling-horizon hierarchical planning |
| [0013](0013-chapter-contract-as-acceptance-unit.md) | Chapter Contract as the unit of acceptance |
| [0014](0014-patch-first-revision.md) | Patch-first revision with regression re-checks |
| [0015](0015-position-swapped-pairwise-judging.md) | Position-swapped pairwise judging with tie rules and early stop |
| [0016](0016-prompt-registry-with-versioning.md) | Prompt registry with immutable versions and regression gating |
| [0017](0017-korean-nlp-sidecar.md) | Korean morphological analysis sidecar — *superseded by 0028* |
| [0018](0018-hard-budgets-and-quality-tiers.md) | Hard budgets at project/chapter/workflow with quality tiers |
| [0019](0019-assisted-default-mode.md) | Assisted mode as default; Semi-automatic after first arc; Autopilot in Beta |
| [0020](0020-workspace-isolation-with-rls.md) | Workspace isolation with Postgres RLS and envelope encryption |
| [0021](0021-repository-structure.md) | Repository structure for the implementation — *`apps/cli` first, per 0044* |
| [0022](0022-immutable-manuscript-versions.md) | Immutable manuscript versions with span addressing |
| [0023](0023-timelines-for-regression.md) | Explicit timelines for regression/possession/alternate realities — *`source_story` timeline kind added by 0039* |
| [0024](0024-nfc-normalization-and-character-counting.md) | NFC normalization and character counting — *superseded by 0030/0034* |
| [0025](0025-exemplar-and-imitation-policy.md) | Exemplar sourcing and non-imitation policy |
| [0026](0026-english-manuscript-korean-webnovel-tradition.md) | **English is the manuscript language; Korean webnovel is the narrative tradition** (governing) |
| [0027](0027-narrative-identity-guard.md) | Fail-closed Narrative Identity Guard requiring both contracts |
| [0028](0028-english-prose-tooling-replaces-korean-nlp.md) | English prose tooling replaces the Korean NLP sidecar |
| [0029](0029-calibration-dependent-thresholds.md) | Numeric style thresholds are configuration with calibration status |
| [0030](0030-unicode-code-point-addressing.md) | One Unicode-safe text addressing system across all runtimes |
| [0031](0031-per-timeline-proposition-truth.md) | Proposition truth is recorded per timeline with validity |
| [0032](0032-material-vs-contextual-dependency-edges.md) | Dependency edges distinguish material from contextual dependencies |
| [0033](0033-active-constraint-set.md) | Hard requirements compiled into a scope-filtered Active Constraint Set |
| [0034](0034-language-neutral-length-model.md) | Language-neutral length model; words are the author-facing unit for English |
| [0035](0035-provider-independent-embedding-migrations.md) | Embedding sets versioned per model with atomic active-set switching |
| [0036](0036-mvp-vertical-slice.md) | MVP re-scoped to a vertical slice with all foundational invariants — *amended by 0044* |
| [0037](0037-manuscript-lifecycle-and-approval-lock.md) | One manuscript lifecycle: approval-locked extraction, accepted-on-commit; `origin` + `status` replace `kind` |
| [0038](0038-bitemporal-transition-classes.md) | Five bitemporal change classes: transition, correction, retcon, rollback, retraction |
| [0039](0039-source-story-as-fact-bearing-timeline.md) | `source_story` is a fact-bearing timeline reached only through knowledge |
| [0040](0040-storyclock-ordering-and-uncertainty.md) | StoryClock ordering, uncertainty, calendars and simultaneity |
| [0041](0041-production-policy-single-source.md) | One versioned Production Policy for limits, per-dimension gates and thresholds |
| [0042](0042-issue-override-matrix.md) | Issue-override matrix: never / canon-workflow / reviewer / advisory |
| [0043](0043-planning-baseline-truthfulness.md) | Truthful planning baseline: labeled starter artifacts, one progress document |
| [0044](0044-modular-monolith-first.md) | Modular monolith first; Temporal and the web app after the core loop is proven |
| [0045](0045-context-pack-retrieval-implementation.md) | Context packs are pure functions of pinned inputs; lexical retrieval is synchronous and accepted-only (SQL-enforced); vector retrieval is an interface until an embedder exists |
| [0046](0046-chapter-production-implementation.md) | Chapter-production implementation: previous-chapter gate before spend, replay activity-id binding, global canon identity with per-test DB isolation |
| [0047](0047-temporal-adapter-over-checkpointed-steps.md) | Temporal orchestrates the proven chapter loop as one durable activity over its Postgres checkpoints, not as decomposed activities |
| [0048](0048-atomic-lease-fencing.md) | Lease fencing is asserted inside the transaction it protects (raising `LEASE_LOST`), closing the time-of-check/time-of-use gap a pre-step ownership read leaves open |
| [0049](0049-active-request-cancellation.md) | Durable cancellation aborts the in-flight provider request (composed signal plus a race), is never retried/repaired/rerouted, and records remote-cancellation status and post-abort billing as `unknown` rather than as a zero |
| [0050](0050-database-least-privilege.md) | The application role holds only the privileges its write paths use: append-only and immutable tables are `INSERT`/`SELECT` only, canon history keeps the `UPDATE` `commit_delta` needs but loses `DELETE`, `EXECUTE` is never granted to `PUBLIC`, and every guarantee is enforced at both the trigger and the grant layer |
| [0051](0051-autopilot-novel-runs-and-live-providers.md) | The `novel_run` row is the operator's unit of work (intake → suggestions → approval → planning → producing), the full Story Bible is generated by the plan's own design families and assembled deterministically, a Postgres-queued runner drives runs without requiring Temporal, and live providers (OpenAI-compatible, Anthropic) are configured by variable name and fail closed |

| [0052](0052-complete-bible-before-prose.md) | Preserve full design documents as planned context and reject incomplete series plans before prose |

| [0053](0053-deployment-safe-workflow-resume.md) | Chapter and story-planning jobs resume with validated persisted prompt sets instead of the latest active defaults |

| [0054](0054-korean-manuscript-language.md) | The manuscript language is per project (English or Korean, chosen at intake); generation composes directly in it, and English is produced only by an explicit export/translation step |

| [0055](0055-fully-korean-prompt-surface.md) | A Korean project's whole prompt surface is Korean: identity block, Korean-authored layers, context packs, Active Constraint Set and v3 prompt families |

| [0056](0056-korean-webnovel-craft-engine.md) | Korean webnovel craft engine: v3 craft layers with studio exemplars, one source for forbidden diction driving a deterministic style lint, a prose-only scene writer with explicit episode position, v4 prompt families, multi-round Korean revision and the Notion bridge provider mode |
| [0057](0057-schema-generated-output-shapes.md) | Output shapes come from schemas: answer schemas for every JSON role, CI validation of every active prompt's shape, schema-generated examples, native structured output as a route capability, counted output normalizers and safe model-written patterns |
| [0058](0058-korean-lexical-retrieval.md) | Korean lexical retrieval: pg_trgm with particle-stripped stems and registry alias expansion, manuscript language stored on Korean rows, two-syllable Hangul names tagged; English FTS unchanged |
| [0059](0059-korean-token-estimation-and-pack-localization.md) | Korean token estimation (`korean_chars_v1`, one token per 자, calibrated against o200k/cl100k) for Korean packs, and a fully Korean canon rendering enforced by a scan of every Korean model call |
| [0060](0060-evaluation-v2.md) | Evaluation v2: every evaluator reads its own pack sections and inputs, promise_checker and repetition_judge, a Production Policy evaluation block (parallel evaluators, rubric-composed gates, targeted re-evaluation) and `standard.v2` |
| [0061](0061-long-story-memory.md) | Long-story memory: story-so-far digest of accepted L1 summaries, first-meeting ledger, overdue promises always visible, arcs chained from the accepted ending, deterministic series audit |
| [0062](0062-korean-prose-lint-and-exemplar-priority.md) | Prose quality for Korean manuscripts: identity blocks measured in 자 with exemplars above setting and a 35% Korean block share; a versioned Korean spelling list, ending-monotony and misspelled-name lint in the Korean language layer v4 |
| [0063](0063-state-ledgers-and-plan-check.md) | State ledgers projected from accepted canon (state cards, story clock and countdowns, 호칭/말높이 matrix, status-window format) in a T1 pack section; deterministic draft checks against them and a pre-draft plan check, opt-in through `standard.v3` |
| [0064](0064-revision-continues-past-a-regressed-patch.md) | A regressed patch is quarantined and revision continues from the version before it (`revision.on_regression`); revision rounds per manuscript language in the policy; rejected Korean versions can be quarantined (migration 0022); `standard.v4` |
| [0065](0065-korean-lint-v5.md) | `lang/ko@5` lint: rates of 번역체 constructions, comma density, long-sentence share, dialogue plus 속마음 share, reflective-ending list, near copies of exemplars, jamo-level misspelled names, one status-window field per line; a synthetic translated passage must fail |
| [0066](0066-korean-concept-seeds-and-world-rules-term.md) | Concept angle seeds and the bible's world-rules term are in the manuscript language (`세계 규칙` for Korean projects); English seeds keep their bytes; the Korean end-to-end test checks both directly |
| [0067](0067-run-report-and-korean-relint.md) | Read-only `quality:run-report` (per-chapter scorecards, gates, lint by rule, plan checks, quarantined versions, model calls by role, wall clock, normalizer snapshot) and `quality:lint-ko` (the Korean lint over accepted chapters under the pinned or another language layer) |
| [0068](0068-korean-scene-plan-as-labelled-text.md) | A Korean writer reads its scene plan as labelled Korean text with registry names under `planning.scene_plan_format: labelled` (`standard.v5`); earlier pins and English writers keep JSON |
| [0069](0069-korean-export-headings.md) | Korean exports head chapters `N화` (Markdown, text, TXT and DOCX); a Korean heading marker counts only on its own line when chapters are split; English exports unchanged |
| [0070](0070-phase-a-live-run-decisions.md) | Phase A live run: leave the Notion client deadline at the adapter default (it must outlast the bridge's failover); the default policy and the Korean lint thresholds do not move until live chapters exist; a novel start fails its run when its plan context cannot be built |
| [0071](0071-deterministic-suites-policy-hash-check-sql-lexer.md) | Intermittent integration tests synchronise on the event (lease takeover, backend teardown, lock wait), never on time; `policy:rehash --check` fails CI on a stale policy hash; migration privilege analysis lexes SQL statements instead of grepping |
| [0072](0072-provider-readiness-retry-batches-heartbeat-routing.md) | Provider readiness: retry with exponential backoff and jitter from the pinned policy (`provider_retry`), the bible cast in three checkpointed batches (`planning.design_batches`), `standard.v6`, a run heartbeat that fails a stuck run with `RUN_STUCK`, and a per-class routing capability check (`provider:check`); in notion mode judges share the writer's model (known limitation) |
| [0073](0073-korean-prose-quality-v7.md) | Prose quality for Korean manuscripts, opt-in through `standard.v7`: `lang/ko@6` lint (ellipsis/dash density, Western idioms, stacked modifiers, name transpositions, calibrated names, point of view), intake point of view / style sample / contrast pairs in the identity, serial-rhythm directives with a rhythm check, and a lint-driven Korean polish round |
| [0074](0074-phase-a-live-defects-location-name-lint-pov-secrets.md) | Phase A live defects: a contract that names no location gets a registered one (A-1); `KO-NAME-04` on full display names replaces `KO-NAME-02` in `lang/ko@6` (A-2); the POV character's own secrets are the reader's under `evaluation.pov_secrets_reader_visible` (A-3); a regressor's future knowledge is recorded as open (A-4) |
| [0075](0075-korean-pack-budgets-and-scene-length-calibration.md) | Korean pack budgets and scene length calibration, `standard.v8`: the writer, checker, extractor and planner budgets are sized for the one-token-per-자 Korean estimator (live `PACK_FAILED`, K-1); scene writers are asked for a calibrated length with the remaining budget redistributed, while plans and gates keep the target (K-2, K3) |
| [0076](0076-hierarchical-story-memory-arc-summaries.md) | Hierarchical story memory, `standard.v9`: one arc summary (L2) per accepted arc by `arc_summarizer`, the story so far as recent L1 blocks plus one item per older arc; 60-query Korean retrieval fixture with rank-quality floors; a reviser patch without `scope` gets one inferred from its text (live defect L-1) |
| [0077](0077-multi-patch-revision-rounds.md) | Multi-patch revision rounds, `standard.v10`: one reviser call per cluster of the targeted spans, each anchored inside its own window, merged into one revision recorded as an envelope patch plus a `patch_set`; unusable sub-patches are dropped, the round fails only when none is usable |
| [0078](0078-patch-regression-against-the-parent.md) | Patch regression protections against the parent, `standard.v11`: a protected section fails only on pass → fail and a kind guard only on more open majors of its kinds than the parent (live defect V-1: every live patched round was quarantined for what its parent already failed) |
| [0079](0079-operator-tools.md) | Read-only operator tools: `pack:inspect` (sections against the pinned budget, from the stored contract), `story:state`, `cost:project` (audit → N chapters), `contract:show`, `prompts:size` |
| [0080](0080-gemini-provider-readiness-refusals-and-db-safety.md) | Gemini provider readiness: both model-id variable names accepted (`YEONJAE_NOTION_MODEL` wins), error classes split (empty reply, 5xx, throttle, transport, safety refusal, truncated JSON), a policy-gated same-route refusal rule, counted JSON recoveries, `bridge:credits`, `provider:check --deep`, libpq sslmode semantics and a reset guard for the permanent database |
| [0081](0081-gemini-baseline-and-same-model-judging.md) | Gemini baseline and same-model judging, `standard.v12`: prompt ceilings per policy (`prompts.max_version`; older policies keep the 4.5.0 set), 4.6.0 judges that quote their weakest passages first and score against anchored Korean rubrics, the Gemini scene writer (속마음 in 반말, one paragraph per line), deterministic one-paragraph-per-line drafts, length in the structure composite, a judge calibration cap, Korean length claims |
| [0082](0082-operator-corpus-import-statistics-and-copy-detection.md) | The operator corpus in the permanent database (schema `corpus`, idempotent `corpus:import` from EPUB + manifest, inferred POV); the English translation is imported but carries no voice; statistics measured with the lint's own code; blocking copy detection at 14 Hangul syllables (spaces and punctuation ignored) on every evaluated version |

New ADRs: copy `0000-adr-template.md`, take the next number, link it here, and update the traceability
matrix in the same change.
