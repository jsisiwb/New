# ADR-0053: Resume workflows with their persisted prompt set

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** engineering
- **Relates to:** ADR-0016, ADR-0046, ADR-0051

## Context

The active prompt set is a default for new work, not permission to change an existing workflow's
inputs. Selecting the latest set again during resume either strands paused chapter jobs after a prompt
release or allows planning stages to mix versions. Both conflict with durable, reproducible production.

## Decision

Chapter production and story planning share one persisted-pin resolver. New jobs pin the active set;
existing jobs resolve the prompt mapping already recorded on the job and in the immutable prompt-set
registry. The resolver validates family membership, available versions and stored content hashes before
model work. A concurrent creator's persisted job is authoritative, not the losing caller's defaults.
Prompt registration uses conflict-safe insertion followed by hash verification of the winning row, so
concurrent workers can discover the same new version without either overwriting it or failing on a
duplicate-key race. Conflicting bytes for the same version remain an immutability error.

Policy version/hash and Narrative Identity reference/version must still match the project's requested
inputs. Incomplete or inconsistent stored pins, missing historical prompts and changed prompt bytes
fail closed with actionable `STEP_NONDETERMINISTIC` diagnostics. There is no fallback to a newer prompt
and no automatic rewriting of old job pins. The original canon-read pin remains recorded on resume;
step-specific context snapshots and accepted-canon gates retain their existing behavior.

## Alternatives considered

- Require draining every job before each prompt release — operationally disruptive when immutable
  historical versions are already available.
- Re-pin paused work to the latest defaults — mixes production inputs and invalidates replay guarantees.

## Consequences

Deployments may introduce new active prompt versions without stranding jobs that retain their historical
versions. Historical prompt files must remain available; removing or changing them still blocks resume.
This does not make arbitrary policy, identity or workflow-code upgrades replay-compatible. No schema
migration, backfill or new provider credential is required.
