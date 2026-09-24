# Yeonjae Studio (연재 스튜디오) — Planning Package

**State.** The repository holds the planning package (`docs/`, `schemas/`, `examples/`, `tools/`) and its
implementation: a pnpm workspace with `apps/cli`, `apps/api`, `apps/web`, `apps/worker` and `packages/*`
(domain, db, gateway, prompts, narrative, prose, context, canon, eval, workflows). What is built, what has run
and what has not is recorded only in `docs/08-delivery/09-progress.md` (ADR-0043); this file describes the
product and where to start.

**Quick start — write a novel (ADR-0051).** With Postgres 16 and a model provider:

```bash
pnpm install && pnpm cli db:migrate
export YEONJAE_PROVIDER_MODE=live YEONJAE_LIVE_PROVIDER=openai YEONJAE_LIVE_API_KEY=… \
       YEONJAE_MODEL_DEFAULT=<model> YEONJAE_MODEL_R=<strong-planning-model>
pnpm --filter @yeonjae/api start          # API + inline novel runner on :8080
pnpm --filter @yeonjae/web dev            # operator console → "New novel"
```

Or from the CLI: `pnpm cli project:create "Title" [--policy=<ref>]`, `pnpm cli novel:start <project> intake.json`,
`pnpm cli novel:approve <project> <concept-id>`, `pnpm cli novel:run <project>`. The studio interprets the
intake, proposes story directions, and after approval builds the complete Story Bible (cast, world,
progression system, series blueprint, promises) before writing every chapter through the checkpointed,
audited production loop. A Korean serial sets `"manuscript_language": "ko"` and
`target_characters_per_chapter` (자) in its intake (ADR-0054). `YEONJAE_PROVIDER_MODE` selects `live`, the
operator's `notion` or `genspark` bridge, `simulated` or `replay`; `pnpm cli quality:run-report <project>`
reports a run from what it persisted. See `.env.example` for every variable (names only).

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
tone, chapter count, chapter length (words, or 자 for Korean), mandatory scenes, content restrictions, running
directions) into a complete serialized novel: story specification, story bible, characters, world,
progression rules, series/season/arc plans, chapter contracts, scene plans, prose in the project's
manuscript language, editing,
evaluation, revision, continuity management, canon memory, and manuscript export.

It is designed as a **stateful, resumable, auditable novel-production studio** — many purposeful LLM calls
orchestrated by durable workflows over a canonical story database — not one giant prompt or one long chat.

The two problems this plan treats as first-class architecture (not as prompt wording):

1. **Narrative identity enforcement** — every style-sensitive LLM call carries a compiled, versioned
   **Narrative Identity Block** made of an *output-language contract* for the project's manuscript language
   (English or Korean) and a *Korean-webnovel narrative-tradition contract* (plus genre, setting, naming,
   dialogue-register, terminology and preference profiles). The gateway fails closed without both.
   Manuscript-language fluency and Korean-webnovel structural adherence are detected and repaired as
   **separate** quality dimensions.
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

## Repository layout

```
README.md                      this file
AGENTS.md                      instructions for engineering agents working in this repo
apps/                          cli (first), api (Fastify), web (Next.js operator console), worker (Temporal)
packages/                      domain, db (Postgres 16), gateway, prompts, narrative, prose, context, canon,
                               eval, workflows
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
examples/                      example instances of the schemas (English fixture story data, narrative profiles,
                               production policies)
tools/                         planning-package validator (schemas + $ref resolution, examples, canon-delta union,
                               evidence offsets against fixture manuscripts, cross-file references, stale terms,
                               truthfulness checks) — run in CI
```

## Naming and language conventions

- **Yeonjae (연재)** = "serialization" — the product is a serialized-fiction production studio.
- Documents are written in English. Korean appears only as **terminology** (names of the tradition's craft
  concepts such as 사이다, 회귀, 상태창, always glossed in English), as **source-culture notes**, or inside
  the **terminology and naming policies** that decide how such terms are rendered in a manuscript.
- Domain terms are defined once in `docs/00-overview/02-glossary.md` and used consistently everywhere else.
- Language-bearing text fields in schemas are language-neutral (`text`, `summary`, `statement`) with
  explicit `language` metadata where the language can vary; **manuscript text carries its project's
  language (`en` or `ko`, ADR-0054)**.

## Validation

```
pip install jsonschema
python3 tools/validate-planning-package.py        # exit 0 = green; --quiet hides per-file [ok] lines
```

## Non-goals of this repository state

- No secrets, keys, or credentials. Provider configuration is described, never populated.
