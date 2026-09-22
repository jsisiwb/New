# Functional Requirements

IDs are stable and referenced by the traceability matrix, backlog and tests. Tier column: M = MVP, B =
Beta, P = Production, F = Future. Priority within tier: P0 (must), P1 (should), P2 (could).

## FR-0 Governing requirements (output language and narrative tradition)

These five requirements govern every other requirement in this document and are traced explicitly in
`04-traceability-matrix.md` and audited in `docs/08-delivery/07-plan-audit.md`.

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| **OUTPUT-LANG-001** | Reader-facing manuscripts (chapter text, chapter titles, in-world text such as status windows and letters) are composed **directly in the project manuscript language** — natural, idiomatic `en` or `ko` per the intake (ADR-0054). The Output-Language Profile records the language and spelling locale (`en-US`/`en-GB` for en, `ko-KR` for ko). The output language stays an explicit, versioned contract; composition never happens in a second language with translation. | M/P0 |
| **STYLE-KWN-001** | Reader-facing manuscripts follow **Korean serialized-webnovel narrative conventions** regardless of the English output language: immediate hooks, local chapter payoff, progression cadence, controlled exposition, dialogue-forward scenes, mobile-readable paragraphs, strong forward pull/cliffhangers, serial devices, and the configured genre profile's conventions. They must not drift into Western epic-fantasy, literary-fiction, or traditionally published novel pacing. | M/P0 |
| **STYLE-GUARD-001** | Every style-sensitive LLM call receives **both** the project's Output-Language Contract (English or Korean, ADR-0054) and the Korean-webnovel Narrative-Tradition Contract (as part of the compiled Narrative Identity Block). The model gateway **fails closed** when either is missing, stale, or not embedded. | M/P0 |
| **EVAL-SEPARATION-001** | Manuscript-language prose quality and Korean-webnovel structural adherence are evaluated, scored, gated and reported as **separate dimensions** (alongside genre adherence, character voice, and continuity/canon compliance). A chapter can fail one while passing the other, and repairs target the failing dimension. | M/P0 |
| **NO-TRANSLATION-001** | Generation composes directly in the project's manuscript language (en or ko, ADR-0054) and never translates inside the loop; English is produced only by the explicit export/translation step. No role, prompt, workflow step, or fallback path may produce text in a language other than the project's manuscript language. Prose that reads as translated (translation-like syntax, calqued idioms, imitated grammar) is a detected and repaired drift class. | M/P0 |

## FR-1 Requirement intake & story specification

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-1.1 | User can create a project with a free-text premise (input may be in English, Korean, or another language) and optional structured fields: genre, subgenres, main character, supporting characters, world concept, desired tropes, forbidden developments, target audience, tone, romance preference, power/progression system, ending preference, chapter count, **target words per chapter**, manuscript language (`en` or `ko`, ADR-0054), mandatory scenes/developments, content restrictions, spelling locale, setting/cultural preferences, naming preferences, terminology preferences. | M/P0 |
| FR-1.2 | System normalizes intake into a **Story Spec** where every item is classified **hard requirement**, **soft preference**, or **assumption**, with provenance (`user`, `system_default`, `model_inferred`). Non-English intake text is interpreted, not translated into manuscript text; the spec stores the original text with its language code and an English working paraphrase for prompts. | M/P0 |
| FR-1.3 | Assumptions are surfaced for review; user can confirm (→ requirement), edit, or reject each. Unconfirmed assumptions remain `assumption` and are labeled as such in all downstream context. | M/P0 |
| FR-1.4 | Story Spec is versioned; each version records who changed what. Downstream plans reference the spec version used. | M/P0 |
| FR-1.5 | User can add **running directions** at any time. Directions are classified hard/soft, scoped (series/season/arc/chapter-range/character), and take effect from the next unplanned or regenerated unit. | M/P0 |
| FR-1.6 | Content restrictions (age rating, forbidden themes) are hard requirements enforced in evaluation and in export metadata. | M/P0 |
| FR-1.7 | The system detects requirement conflicts (e.g., "no romance" + "romance-fantasy genre") and asks the user to resolve before planning. | M/P1 |
| FR-1.8 | Hard requirements carry **scope** and are compiled per chapter into an **Active Constraint Set** (deduplicated, scope-filtered, grouped, with stable IDs) so T0 context never grows with the total number of requirements (ADR-0033). | M/P0 |

## FR-2 Concept & story bible

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-2.1 | Generate 2 concept candidates (3 in Premium) with a structured comparison and recommendation; user selects or merges. | M/P0 |
| FR-2.2 | Generate a **Story Bible**: characters (identity, background, goals, flaws, arc, secrets, **dialogue-register profile**, **voice profile**), world (rules, geography, institutions), power/progression system, factions, locations, **naming registry** (display name, optional native-script name, romanization), **terminology & romanization policy**, narrative identity binding. | M/P0 |
| FR-2.3 | User can edit any bible entry; edits are versioned. | M/P0 |
| FR-2.4 | User can **lock** facts (immutable canon); locked facts cannot be changed by generation and any contradiction is a blocking issue. | M/P0 |
| FR-2.5 | Every bible entity has a stable ID, an English **display name** used in manuscripts, optional native-script name and romanization, and aliases used for entity linking in extraction. | M/P0 |
| FR-2.6 | **Dialogue-register profiles** define, per character and per key counterpart: formality, deference, familiarity, intimacy, directness, contraction usage, address terms and titles (in English), public vs private register, and relationship-driven changes — as abstract canonical data rendered in natural English (never as Korean speech-level grammar). Modeled with validity so registers can change (e.g., after becoming lovers). | M/P0 |
| FR-2.7 | Bible approval is a gate; plan generation cannot start before bible v1 is approved (Assisted) or auto-approved (Autopilot). | M/P0 |
| FR-2.8 | The **Naming Profile** decides name style (Korean-style with a romanization system and name order, Western-style, invented), and the **Terminology Policy** decides per Korean-origin term whether to translate, romanize, gloss on first use, or preserve script; both are enforced deterministically in manuscripts. | M/P0 |

## FR-3 Hierarchical story planning

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-3.1 | Planning hierarchy: Series Blueprint → Seasons → Arcs (major/minor) → Chapters (contracts) → Scenes. Volumes are export groupings mapped onto chapters. | M/P0 |
| FR-3.2 | Series Blueprint holds: story promise, reader fantasy, main conflict, protagonist development arc, key character arcs, relationship arcs, progression arc, mystery/foreshadowing register, ending, **endgame requirements**. | M/P0 |
| FR-3.3 | **Rolling horizon**: chapter contracts exist in detail for the next H chapters (default 6); arcs outlined for the next 2; seasons outlined for the full series. Re-planning triggered by acceptance, directions, retcons, or feedback. | M/P0 |
| FR-3.4 | **Promise Ledger** with due windows; overdue promises are flagged. | M/P0 |
| FR-3.5 | Each chapter has a **Chapter Contract** including purpose, must/must-not, participants, POV, locations, story-time window, knowledge/state/relationship deltas, setups, payoffs, emotional movement, conflict/reversal, local satisfaction, ending state, hook type, narrative identity version, **language-aware length target** (words for en, characters for ko, ADR-0054), continuity risks, acceptance criteria. | M/P0 |
| FR-3.6 | Plans are re-validated against canon after every canon commit; plans with changed **material** dependencies are marked stale with a diff. | M/P0 |
| FR-3.7 | The user can review, edit, approve, or regenerate plans at any level; edits at a higher level mark lower levels stale. | M/P0 |
| FR-3.8 | The planner respects Korean-webnovel serial structure from the Narrative-Tradition Profile: episode-level hook, arc-level payoff cadence, progression cadence per genre profile, cliffhanger frequency targets (STYLE-KWN-001). | M/P0 |
| FR-3.9 | Reader feedback (Beta) can be imported as *soft* signals to re-planning. | B/P1 |

## FR-4 Chapter production pipeline

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-4.1 | Chapter production runs as a durable workflow: contract validation → context pack → scene plan → scene drafting → assembly → deterministic checks → model evaluations → targeted revision loop → gate → acceptance → canon extraction → reconciliation → verification → atomic canon commit → post-commit. | M/P0 |
| FR-4.2 | Every LLM call receives an explicit **Context Pack** (versioned, manifested) and a versioned prompt; no call relies on prior conversation. | M/P0 |
| FR-4.3 | Scene drafting is per scene **in English** with the verbatim tail of the previous accepted chapter (`policy.context.previous_tail_words`, starting value 400, sentence-aligned; ADR-0041) and the preceding drafted scene as continuity anchors. | M/P0 |
| FR-4.4 | Output length is controlled to the **language-aware target count** (words for en, characters for ko) ± tolerance (default ±12%); the length model also records code points, paragraphs, estimated tokens and reading time (ADR-0034). Overruns/underruns trigger scene-level adjustments. | M/P0 |
| FR-4.5 | Candidate generation (N≥2) mechanism ships in MVP and is configurable per project: concepts (always N≥2), arc plans (Standard+), scenes/chapters (Premium or on request in MVP; default-on for Standard in Beta). Candidates are judged pairwise with position swapping; early stop when a candidate exceeds the threshold or budget is reached. | M/P0 (mechanism), B/P1 |
| FR-4.6 | Rejected candidates and drafts are stored in a quarantined table space never read by the context assembler or canon extractor. | M/P0 |
| FR-4.7 | Batch generation runs sequentially with gates per mode; can be paused/cancelled with partial completion preserved. | M/P0 |
| FR-4.8 | Chapter regeneration produces a **dependency report** (materially dependent later chapters/plans) before proceeding. | M/P0 |
| FR-4.9 | Natural-language change requests are converted into scoped patch tasks rather than regenerations unless the contract is invalidated. | M/P0 |
| FR-4.10 | Every manuscript-producing role's output passes a deterministic **output-language check** (language identification ≥ 0.99 in the project manuscript language on prose segments excluding approved preserved-script terms) before any further evaluation; failure is blocking and triggers regeneration (OUTPUT-LANG-001, NO-TRANSLATION-001). | M/P0 |

## FR-5 Evaluation & revision

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-5.1 | Deterministic checks: schema validity, truncation, length (words), output-language check, **English Prose Lint**, **Structure Lint**, forbidden content lexicon, naming/terminology registry compliance, required-scene markers, repeated paragraph detection (n-gram/simhash vs all accepted chapters), status-window format validity. | M/P0 |
| FR-5.2 | Model-based evaluators: contract compliance, continuity (facts/timeline/location/inventory/injury/rank), knowledge leakage, relationship consistency, world/power-rule compliance, promise tracking, repetition, **Prose Judge** (English quality, translation-like syntax, literary/Western drift), **Structure Judge** (Korean-webnovel form: hook, payoff, pacing, ending pull, exposition), **Genre Judge**, **Voice Judge** (character voice + dialogue register). | M/P0 |
| FR-5.3 | Every issue includes kind, severity, confidence, claim, chapter span (code-point offsets), conflicting canon IDs, canon evidence spans, and recommended repair scope. | M/P0 |
| FR-5.4 | Blocking issues prevent approval and cannot be overridden; majors require repair or a reviewer override **allowed by the issue-override matrix** (ADR-0042): objective corruption (non-English output, truncation, corrupt structured output, unapproved prohibited content, evidence-integrity failure, partial commit, stale-canon race, invalid reality-frame mutation, secret leak) is never overridable, and a contradiction with a locked fact or a hard requirement requires a correction/retcon canon workflow rather than a style override; minors/notes are advisory. | M/P0 |
| FR-5.5 | **Patch-first revision** with affected-check re-runs and whole-chapter smoke checks after ≥3 patches or any scene-level patch. | M/P0 |
| FR-5.6 | Revision loop bounded by the pinned Production Policy (`policy.revision.*`, ADR-0041) and spend; exhaustion escalates to human review. | M/P0 |
| FR-5.7 | Scorecards are stored per manuscript version with **separate sections** for prose quality, structural adherence, genre adherence, voice, continuity, knowledge, promises, repetition, length (EVAL-SEPARATION-001). | M/P0 |
| FR-5.8 | Judge calibration: evaluators run against golden fixtures and the five-class contrast set on every prompt change. | M/P0 |

## FR-6 Narrative identity (output language + narrative tradition)

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-6.1 | **Narrative Identity** per project composed from: Output-Language Profile (English) + Narrative-Tradition Profile (Korean webnovel) + Genre Profile(s) + Setting & Cultural Profile + Naming Profile + Dialogue-Register Policy + Terminology & Romanization Policy + User Prose Preferences; versioned; approved as part of the bible. | M/P0 |
| FR-6.2 | A compiled **Narrative Identity Block** is attached to every style-sensitive call; the gateway **Narrative Identity Guard** rejects style-sensitive calls lacking a valid Output-Language Contract or Narrative-Tradition Contract (STYLE-GUARD-001). | M/P0 |
| FR-6.3 | Block variants per role and budget (writer full, editor full, planner compact, judge rubric form, summarizer minimal). | M/P0 |
| FR-6.4 | **English Prose Lint** with configurable thresholds: grammar/fluency signals, repetitive sentence openings, sentence-length rhythm, paragraph length & mobile readability, dialogue-tag overuse and adverb-tag rate, filter-word density, translation-like syntax markers, spelling-locale consistency, unapproved untranslated terminology, romanization consistency, format drift (screenplay/script/outline). English is never flagged as "language leakage". | M/P0 |
| FR-6.5 | **Dialogue-register check**: per utterance, resolve speaker/addressee (from writer annotations), derive expected register from the Dialogue-Register Policy + relationship state at story time, and flag deviations (formality, address term/title, contraction usage, directness) not marked as intentional shifts. Rendered and checked in English; no Korean morphological analysis of manuscript text. | M/P0 |
| FR-6.6 | **Structure Judge** and **Structure Lint** score Korean-webnovel form: hook timing, local payoff, scene rhythm, exposition control, dialogue-forwardness, ending pull, progression cadence, genre devices — independent of language. | M/P0 |
| FR-6.7 | **Prose Judge** scores English quality: fluency, idiom, clarity, translation-like syntax absence, literary/Western-novel drift absence, mobile readability. **Voice Judge** compares utterances to voice profiles and prior accepted utterances. | M/P0 |
| FR-6.8 | Passage-level **repair** targets the failing dimension (prose vs structure vs voice) with the appropriate reviser and re-checks only affected dimensions. | M/P0 |
| FR-6.9 | Exemplar bank of approved **English** passages tagged by function; user-owned/licensed exemplars with provenance; no commercial-work exemplars. | M/P0 |
| FR-6.10 | Naming and terminology consistency: the registry enforces fixed English spellings/romanizations; variants are deterministic issues; Korean-script tokens are allowed only where the terminology policy says `preserve_script`. | M/P0 |
| FR-6.11 | User prose preferences stored as project overrides with numeric targets where possible. | M/P0 |
| FR-6.12 | Genre-specific structural devices supported as first-class English formatting: status windows, system messages, ranking boards, community/forum interludes, letters. | M/P0 |
| FR-6.13 | All numeric thresholds in profiles are **configuration with documented starting values and calibration procedures**, not fixed truths (ADR-0029). | M/P0 |

## FR-7 Memory, canon, knowledge

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-7.1 | Accepted chapter text is stored as an **immutable manuscript version**; canon references its spans by Unicode code-point offsets + quote + hash (ADR-0030). | M/P0 |
| FR-7.2 | Canon extraction runs only on an **approval-locked** manuscript version (`status=approved`, ADR-0037) and produces a **Canon Delta** of *proposals*: facts, events (with frames), state changes, knowledge changes, relationship changes (incl. register/address-term changes), promises, unresolved questions, L1 summary. | M/P0 |
| FR-7.3 | Two independent extractor passes reconciled; conflicts adjudicated with spans; unresolved → human queue; items lacking verifiable evidence rejected. | M/P0 |
| FR-7.4 | **Atomic canon commit** in one transaction with version bump (exactly once), delta + complete inverse, dependency edges, and the manuscript version set to `accepted` (ADR-0037). | M/P0 |
| FR-7.5 | Facts are bitemporal; "as of chapter k" and "as of canon version v" queries supported. Normal story transitions close story-time validity and keep history; only corrections, retcons, rollbacks and system-time retractions set `retracted_at_version` (ADR-0038). | M/P0 |
| FR-7.6 | Reality frames on events and derived facts; only reality-bearing frames mutate state. | M/P0 |
| FR-7.7 | Knowledge ledger distinguishes objective truth **per timeline**, narrator knowledge, reader knowledge, and per-character stances with source and validity (ADR-0031). | M/P0 |
| FR-7.8 | Secrets with restricted knower sets; knowledge leaks detected. | M/P0 |
| FR-7.9 | Relationship states per directed pair with type, axes, **register summary** (formality/familiarity/deference), address terms/titles, validity. | M/P0 |
| FR-7.10 | Timeline model with divergence points (`main`, `prior_loop`, `alternate`, `source_story`); prior-loop and source-story facts live on their own timelines and reach the present only as knowledge of the regressor/possessor (ADR-0023, ADR-0039). StoryClock ordering and uncertainty follow ADR-0040. | M/P0 |
| FR-7.11 | Hierarchical summaries L1–L4 regenerated on commit from accepted text. | M/P0 |
| FR-7.12 | Jobs record `canon_version_read`; stale jobs detected before commit. | M/P0 |
| FR-7.13 | Per-target leases prevent conflicting parallel jobs; batches sequential. | M/P0 |
| FR-7.14 | User corrections produce a new canon version with justification and an impact report over **material** dependencies. | M/P0 |
| FR-7.15 | Retcons re-extract, commit, and propagate to materially dependent artifacts (MVP: list; Beta: patch proposals). | M/P0 (basic), B/P1 |
| FR-7.16 | Rollback of the latest commit in MVP; arbitrary in Beta. | M/P1, B/P0 |
| FR-7.17 | Rejected drafts and non-accepted versions are excluded from canon, summaries, retrieval indexes, embeddings used for context, exemplar banks, later Context Packs and canon extraction. | M/P0 |
| FR-7.18 | Dependency edges carry a **materiality class** (`material` vs `contextual`); only material edges mark dependents stale by default, contextual edges are reported as "review suggested" (ADR-0032). | M/P0 |

## FR-8 Context construction

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-8.1 | Context Pack assembler builds a tiered pack per role: T0 (Active Constraint Set, Narrative Identity Block, chapter contract, locked facts touching participants, knowledge guards, naming/terminology slice, L4 summary), T1 (previous chapter tail verbatim + L1 summary + hook; participant states with evidence; knowledge; relationships incl. register; arc plan; promises due; timeline), T2 (retrieved older canon, L2/L3 summaries, voice exemplars), T3 (optional exemplars, minor entities). | M/P0 |
| FR-8.2 | Budgeting: T0 never trimmed (overflow = error), T1 compressed only via approved renderers with a degradation ladder, T2 ranked/truncated, T3 dropped first; T0 validated byte-for-byte. | M/P0 |
| FR-8.3 | Retrieval is hybrid: structured queries, lexical search (English full-text with stemming; name/term registry as exact tokens), vector search, graph hops. | M/P0 |
| FR-8.4 | Every pack has a manifest and content hash; packs are cached and deduplicated. | M/P0 |
| FR-8.5 | Pack templates are versioned and tested against fixture recall targets. | M/P0 |

## FR-9 Operations, budgets, reliability

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-9.1 | Budgets at project, chapter, and workflow level with **hard limits**. | M/P0 |
| FR-9.2 | Quality tiers select a versioned **Production Policy** (candidate counts, revision limits, per-dimension gates, extraction thresholds, override matrix; ADR-0041) and model routing; cost prediction per chapter. | M/P0 |
| FR-9.3 | Usage tracking per call; aggregated cost per accepted chapter and **per 1,000 accepted words**. | M/P0 |
| FR-9.4 | Jobs list with status, progress, spend, ETA; pause/cancel/resume; escalation details. | M/P0 |
| FR-9.5 | Full audit record per LLM call (NFR-A). | M/P0 |
| FR-9.6 | Provider fallback and model routing per role; structured output validation with bounded repair; truncation detection with continuation. | M/P0 |

## FR-10 Export & rights

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-10.1 | Export accepted chapters as TXT and DOCX per volume/series (English typography per locale: curly quotes, em dashes, ellipsis character); EPUB and platform profiles in Beta. | M/P0 |
| FR-10.2 | Export includes optional metadata: AI-assistance disclosure text, rights confirmation, glossary of romanized terms. | M/P1 |
| FR-10.3 | Users confirm rights for any uploaded exemplar/reference text; provenance is stored. | M/P0 |
| FR-10.4 | Similarity screening of accepted chapters against a user-supplied reference corpus. | B/P1 |

## FR-11 Security & tenancy

| ID | Requirement | Tier/Prio |
| --- | --- | --- |
| FR-11.1 | Authentication (email magic link + OAuth), sessions, 2FA optional (Beta). | M/P0 |
| FR-11.2 | Workspace isolation via Postgres RLS + application-level scoping; roles owner/editor/viewer. | M/P0 |
| FR-11.3 | Audit log of user actions. | M/P0 |
| FR-11.4 | Imported text is sanitized, marked untrusted, never placed in instruction positions. | M/P0 |
| FR-11.5 | Data export and deletion with retention policy. | M/P1 |
