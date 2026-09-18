# ADR-0049: Durable cancellation aborts the in-flight provider request, and records only what is known about the remote side

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** engineering agent (Phase 4 hardening, item 7a)
- **Relates to:** ADR-0047 (Temporal adapter over checkpointed steps), ADR-0048 (atomic lease fencing),
  ADR-0044 (modular monolith first), migration `0002_gateway_audit.sql`, migration
  `0011_attempt_provenance.sql`, migration `0012_cancellation_provenance.sql`,
  `docs/06-system/07-model-gateway.md`, `docs/06-system/04-workflow-reliability-plan.md`,
  `docs/08-delivery/11-deployment-and-incident-runbooks.md` §9.4

## Context

`jobs.control = 'cancel'` was a durable intent observed in exactly one place: `checkpointControl`, called
by `runStep` **before** each unit of work. That placement is deliberate and correct for what it guarantees
— nothing is torn in half, so a cancelled run never leaves a partially committed canon delta behind, which
is the invariant the whole Checkpoint 2–6 acceptance path depends on.

It is also, on its own, not enough. Observing an intent only between units of work means the **current**
unit runs to completion, and in this pipeline the current unit is usually a model call — the longest and
most expensive operation in the system. An operator cancelling a chapter mid-draft therefore waited for
the very call they were trying to stop. The honest limitations list said as much: "fencing prevents a
stale commit but cannot abort an already-running provider request."

The interface for fixing this already existed and had never been used. `Provider.complete(req, signal?)`
accepted an `AbortSignal` from the first version of the gateway contract; no caller ever passed one. So
the gap was not a missing abstraction, it was missing wiring — plus three decisions that wiring alone does
not settle.

**First: what a cancellation IS, in a system that classifies failures to decide whether to spend again.**
B-4-2 established that fallback is authorized only for a policy-retryable failure, because rerouting a
rejected request re-sends the same bytes to a second paid model. A cancellation is the sharpest possible
case of that rule: there is no model anywhere that can satisfy a request whose requester has withdrawn it.
And the existing classifier would have got this exactly wrong — its transport pattern matches the word
`aborted`, so an abort would have been classified `retryable_transport` and rerouted. Silence on this
point would have turned one cancellation into N paid attempts.

**Second: five different things abort the same local request.** An operator's decision, a call deadline,
Temporal cancelling the activity, the worker draining, and the lease being stolen all close the same
socket, and they mean five different things to the operator reading the audit afterwards. Collapsing them
into one "cancelled" state would make the record useless for the question it exists to answer: *why did
this stop, and should I do something?*

**Third, and the one that actually shapes the schema: aborting a request is not stopping remote work.**
Closing a connection tells us nothing about whether the provider kept generating, and nothing about
whether it will bill for what it generated. The tempting implementation — record a cancelled call as zero
tokens and zero cost — is false in a way that is invisible until an invoice arrives, and it is precisely
the class of defect the D-6 cost repair was about (fractional cost truncated to zero, so every real call
reported as free).

## Decision

**1. The durable intent reaches the running request, through a composed signal and a race.**
The gateway builds one cancellation handle per call, passes its signal into `Provider.complete`, **and**
races the returned promise against the abort. Both halves are required: the signal lets a cooperative
adapter tear down its own socket promptly, and the race means the gateway stops waiting even for an
adapter that ignores the signal entirely. Without the race, cancellation would depend on adapter goodwill,
which is not a guarantee.

**2. One gate before every attempt covers retry, repair and fallback.**
Retry, bounded repair and route fallback are all expressed in this codebase as another iteration of the
same attempt loop. Refusing to begin an iteration after an authoritative cancellation therefore makes "no
retry", "no repair" and "no fallback" a single property with a single enforcement point, rather than three
rules that can drift apart.

**3. Cancellation is its own failure class and its own workflow code.**
`FailureClass` gains `cancelled`, which is not retryable, and the check for it runs **before** both
`ProviderFailure` and the message patterns, for the `aborted` reason above. `WorkflowErrorCode` gains
`CANCELLED`, recognized by error *shape* rather than by text, and it is non-retryable in the activity's
Temporal retry policy — a retry would start a fresh provider call for work that has been withdrawn. A
cancelled step settles the job as `cancelling`, not `failed`; the single terminal write stays where it
already was, in `checkpointControl` and the orchestrator's cleanup.

**4. Five reasons, first-wins precedence.**
`operator_cancelled`, `timeout`, `activity_cancelled`, `worker_shutdown`, `lease_lost`, carried as
distinct values on one error type. The first cause to fire stays authoritative, so a deadline expiring a
moment after an operator acts never relabels their decision as a provider fault. Overall precedence,
highest first: a completed atomic canon commit (`cancel_too_late`) → lease loss (`LEASE_LOST`) →
authoritative cancellation → deadline (`timeout`) → ordinary provider failure.

**5. Remote state is recorded as knowledge, not as a conclusion.**
`remote_cancellation` is `acknowledged` **only** on a positive provider acknowledgement, and otherwise
`unsupported` or `unknown`. There is deliberately no value meaning "we are confident it stopped". Usage
the provider reported — including on a response that arrived after the abort and was discarded — is
preserved and priced with the same integer millicent arithmetic as every other row. Usage it did not
report is `unknown`, **never zero**, and `billing_status` cannot be `known` when usage is `unknown`.
Migration 0012 enforces all of this with a trigger, so the rule holds for every writer including raw SQL,
and the column inherits the table's existing append-only trigger and FORCE RLS policy — cancellation
provenance cannot be rewritten after the fact.

**Correction from the independent review.** 0012's own comment, and an earlier version of this paragraph,
claimed the column also inherited "least-privilege grants" on the basis that `llm_calls` was INSERT/SELECT
only for the request-scoped role. That was **not true**: 0007 narrowed that role table by table and never
listed `llm_calls`, so it retained UPDATE and DELETE. The append-only trigger made it unexploitable, and
the review verified both refusals directly — so this was a truthfulness and defence-in-depth defect, not a
live authorization bypass. **Migration 0013** revokes those privileges, and a test now asserts the exact
grant set, so the claim is true rather than assumed. 0013 also closes a second gap 0012 left: provenance
could be attached to a row that was *not* cancelled, producing an audit row that contradicted itself.

**6. Observation is bounded and disposed.**
The durable intent is polled with one fixed single-row query on a fixed interval, only while a call is in
flight, stopping at the first positive observation. A poll failure is treated as *no information* rather
than as a cancellation, because failing closed there would abort healthy paid calls on a transport blip.
Every listener, timer and poll handle is released on every exit path — success, provider failure, timeout
and cancellation alike.

## Alternatives considered

**Leave cancellation at step boundaries.** Zero risk, and it was the status quo. Rejected because the
limitation is real and operator-visible: the operation an operator most wants to stop is the one that
boundary-only cancellation cannot stop.

**Cancel by killing the worker.** Effective and simple. Rejected because it discards the durable
bookkeeping that makes a cancelled run resumable and auditable, and because it cannot distinguish a
cancelled job from a crashed one — the exact distinction `lease_lost` and `worker_shutdown` exist to
preserve.

**Postgres `LISTEN/NOTIFY` for the intent.** Lower latency than polling. Rejected for now because it needs
a dedicated connection held for the lifetime of every provider call, and because a second notification
substrate is a second thing that can silently stop working. One bounded query on a fixed interval is the
smallest mechanism that observes the intent promptly; `LISTEN` remains available later without changing
this contract.

**Decompose the pipeline into Temporal activities so cancellation is native.** Rejected for the same
reason ADR-0047 rejected it: it would fork the canon invariants into a second, weaker orchestration, and
the first divergence between them would be a canon bug.

**Record a cancelled call as zero cost.** Rejected outright. It is a false claim about money, and it is
the same failure mode as defect D-6.

## Consequences

Cancellation is now prompt as well as safe, and an operator can read exactly why a call stopped and what
is known about its cost. `AuditRecord`, `GatewayAuditLike` and `llm_calls` gain one optional field;
absence continues to mean "not cancelled", so existing rows and existing consumers are untouched, and a
caller that supplies no cancellation options behaves exactly as before.

Two honest limits follow directly from decision 5 and must not be papered over. **Remote cancellation is
unconfirmed in this repository**: no deterministic provider can acknowledge anything, so every cancelled
call here records `unsupported` or `unknown`, and confirming real remote cancellation needs a live
provider API that has not been exercised. **A cancelled call's remote billing may be genuinely unknown**,
and is reconciled from an invoice rather than inferred from the audit row. Neither this ADR nor the
implementation completes B-4-5 or Phase 4.

A small amount of duplication is accepted deliberately: `packages/db` mirrors the cancellation shape
structurally rather than importing `@yeonjae/gateway`, as the rest of `GatewayAuditLike` already does, so
a divergence becomes a compile error at the seam instead of a silently widened column.
