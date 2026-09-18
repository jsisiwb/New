# Remaining external work

What is left after the credential-free automated tranche. Everything here is blocked on something this
repository cannot contain: a paid provider, a deployed environment, a secret manager, or a human.

This file is deliberately short. If an item can be done locally and deterministically, it does not belong
here — it belongs in the backlog as work to do.

**Phase 4 is NOT complete, and the MVP is not production ready.** The milestone this tranche targets is
*automated readiness*: the practical credential-free implementation, simulation and validation that should
exist before the live tranche begins.

## Blocked on a live provider

| Item | Why it cannot be done here | What is already prepared |
| --- | --- | --- |
| Live-provider connectivity and prose quality | needs paid API access | `HttpProvider` speaks the real transport; `YEONJAE_PROVIDER_MODE=live` is a validated mode |
| Confirmed REMOTE cancellation | only a real provider can acknowledge a stop | the `/v1/cancel` path and `remote_cancellation` states (`acknowledged` / `unsupported` / `unknown` / `not_requested`) are exercised against the simulator |
| Proof that remote provider computation stopped | not observable without provider cooperation | recorded as `unknown` by construction; never claimed |
| Real provider outage and fallback drills | needs an actual outage | 49 deterministic chaos scenarios plus HTTP 429/500/502/503, resets and truncation against the simulator |
| Provider usage and invoice reconciliation | needs invoices | integer-millicent accounting, `cost_known`, and unknown-cost settlement that never books zero |
| Five-night live chapter campaign | needs paid generation over five nights | the 120-chapter deterministic replay |

## Blocked on deployed infrastructure

| Item | Why it cannot be done here | What is already prepared |
| --- | --- | --- |
| Staging and production deployment | no environment exists | readiness gates on migration state, schema drift and role attributes |
| Staging/production restore and real PITR | needs a deployed database and WAL archive | local deterministic logical dump/restore with 40 invariants, including security metadata and re-executed post-restore behaviour |
| Production monitoring observation | needs a running deployment scraping `/metrics` | per-process Prometheus registry with a label allowlist |
| The privilege model verified on a deployed cluster | needs that cluster | ADR-0050's model asserted against local PostgreSQL 16 and in fork CI |
| Container topology (Dockerfiles, Compose profiles) | **no container runtime is available in this workspace** — `docker` and `podman` are both absent, so anything written here would be unvalidated YAML | the processes already start from environment variables, refuse unsafe defaults, and expose health/readiness |

## Blocked on a real secret manager

| Item | Why it cannot be done here | What is already prepared |
| --- | --- | --- |
| Live credential rotation | rotating a credential requires having one | rotation runbooks; `.env.example` lists variable names only; gitleaks gate over full history |

## Blocked on human judgment

| Item | Why it cannot be done here | What is already prepared |
| --- | --- | --- |
| Bilingual human review | needs reviewers | blinded reviewer-packet tooling |
| Evaluator threshold calibration | needs review outcomes | 100-set corpus, 2,000 deterministic evaluations, 700/700 agreement, status `uncalibrated` |
| Product-owner acceptance | a decision, not a task | — |

## Not blocked, and honestly still open

Recorded here so the list above cannot be read as "everything else is done". These are credential-free and
could be implemented next:

- wiring `SharedBudget` and the shared rate limiter into the worker's production path (the ledger, the
  limiter and their tests exist; the gateway still constructs `MemoryBudget` by default);
- a local deterministic embedding provider and versioned vector retrieval (the interface and
  `embedding_sets` lifecycle exist; the active-set switch and hybrid ranking do not);
- a project-scoped name/terminology thesaurus;
- multi-process integration tests, which additionally need the shared-database reset race fixed
  (documented in `09-progress.md`: it is inherited, needs two vitest processes, and the repository's
  single-process configuration does not hit it);
- metrics for the new rate-limit and budget signals;
- deployment manifests and alert-rule templates, which can be written and statically validated even
  without a cluster.
