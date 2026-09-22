# Yeonjae Studio (연재 스튜디오) — Planning Package

**Status:** Checkpoint 7 (interface and hardening) is **merged upstream** via [PR #10](https://github.com/jsisiwb/New/pull/10) at `59d62752f31261a0c86921603993f37992194dd2`. **Phase 4 — MVP hardening is ACTIVE and incomplete.** Its credential-free DETERMINISTIC portions are merged upstream via [PR #12](https://github.com/jsisiwb/New/pull/12) at `99e6bf5ccf962c2283589745ccbef7983cb682d6`, and the reviewed 100-set contrast corpus is merged upstream via [PR #13](https://github.com/jsisiwb/New/pull/13) at merge commit `4df7d92ff3d1641da0f0f270940aa31d33c7cc89` (parents `99e6bf5ccf962c2283589745ccbef7983cb682d6` and `bafc9cc23ce632608f38ed3984ea5c0ccc3b72df`), which is the current head of the upstream base/default development branch `hoplite/ainos-1ac771f8`. Merged deterministic work: the 120-chapter continuity replay, the deterministic chaos/provider-fallback drills, a disposable-PostgreSQL logical backup/restore drill, the defensive security suite with CI gates, blinded reviewer-packet tooling, deterministic attempt-level cost accounting, and the 100-set contrast corpus. A release-gate review of the PR #12 branch repaired two defects: **D-6**, where fractional provider cost was truncated so every real call reported as zero spend (now exact integer millicents internally, cents at the boundary), and **D-7**, where `pnpm check` omitted all five hardening suites despite being documented as CI-minus-gitleaks.

**Corpus state at `4df7d92f`, reproduced locally:** **100 accepted contrast sets** (`cs-001`–`cs-100`), 2,000 deterministic evaluations, 700/700 agreement, 0 false positives, 0 false negatives, distinctness threshold unchanged at **0.60** (maximum observed Jaccard similarity 0.419), corpus hash `sha256:4c9ef2225e0e72ada566401183c453b19b7383c29cfac1a5617958aaeadbb97b`, calibration status **`uncalibrated`**. **B-4-5a — the automated expansion to 100 distinct sets — is implemented. B-4-5 as a whole remains incomplete** because no bilingual human-review or calibration round has occurred: no reviewer has seen a packet, no judgment exists, and evaluator thresholds are therefore uncalibrated (ADR-0029).

**Active-request cancellation (Phase 4) is implemented for its automated scope.** A durable job cancellation now reaches a provider request that is ALREADY RUNNING rather than only preventing the next workflow step: `Provider.complete` receives a composed `AbortSignal`, the gateway races the call against it, and no retry, bounded repair or route fallback may begin after an authoritative cancellation. Operator cancellation, a call deadline, Temporal activity cancellation, worker shutdown and lease loss are five distinct, stable classifications, and the first one to fire stays authoritative. A cancelled call writes one truthful audit row (migration 0012): usage the provider reported is preserved and priced exactly, usage it did not report is recorded as **unknown rather than zero**, and remote cancellation is recorded as `acknowledged` only on a positive provider acknowledgement — otherwise `unsupported` or `unknown`. **Nothing in this system claims that remote provider computation stopped without that acknowledgement.** A cancellation that loses the race with the atomic canon commit is `too_late`: accepted canon is never retracted. Lease fencing and the in-transaction fence assertion remain authoritative, and existing uncancelled retry, fallback and replay behaviour is unchanged.

**No live-provider calls and no credentials** were used: every model call in tests and CI is replayed, and the gateway contains no HTTP client. **Phase 4 remains incomplete** — the live 20-chapter five-night run, the real-provider outage drill, staging/production restore, PITR, live credential rotation, real billing calibration and the bilingual reviewer round are all still unrun. Other limitations stay open and recorded rather than closed: metrics and rate limiting are per process; a cancelled call's *remote* billing may be genuinely unknown, and this system records that rather than guessing; vector retrieval is an interface only; no production deployment has occurred. Nothing here is evidence of live-model prose quality. See `docs/08-delivery/09-progress.md` for the authoritative, itemized state, test inventory and CI evidence per PR.
Live status: `docs/08-delivery/09-progress.md`.
**Quick start — write a novel (ADR-0051).** With Postgres 16 and a model API key:

```bash
pnpm install && pnpm cli db:migrate
export YEONJAE_PROVIDER_MODE=live YEONJAE_LIVE_PROVIDER=openai YEONJAE_LIVE_API_KEY=… \
       YEONJAE_MODEL_DEFAULT=<model> YEONJAE_MODEL_R=<strong-planning-model>
pnpm --filter @yeonjae/api start          # API + inline novel runner on :8080
pnpm --filter @yeonjae/web dev            # operator console → "New novel"
```

Or from the CLI: `pnpm cli project:create "Title"`, `pnpm cli novel:start <project> intake.json`,
`pnpm cli novel:approve <project> <concept-id>`, `pnpm cli novel:run <project>`. The studio interprets the
intake, proposes story directions, and after approval builds the complete Story Bible (cast, world,
progression system, series blueprint, promises) before writing every chapter through the checkpointed,
audited production loop. See `.env.example` for every variable (names only).

**Purpose of this repository state:** a complete, internally consistent, production-level plan for an AI
serialized-fiction production studio, written so that an engineering agent can implement it without
redesigning the system.

> **Governing principle: the manuscript language is per project (English or Korean); Korean webnovel is
> the narrative tradition.**
> The studio composes reader-facing prose **directly in the project's manuscript language** while preserving the narrative
> DNA of Korean serialized web fiction — episode hooks, local chapter payoff, progression cadence,
> controlled exposition, dialogue-forward scenes, mobile-readable paragraphs, strong forward pull, and the
> genre conventions of Korean webnovel categories. It is **not** a translation product and never
> generates Korean prose as an intermediate step.

Yeonjae Studio turns a short premise plus requirements (genre, characters, tropes, forbidden developments,
tone, chapter count, target words per chapter, mandatory scenes, content restrictions, running
directions) into a complete serialized novel: story specification, story bible, characters, world,
progression rules, series/season/arc plans, chapter contracts, scene plans, English prose, editing,
evaluation, revision, continuity management, canon memory, and manuscript export.

It is designed as a **stateful, resumable, auditable novel-production studio** — many purposeful LLM calls
orchestrated by durable workflows over a canonical story database — not one giant prompt or one long chat.

The two problems this plan treats as first-class architecture (not as prompt wording):

1. **Narrative identity enforcement** — every style-sensitive LLM call carries a compiled, versioned
   **Narrative Identity Block** made of an *English output-language contract* and a *Korean-webnovel
   narrative-tradition contract* (plus genre, setting, naming, dialogue-register, terminology and
   preference profiles). The gateway fails closed without both. English fluency and Korean-webnovel
   structural adherence are detected and repaired as **separate** quality dimensions.
   See `docs/02-narrative-identity/`.
2. **Long-range context and canon memory** — the application, not the model, is the authoritative memory.
   Temporal facts with evidence, per-character knowledge, planned-vs-happened separation, quarantined
   rejected drafts, atomic canon commits, and deterministic context-pack assembly.
   See `docs/04-memory-canon/`.

## How to read this package

| If you want to… | Start here |
| --- | --- |
| Understand the product in 10 minutes | `docs/00-overview/01-executive-product-definition.md` |
| Know what is in the MVP vertical slice vs later | `docs/00-overview/03-scope-and-release-tiers.md` |
| Check requirements (incl. the governing OUTPUT-EN / STYLE-KWN requirements) | `docs/01-requirements/` |
| Understand narrative identity enforcement | `docs/02-narrative-identity/01-narrative-identity-architecture.md` |
| Understand memory, canon, knowledge | `docs/04-memory-canon/01-context-and-memory-architecture.md` |
| Understand the generation pipeline | `docs/05-generation/01-generation-pipeline.md` |
| Build the system | `docs/06-system/` + `schemas/` + `docs/08-delivery/05-implementation-handoff-guide.md` |
| See why decisions were made | `docs/adr/` (ADR-0026 is the governing decision) |
| Verify the plan answers the hard questions | `docs/08-delivery/07-plan-audit.md` |
| See what the Checkpoint 0 audit found and changed | `docs/08-delivery/10-baseline-audit-report.md` |
| Know the current implementation state | `docs/08-delivery/09-progress.md` |
| Start implementing | `AGENTS.md`, then `docs/08-delivery/01-implementation-roadmap.md` and `02-backlog.md` |

## Repository layout (planning phase)

```
README.md                      this file
AGENTS.md                      instructions for engineering agents working in this repo
docs/
  00-overview/                 product definition, glossary, scope & tiers
  01-requirements/             functional / nonfunctional requirements, user workflows, traceability
  02-narrative-identity/       output-language + narrative-tradition architecture, profiles, genre catalog,
                               English prose & structure lint, drift detection, dialogue register, terminology
  03-story-planning/           hierarchical planning, promise ledger, chapter contracts
  04-memory-canon/             context/memory, canon & temporal state, character knowledge, context packs, retrieval
  05-generation/               generation pipeline, evaluation & revision, prompt architecture, role catalog
  06-system/                   system, data, API, workflow reliability, cost/observability, security/rights, UI
  07-quality/                  testing strategy, fixture story, definition of done
  08-delivery/                 roadmap, backlog, risks, open questions, handoff guide, plan audit
  adr/                         architecture decision records
schemas/                       JSON Schema (2020-12) for the core machine-readable objects
examples/                      example instances of the schemas (English fixture story data, narrative profiles)
tools/                         planning-package validator (schemas + $ref resolution, examples, canon-delta union,
                               evidence offsets against fixture manuscripts, cross-file references, stale terms,
                               truthfulness checks) — run in CI
```

## Naming and language conventions

- **Yeonjae (연재)** = "serialization" — the product is a serialized-fiction production studio.
- Documents are written in English. Korean appears only as **terminology** (names of the tradition's craft
  concepts such as 사이다, 회귀, 상태창, always glossed in English), as **source-culture notes**, or inside
  the **terminology and naming policies** that decide how such terms are rendered in English manuscripts.
- Domain terms are defined once in `docs/00-overview/02-glossary.md` and used consistently everywhere else.
- Language-bearing text fields in schemas are language-neutral (`text`, `summary`, `statement`) with
  explicit `language` metadata where the language can vary; **manuscript text is English (`en`)**.

## Validation

```
pip install jsonschema
python3 tools/validate-planning-package.py        # exit 0 = green; --quiet hides per-file [ok] lines
```

## Non-goals of this repository state

- No secrets, keys, or credentials. Provider configuration is described, never populated.
