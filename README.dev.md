# Developing Yeonjae Studio

## Prerequisites

- Node 22 LTS (`.nvmrc`), pnpm 10 (`corepack enable` or `npm i -g pnpm@10`)
- Python 3.12 with `jsonschema` for the planning validator (`pip install jsonschema`)
- Postgres 16 (Checkpoint 2 onward; not needed for Checkpoint 1)

## Commands

| Command                                           | What it does                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm install`                                    | install the workspace                                                             |
| `pnpm gen:types`                                  | regenerate `packages/domain/src/generated` from `schemas/` (commit the result)    |
| `pnpm check:types-fresh`                          | fail if generated types are stale (CI)                                            |
| `pnpm typecheck`                                  | `tsc -b` over all packages (strict)                                               |
| `pnpm lint` / `pnpm format` / `pnpm format:check` | ESLint (type-aware) / Prettier — never touches `examples/`, `docs/`, `schemas/`   |
| `pnpm test`                                       | Vitest unit tests                                                                 |
| `pnpm validate:planning`                          | planning-package validator (schemas, examples, evidence, references, stale terms) |
| `pnpm check`                                      | everything CI runs                                                                |
| `pnpm cli <command>`                              | the CLI (`pnpm cli` prints usage)                                                 |

## Layout (ADR-0021, ADR-0044)

```
apps/cli            operator surface for the core loop (first app; API/web/worker come in Checkpoint 7)
packages/prose      NFC boundary, code-point addressing, evidence verification, paragraphs, length model,
                    deterministic output-language check
packages/domain     schema loader + Ajv validators, generated types, UUIDv7, StoryClock ordering,
                    lifecycle state machines, Production Policy loader
packages/gateway    gateway request contract, provider interface, MockProvider (Guard/routing/budgets: CP3)
tools/              gen-types.ts, validate-planning-package.py
schemas/ examples/  the contracts and fixture data (validated by CI)
docs/               the plan; status lives only in docs/08-delivery/09-progress.md
```

## Rules of the road

- Schemas first: change `schemas/*.schema.json`, run `pnpm gen:types`, then code (AGENTS.md rule 3).
- All manuscript offsets are Unicode code points into NFC text — use `@yeonjae/prose`, never `string.length`.
- Numbers come from the pinned Production Policy (`examples/production-policies/`), never from code constants.
- No inline production prompts, no secrets, no Korean-to-English translation path.
