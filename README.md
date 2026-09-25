# Yeonjae Studio (연재 스튜디오)

An AI production studio for **serialized web novels**: a Korean 연재형 웹소설 of 200+ 화 (about 5,000–5,500자
each) written directly in Korean, or an English serial written in the same Korean-webnovel tradition. The
repository holds the plan (`docs/`, `schemas/`, `examples/`, `tools/`) and its implementation, a pnpm
workspace: `apps/cli`, `apps/api`, `apps/web`, `apps/worker` and `packages/*` (domain, db, gateway, prompts,
narrative, prose, context, canon, eval, workflows). What is built, what has run live and what has not is
recorded only in `docs/08-delivery/09-progress.md` (ADR-0043). For the whole pipeline in one read, see
[`docs/HOW-A-KOREAN-NOVEL-IS-MADE.md`](docs/HOW-A-KOREAN-NOVEL-IS-MADE.md).

## Quick start — a Korean serial from the CLI

Requirements: Node 22, pnpm 10, PostgreSQL 16, and a model provider (`.env.example` lists every variable,
names only).

```bash
pnpm install && pnpm build && pnpm cli db:migrate
export YEONJAE_PROVIDER_MODE=notion          # or live / genspark / simulated / replay
pnpm cli project:create "제목" --policy=policy/standard@24
pnpm cli novel:start <project> intake.json    # intake → story spec → two story directions
pnpm cli novel:approve <project> <concept-id> --stop-after=3
pnpm cli novel:run <project> --status-file=run.json
```

The intake is configuration, not prose: premise, genre, characters, tone, forbidden developments,
`"manuscript_language": "ko"`, `target_characters_per_chapter` (자), and optionally `pov`, `style_sample`,
`contrast_pairs`, `platform` (`ops/live-runs/phase-a-v7-intake.json` is the one the live runs used). After
approval the studio builds the full Story Bible (cast in batches, world, progression system, series blueprint,
promises) and then writes chapter after chapter through the checkpointed, audited production loop. A chapter
that cannot pass its gates stops as `needs_attention` with the reason; nothing unapproved reaches canon.

**Which policy.** Policies are pinned per project and never change under it; every new behaviour is a new
version. For a new Korean project use the newest `standard`:

| Policy | Adds (each also contains everything above it) | ADR |
| --- | --- | --- |
| `standard@6` | provider retry with backoff, bible cast in three batches | 0072 |
| `standard@7` | `lang/ko@6` Korean lint, point of view, style sample, contrast pairs, serial-rhythm directives, polish round | 0073, 0074 |
| `standard@8` | pack budgets sized for Korean, scene length calibration | 0075 |
| `standard@9` | arc summaries for long-story memory | 0076 |
| `standard@10` | one patch per cluster of findings in a revision round | 0077 |
| `standard@11` | patch regression measured against the parent version | 0078 |
| `standard@12` | Gemini on every role: prompt ceilings per policy, judges that quote their weakest passages, one paragraph per line, refusal rule | 0080, 0081 |
| `standard@13` | the operator's voice: corpus-calibrated `lang/ko@7`, voice profile, the operator's passages as exemplars, the corpus copy check | 0082, 0083 |
| `standard@14` | dialogue floor and scene partner, reader secrets in the scene plan, the premise device's vocabulary, re-judging open majors | 0084 |
| `standard@15` | reveal schedule, talk partner and countable talk targets, the cut as the last beat, time frames, the plan critic, findings attributed to the patch, full confirmation before approval | 0086 |
| `standard@16` | the escalation ladder: two candidate patches per cluster chosen by lint, a scene rewrite for the kinds patches rarely fix | 0087 |
| `standard@17` | the narrator's remembered knowledge is the reader's, the contract critic, repeated lines dropped, `voice/operator@2`, five Korean rounds | 0088 |
| `standard@18` | relationships dated and not canon before they begin, the 회빙환 overlay in the device's own words, provenance tags stripped, `lang/ko@8` | 0089 |
| `standard@19` | the narrator's present knowledge, the operator's device words, the 먼치킨 premise, a per-scene point-of-view redraft, pronouns inside the operator's band | 0090 |
| `standard@20` | the reveal schedule in every canon line, the heroine formula inside it (`voice/operator@3`), score attribution, quoteless findings rewritten in their scene, no repeated round, checked scene rewrites | 0092 |
| `standard@21` | the untried rung before any stop, net improvement with hard protections, the length band protected and length findings rewritten in their scene, secrets dated by the meeting they presuppose, `lang/ko@9` | 0093 |
| `standard@22` | secret owners named in the canon lines, arc-plan stances normalized | 0094 |
| `standard@23` | the talk band cap (judges' dialogue-amount findings inside the operator's band are minor), variance-free revision weights | 0095 |
| `standard@24` | arc-plan beat types normalized, per-hit pronoun markers inside the operator's pronoun band recorded as notes | 0096 |

**Watching a run.**

- `pnpm cli quality:run-report <project>` — what the run persisted.
- `pnpm cli story:state <project>` — where the serial stands.
- `pnpm cli pack:inspect <project> <chapter> <role>` — a context pack against its budget.
- `pnpm cli cost:project <project> --chapters=200` — the audit projected to a whole serial.
- `pnpm cli provider:check` — per-class routing.

The API with an inline novel runner and the operator console are `pnpm --filter @yeonjae/api start` and
`pnpm --filter @yeonjae/web dev`. `pnpm check` runs everything CI runs.

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
