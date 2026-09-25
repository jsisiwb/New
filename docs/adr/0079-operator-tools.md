# ADR-0079: Operator tools — pack inspection, story state, cost projection, prompt sizes

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering, product owner
- **Relates to:** ADR-0075 (Korean pack budgets), ADR-0072 (`provider:check`, run heartbeat), ADR-0061
  (`series:audit`), `docs/08-delivery/06-operations-runbooks-outline.md`.

## Context

Every live defect of this phase was diagnosed with a throwaway script. The live `standard.v7` stop
(`PACK_FAILED`, 20,928 tokens against 20,000) had to be rebuilt offline to see which section was large.
Cost questions ("what does a 200-화 serial take?") had to be answered by hand from the audit table.
Pruning the prompts needs their sizes. The CLI had the run report, the series audit and the Korean lint, but
nothing for any of these.

## Decision

Five read-only commands. None calls a model, writes canon or creates a job.

- **`pack:inspect <project> <chapter> <role> [--budget=N] [--json]`** rebuilds the pack the role would
  receive from the chapter's stored contract and spec. For checker roles it uses the chapter's latest
  version; an accepted chapter is measured as its text. It reports every section's items and estimator
  tokens, then assembles against the pinned budget (or `--budget`) and prints the tiers and ladder steps, or
  the overflow message. A chapter without a job is refused, so inspection never creates one.
- **`story:state <project>`** shows run status, accepted chapters, the last accepted chapter's summary, arc
  summaries (ADR-0076), open, overdue and paid promises, and the canon version.
- **`cost:project <project> [--chapters=200]`** reads the audit's calls, tokens and model time per chapter
  (from each call's idempotency key) and for the story plan. It projects the plan once plus the observed
  mean chapter times N. Model time is the sum of call latencies, an upper bound on wall-clock time.
- **`contract:show <project> <chapter>`** prints the chapter's latest stored contract.
- **`prompts:size [--json]`** lists the static size of every active prompt, largest first, measured with
  the Korean estimator for Korean prompts.

## Consequences

- `pack:inspect` reproduces the live v7 overflow from the stored project state (20,928 against 20,000,
  ladder `compact_states_beyond_top4`) and shows that it fits the `standard.v8` budget (21,288 of 34,000, no
  ladder step).
- `cost:project` on the live `standard.v8` project (one chapter observed: 39 calls, 139,419 / 15,264 tokens,
  22.7 model-minutes) projects 200 chapters to about 7,800 calls, 27.9M input / 3.1M output tokens and
  ~76 model-hours. Revision rounds dominate: a chapter that passes on its first evaluation costs about half.
- `prompts:size`: the largest active prompts are the chapter planner (6,781 estimator tokens), the story
  architect (3,855), the arc planner (3,315) and the character designer (3,134). That is where pruning would
  pay first. No prompt was pruned here: a pruned prompt is a new version and needs A/B evidence (Phase B).
- Evidence: `ops-tools.test.ts` (projection arithmetic; prompt sizes over the active set) and
  `ops-tools.integration.test.ts`. The integration test runs a simulated two-chapter run, inspects the
  writer and checker packs of chapter 2 without creating a job or a call, reports an overflow under a
  tight budget, and checks the story state and the projection.
