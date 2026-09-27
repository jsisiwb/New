# ADR-0130: Accepted continuity for the contract critic

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** live multi-chapter arrival verification
- **Relates to:** ADR-0061, ADR-0088, ADR-0128

## Context

The chapter contract planner reads the previous accepted chapter's summary and ending hook plus current canonical facts. Its critic received only the proposed contract and original bible state. A live chapter-two critique suggested adding a conversation before entering a shelter already reached in chapter one. The scene critic already receives the richer context pack; the contract critic needs the same accepted-state precedence at its earlier boundary.

## Decision

For the arrival-contract policy and chapters after the first, append the existing accepted previous summary/hook and current canonical-fact rendering to the contract critic's `canon_state` input. Label them as accepted history and explicitly give them precedence over initial bible state. Use the same project-scoped data already supplied to the contract planner, with no new draft or future-plan source. Capture the context once before the bounded critique/repair loop. On the same policy, render JSON-backed canonical fact values as well as text-backed values; the previous planner rendering silently left JSON values blank. Preserve strings as strings and render structured values as JSON. Older policies and chapter one keep their existing inputs. Prompt files and policy pins remain unchanged; this corrects the data supplied to an existing variable.

## Consequences

Verify the actual chapter-two critic call against the accepted summary stored in Postgres, including its ending hook. Test the preceding policy boundary. The scene planner, scene critic and writer retain their existing accepted-memory packs. This does not make a model follow every critique correctly, but removes an avoidable stale-state input.
