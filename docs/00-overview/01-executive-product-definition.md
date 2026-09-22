# Executive Product Definition — Yeonjae Studio (연재 스튜디오)

## 1. One-paragraph definition

Yeonjae Studio is a stateful, resumable, auditable **AI production studio for serialized fiction written in
English in the Korean webnovel tradition**. A user supplies a premise and a set of requirements (genre,
characters, world concept, tropes, forbidden developments, audience, tone, romance preferences,
progression system, ending preference, chapter count, target words per chapter, mandatory scenes, content
restrictions) and, later, running directions and corrections. The studio turns those inputs into a story
specification, a story bible, a hierarchical series plan, per-chapter contracts, **natural prose
composed directly in the project's manuscript language (English or Korean, ADR-0054)**, edited and
continuity-checked chapters, a canonical story memory that stays
coherent across hundreds or thousands of chapters, and an exportable manuscript. It does this with many
purposeful, individually audited LLM calls orchestrated by durable workflows over a canonical story
database — never with one enormous prompt or one long chat.

**Governing principle (ADR-0026 as amended by ADR-0054): the manuscript language is per project (English
or Korean); Korean webnovel is the narrative tradition.** The product is not a translator: it composes
directly in the project's manuscript language and never translates inside the generation loop, and it
never produces prose that imitates another language's grammar. What it inherits from Korean web fiction is *form* —
episode-level hooks, local payoff every chapter, progression cadence, dialogue-forward scenes, controlled
exposition, mobile-readable paragraphs, cliffhangers, and the genre conventions of hunter/gate, regression,
academy, murim, romance-fantasy, villainess and related categories.

## 2. The two problems this product exists to solve

### 2.1 "It reads like a Western novel" / "It reads like a translation"

Earlier attempts produced two opposite failures: prose that was either **Western in bones** (long
descriptive paragraphs, slow openings, literary interiority, epic-fantasy pacing, no serial momentum) or,
when pushed toward "Korean webnovel", **translation-like English** (calqued idioms, odd honorific
transliterations, dropped articles, Korean word order). A single "write like a Korean webnovel in English"
instruction does not survive a multi-call pipeline. Yeonjae Studio solves this **architecturally**:

- A versioned **Narrative Identity** is compiled into a block that is *mandatory* on every style-sensitive
  LLM call. It contains two contracts the gateway **fails closed** without (ADR-0027): the **Output-Language
  Contract** (natural, idiomatic English; compose directly; spelling locale; no translation-like syntax) and
  the **Narrative-Tradition Contract** (Korean serialized-webnovel structure, pacing, hooks, payoff,
  progression cadence, exposition control, dialogue-forward scenes; no Western-novel pacing; no imitation
  of named authors), plus genre, setting/culture, naming, dialogue-register, terminology and user-preference
  profiles.
- Quality is measured on **separate dimensions**: English prose quality, Korean-webnovel structural
  adherence, genre-profile adherence, character voice, and continuity — with deterministic **English prose
  lint** and **structure lint**, and evidence-bound model judges calibrated on contrast sets that include
  Western-structured English, translation-like English, over-literary English and weak serialized
  construction.
- Drift is repaired at the **passage level** with targeted patches, not by regenerating chapters.

### 2.2 "It forgets what happened"

The model is never the memory. The application holds **canon** in Postgres: bitemporal facts with exact
manuscript evidence, canonical events with reality frames (canonical / flashback / dream / lie /
prediction / plan / prior-loop), a proposition-centric **knowledge ledger** that records what each
character (and the narrator and the reader) knows, suspects, falsely believes, or pretends, relationship
states (including the abstract formality and address terms that the English dialogue register renders),
timelines, promise ledger, and hierarchical summaries. A **Context Pack** for every chapter is assembled
deterministically from canon under a token budget with protected tiers, versioned, and recorded. Only an
**accepted** chapter may update canon, through a two-extractor reconciliation with evidence verification
and a single **atomic canon commit**. Rejected drafts never touch canon.

## 3. Who it is for

| Persona | Need | How the studio serves it |
| --- | --- | --- |
| **Solo author writing English-language serials in the Korean webnovel tradition (primary)** | Produce a long serialized novel from a concept, keep control over story truth, fix mistakes without rewriting everything | Assisted mode with approval gates, canon inspector, corrections/retcons, targeted regeneration |
| **Small studio / editor** | Run several series, review quality and continuity, keep costs predictable | Workspaces, review queues, scorecards, budgets, audit trail |
| **Platform / publisher team (later)** | Export-ready manuscripts, disclosure options, rights provenance | Export profiles, AI-assistance disclosure, provenance records |

Not for: readers (no reading app), translation of existing Korean works, or imitation of specific
authors/works.

## 4. Product principles

1. **Application-owned truth.** Canon lives in the database, with evidence. The model proposes; the system
   verifies and commits.
2. **English manuscript, Korean-webnovel form.** The output language and the narrative tradition are
   separate, explicit, versioned contracts present on every style-sensitive call.
3. **Planned ≠ happened.** Plans, predictions, dreams, lies and rejected drafts are stored in their own
   frames and can never be mistaken for canon.
4. **Purposeful calls.** Every LLM call has a role, a versioned prompt, a context pack, a schema, a budget
   and an audit record. Volume of calls is not a proxy for quality.
5. **Repair locally.** Prefer a sentence/paragraph/scene patch over a chapter rewrite; regression-test the
   patch.
6. **Durable and resumable.** Any workflow can be paused, crash, or be cancelled and resume from the last
   checkpoint without duplicating spend or corrupting state.
7. **Human in control.** Assisted mode is the default. Autopilot is opt-in with hard budgets and
   escalation.
8. **Provider-independent.** Any capable model can fill any role via the gateway; different roles use
   different models; prose models are qualified on natural English under Korean-webnovel structural
   constraints.
9. **Rights-respecting.** No scraping or imitation of commercial works or living authors; exemplars are
   project-generated, user-owned or licensed; provenance recorded.
10. **Calibrated, not dogmatic.** Numeric style thresholds are configuration with documented starting
    values, tuned per project from contrast sets and reviewer feedback (ADR-0029).

## 5. What the studio produces (artifact chain)

```
Requirements ─► Story Spec (hard / soft / assumptions) ─► Concept candidates ─► Story Bible
   (characters + dialogue-register profiles, world, power system, factions, naming & terminology
    policies, narrative identity binding)
   ─► Series Blueprint (promise, ending, endgame requirements, seasons)
   ─► Season plan ─► Arc plans ─► Chapter Contracts ─► Scene Plans
   ─► English draft ─► evaluations ─► targeted revisions ─► approved chapter
   ─► canon extraction + verification ─► atomic canon commit
   ─► summaries / embeddings / promise updates / horizon re-planning
   ─► Export (per volume / whole series; TXT, DOCX, EPUB, platform-formatted)
```

## 6. Operating modes

| Mode | Who approves what | When to use |
| --- | --- | --- |
| **Assisted (default, MVP)** | Human approves assumptions, bible, series blueprint, each arc plan, and each chapter | First arc of any series; high-stakes chapters |
| **Semi-automatic (MVP)** | Human approves bible/blueprint/arc plans; chapters are **auto-approved** by policy when every deterministic criterion passes, there are no blocking or major issues, and each gated dimension (prose, structure, genre, voice) meets its own threshold (`policy.gates`, ADR-0041); otherwise queued for review. Acceptance always follows from the atomic canon commit (ADR-0037) | Steady-state production |
| **Autopilot (Beta)** | Human approves bible/blueprint; arcs and chapters auto-approved by policy within budget; hard escalation on blocking issues, budget exhaustion, or repeated low quality | Long backlists, trusted configurations |

Recommended initial mode: **Assisted for the story bible and the first arc, then Semi-automatic.**

## 7. Success criteria (product level)

- A 200-chapter series produced in Semi-automatic mode has **zero unresolved blocking continuity issues**
  at export and every critical fact traces to accepted manuscript text.
- Bilingual reviewers (native-quality English judgment **and** familiarity with Korean webnovel
  conventions) rate ≥ 80% of sampled chapters as both "reads as natural English" and "reads as a Korean
  webnovel of this genre" (rubrics in `docs/02-narrative-identity/05-drift-detection-and-repair.md`).
- Chapter regeneration or a retcon in chapter *k* lists every materially dependent later chapter and plan
  within seconds; nothing silently stays inconsistent.
- Any workflow interrupted at any step resumes without duplicate spend beyond one in-flight call.
- Cost per accepted chapter stays within the project's configured tier; hard limits are never exceeded.

## 8. Explicit non-goals

- Reader-facing distribution, comments hosting, monetization.
- Translating existing Korean webnovels; generating Korean-language manuscripts (the architecture keeps
  output language as an explicit contract so other languages *could* be added later, but English is the
  required and only supported output language in this plan).
- Imitating a named author, series, or platform hit; training on scraped commercial novels.
- Real-time collaborative editing (Google-Docs style) in MVP.
- General-purpose chat with the model about the novel (a constrained "ask the canon" inspector exists instead).

## 9. Key decisions at a glance (see `docs/adr/`)

TypeScript monorepo (ADR-0001) · Postgres 16 + pgvector as single system of record (ADR-0002) · Temporal
for durable workflows (ADR-0003) · provider-independent model gateway (ADR-0004) · fail-closed Narrative
Identity Guard (ADR-0005, revised by ADR-0027) · bitemporal facts with evidence (ADR-0006) · reality
frames (ADR-0007) · proposition-centric knowledge ledger with per-timeline truth (ADR-0008, ADR-0031) ·
canon extracted only from approval-locked manuscripts and accepted on atomic commit, with two-extractor reconciliation (ADR-0009, ADR-0037) · tiered
context packs with compiled active constraints (ADR-0010, ADR-0033) · hybrid retrieval (ADR-0011) ·
rolling-horizon hierarchical planning (ADR-0012) · chapter contract as unit of acceptance (ADR-0013) ·
patch-first revision (ADR-0014) · position-swapped pairwise candidate judging (ADR-0015) · prompt
registry with versioning (ADR-0016) · English prose tooling replaces the Korean NLP sidecar (ADR-0017
superseded by ADR-0028) · hard budgets (ADR-0018) · Assisted as default mode (ADR-0019) · workspace
isolation with RLS (ADR-0020) · repository structure (ADR-0021) · immutable manuscript versions
(ADR-0022) · timelines for regression loops (ADR-0023) · language-neutral length model (ADR-0024 superseded
by ADR-0030's addressing + ADR-0034 length) · exemplar and imitation policy (ADR-0025) · **English
manuscript / Korean-webnovel tradition (ADR-0026)** · calibration-dependent thresholds (ADR-0029) ·
Unicode code-point addressing (ADR-0030) · material vs contextual dependency edges (ADR-0032) ·
provider-independent embedding migrations (ADR-0035) · MVP vertical slice (ADR-0036).
