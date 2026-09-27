# ADR-0143: Clear pause intent after an interrupted provider call

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request to complete and harden the live generation pipeline
- **Relates to:** ADR-0091, ADR-0098

## Context

Pausing a novel during a provider call can leave its chapter job temporarily `cancelling` with control `pause`. The cancellation path uses that intermediate state before a checkpoint settles it. Novel resume cleared pause intent only for queued, running and already paused jobs. The first resumed checkpoint therefore observed the old pause request and stopped again.

## Decision

Novel resume also requeues a `cancelling` chapter/planning job whose recorded control is specifically `pause`, clearing that pause intent in the same transaction that queues the novel run. A genuinely cancelling job with control `cancel` remains untouched. Existing lease fencing and checkpoint replay remain authoritative.

No provider records, manuscripts, acceptance gates or canon history are modified by this recovery. Existing paused-job behavior is preserved.

## Consequences

One normal resume can continue after an interrupted pause without requiring a second resume to clear the stale flag. Integration tests verify the database transition, checkpoint dispatch and preservation of explicit cancellation intent.
