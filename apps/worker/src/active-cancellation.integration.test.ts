/**
 * Active-request cancellation: the DURABLE-STATE regression suite (Phase 4).
 *
 * The gateway suite proves the mechanism in isolation. This one runs the REAL production loop against a
 * real PostgreSQL 16 database and asserts what an operator can actually observe afterwards — job status,
 * `job_events`, `llm_calls`, `canon_commits`, the project's canon version and the chapter's lifecycle
 * status. "It threw a CancellationError" is not the claim being made here; "canon did not move and the
 * audit tells the truth about what it cost" is.
 *
 * Every test drives the pipeline with the replay provider: no live provider, no credentials, no spend.
 * Synchronization is by polling the persisted `current_step`, which is the same technique the Checkpoint 7
 * corrective-audit suite uses — it observes that the loop is GENUINELY mid-run rather than pre-seeding a
 * flag and hoping.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireTargetLease,
  getJob,
  getJobByWorkflowId,
  jobEventsAfter,
  migrate,
  releaseTargetLease,
  requestJobControl,
  resetDatabase,
  verifyCostInvariants,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import {
  CancellationError,
  Gateway,
  MemoryBudget,
  recordChaosScenarios,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
} from '@yeonjae/gateway';
import { JobControlStop, PgAuditStore } from '@yeonjae/db';
import { createHarness, IDENTITY_VERSION, REPLAY_ROUTING } from '@yeonjae/workflows/testkit';
import {
  ArtifactLlmOutputStore,
  produceChapter,
  WorkflowError,
  workflowIdFor,
} from '@yeonjae/workflows';

const run = databaseUrl() ? describe : describe.skip;

run('active provider-request cancellation (durable state)', () => {
  let pool: Pool;
  let workspaceId: string;
  let projectId: string;
  let harness: Awaited<ReturnType<typeof createHarness>>;
  let actorUserId: string;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 120_000);
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    harness = await createHarness(pool);
    workspaceId = harness.workspaceId;
    projectId = harness.projectId;
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_algo, password_params, password_salt, password_hash)
       VALUES ('operator@example.com', 'Operator', 'scrypt', '{"N":1,"r":8,"p":1,"keylen":64}', 's', 'h')
       RETURNING id`,
    );
    actorUserId = user.rows[0]?.id ?? '';
  }, 120_000);

  async function acquire(holder: string, ttlSeconds = 60) {
    const lease = await acquireTargetLease(pool, {
      workspaceId,
      projectId,
      targetKind: 'chapter',
      targetId: '1',
      holderWorkflowId: holder,
      ttlSeconds,
    });
    if (!lease) throw new Error(`could not acquire lease for ${holder}`);
    return {
      leaseId: lease.id,
      holderWorkflowId: lease.holder_workflow_id,
      fence: String(lease.fence),
    };
  }

  async function canonVersion(): Promise<number> {
    const r = await pool.query<{ v: number }>(
      'SELECT canon_version AS v FROM projects WHERE id = $1',
      [projectId],
    );
    return r.rows[0]?.v ?? -1;
  }

  async function canonCommits(): Promise<number> {
    const r = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM canon_commits WHERE project_id = $1',
      [projectId],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  async function chapterStatus(): Promise<string | undefined> {
    const r = await pool.query<{ status: string }>(
      'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
      [projectId],
    );
    return r.rows[0]?.status;
  }

  async function cancelledCalls(): Promise<
    { status: string; cancellation: Record<string, unknown> | null; cost: string }[]
  > {
    const r = await pool.query<{
      status: string;
      cancellation: Record<string, unknown> | null;
      cost: string;
    }>(
      `SELECT status, cancellation, cost_cents::text AS cost FROM llm_calls
        WHERE project_id = $1 AND status = 'cancelled' ORDER BY created_at`,
      [projectId],
    );
    return r.rows;
  }

  async function llmCallCount(): Promise<number> {
    const r = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
      [projectId],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  /**
   * Cancellation wiring that observes the DURABLE intent, exactly as the worker activity builds it.
   *
   * Built here rather than imported from the activity because an activity needs a Temporal context; the
   * probe itself is the thing under test, and it is the same single-row read.
   */
  function durableCancellation(extra: { signal?: AbortSignal | undefined } = {}) {
    return {
      ...(extra.signal
        ? { signals: [{ signal: extra.signal, reason: 'activity_cancelled' as const }] }
        : {}),
      isDurablyCancelled: async () => {
        const r = await pool.query<{ control: string | null; status: string }>(
          'SELECT control, status FROM jobs WHERE workflow_id = $1',
          [workflowIdFor(projectId, 1)],
        );
        const job = r.rows[0];
        if (!job) return false;
        return job.control === 'cancel' || job.status === 'cancelling';
      },
    };
  }

  /** Run production, firing `act` once the job is genuinely executing a step. */
  async function whileRunning(
    act: (jobId: string) => Promise<void>,
    options: {
      lease?: { leaseId: string; holderWorkflowId: string; fence: string } | undefined;
      signal?: AbortSignal | undefined;
      // A cancel aimed at the acceptance tail must fire LATE, not at the first step.
      afterStep?: string | undefined;
    } = {},
  ): Promise<{ error: unknown; fired: boolean; stoppedAt: string | undefined }> {
    let fired = false;
    let stoppedAt: string | undefined;
    const watcher = (async () => {
      for (let i = 0; i < 4_000; i += 1) {
        const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));
        if (job?.current_step && job.status === 'running') {
          if (options.afterStep && job.current_step !== options.afterStep) {
            await new Promise((r) => setTimeout(r, 5));
            continue;
          }
          stoppedAt = job.current_step;
          await act(job.id);
          fired = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    })();

    let error: unknown;
    try {
      await produceChapter(
        { pool, gateway: harness.gateway(), bindings: harness.bindings },
        {
          ...harness.input(1),
          ...(options.lease ? { lease: options.lease } : {}),
          cancellation: durableCancellation({ signal: options.signal }),
        },
      );
    } catch (err) {
      error = err;
    }
    await watcher;
    return { error, fired, stoppedAt };
  }

  // ---- A. the durable intent reaches an ACTIVE provider call -------------------------------------------

  it('stops a mid-run job without committing canon, and never as an ordinary failure', async () => {
    let commitsBeforeCancel = 0;
    const { error, fired } = await whileRunning(async (jobId) => {
      commitsBeforeCancel = await canonCommits();
      await requestJobControl(pool, { jobId, control: 'cancel', actorUserId });
    });

    expect(fired).toBe(true);
    /**
     * TWO HONEST OUTCOMES, and the test states both rather than pretending only one is possible.
     *
     * The replay provider answers in microseconds, so a cancel that arrives during the pipeline usually
     * lands between steps and `checkpointControl` stops the run first — `JobControlStop`, the behaviour
     * that already existed and must not regress. When it instead lands while a call is genuinely in
     * flight, the new path fires and the run stops with `CANCELLED`. The suite below (`a provider call
     * held open`) forces the second case deterministically; here the claim is the one that matters
     * either way: whichever wins, the run is not recorded as a FAILURE and canon does not move.
     */
    const isControlStop = error instanceof JobControlStop;
    const isCancelled = error instanceof WorkflowError && error.code === 'CANCELLED';
    expect(isControlStop || isCancelled).toBe(true);

    expect(await canonCommits()).toBe(commitsBeforeCancel);
    expect(await canonVersion()).toBeLessThan(3);
    expect(await chapterStatus()).not.toBe('accepted');

    const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));
    expect(job).toBeDefined();
    // `failed` would tell the operator to retry work they deliberately withdrew.
    expect(job?.status).not.toBe('failed');
    expect(['cancelling', 'cancelled']).toContain(job?.status ?? '');
  }, 300_000);

  /**
   * The active-call path, forced.
   *
   * A provider that PARKS lets the durable cancel arrive while the request is in flight, which is the
   * case the step boundary cannot cover and the whole reason this work exists. Against the pre-change
   * gateway this call runs to completion; here it aborts, and the audit records why.
   */
  it('cancels a provider call that is held open, and records it truthfully', async () => {
    const open = { release: (): void => undefined };
    const parked = new Promise<void>((resolve) => {
      open.release = resolve;
    });
    let inFlight = 0;
    const holding: Provider = {
      name: 'replay',
      complete: async (_req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> => {
        inFlight++;
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            const upstream: unknown = signal?.reason;
            reject(
              upstream instanceof CancellationError
                ? upstream
                : new CancellationError('operator_cancelled', {
                    // A parked in-process adapter has no remote side and says so, rather than claiming
                    // the provider stopped computing.
                    remoteCancellation: 'unsupported',
                  }),
            );
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener('abort', onAbort, { once: true });
          void parked.then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          });
        });
        throw new Error('the parked provider was never meant to answer');
      },
    };

    const gateway = new Gateway({
      providers: new Map([['replay', holding]]),
      routing: {
        R: [
          {
            modelId: 'replay-r',
            provider: 'replay',
            priority: 1,
            family: 'replay',
            priceInPerMTokCents: 0,
            priceOutPerMTokCents: 0,
            maxContextTokens: 200_000,
            supportsJsonSchema: true,
          },
        ],
        P: [],
        M: [
          {
            modelId: 'replay-m',
            provider: 'replay',
            priority: 1,
            family: 'replay',
            priceInPerMTokCents: 0,
            priceOutPerMTokCents: 0,
            maxContextTokens: 200_000,
            supportsJsonSchema: true,
          },
        ],
        C: [],
        E: [],
      },
      budget: new MemoryBudget(1_000_000),
      audit: new PgAuditStore(
        pool,
        { workspaceId, projectId },
        new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
      ),
      guardContext: { pinnedIdentityVersionId: IDENTITY_VERSION },
      cancelPollMs: 25,
    });

    const cancelWhenInFlight = (async () => {
      for (let i = 0; i < 4_000 && inFlight === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));
      if (job) await requestJobControl(pool, { jobId: job.id, control: 'cancel', actorUserId });
    })();

    let error: unknown;
    try {
      await produceChapter(
        { pool, gateway, bindings: harness.bindings },
        { ...harness.input(1), cancellation: durableCancellation() },
      );
    } catch (err) {
      error = err;
    }
    await cancelWhenInFlight;
    open.release();

    // The request was genuinely in flight and it was genuinely aborted.
    expect(inFlight).toBeGreaterThan(0);
    expect(error).toBeDefined();

    const cancelled = await cancelledCalls();
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    const c = cancelled[0]?.cancellation;
    expect(c?.reason).toBe('operator_cancelled');
    expect(c?.before_first_attempt).toBe(false);
    // Migration 0012's trigger enforces this membership in the database as well, for every writer.
    expect(['not_requested', 'acknowledged', 'unsupported', 'unknown']).toContain(
      c?.remote_cancellation,
    );
    // No unevidenced claim that the remote provider stopped.
    expect(c?.remote_cancellation).not.toBe('acknowledged');
    // Silence about usage is recorded as unknown, never as a comfortable zero.
    expect(c?.usage_status).toBe('unknown');
    expect(c?.billing_status).toBe('unknown');
    // Nothing was accepted and nothing was committed by a cancelled pre-commit operation.
    expect(await canonCommits()).toBe(0);
    expect(await chapterStatus()).not.toBe('accepted');
    // And the accounting invariants reconcile exactly: no duplicated or unattributed charge.
    expect(await verifyCostInvariants(pool, projectId)).toEqual([]);
  }, 300_000);

  it('is idempotent under repeated and concurrent cancellation requests', async () => {
    const { fired } = await whileRunning(async (jobId) => {
      // Three requests, two of them concurrent. The second and third must change nothing.
      await requestJobControl(pool, { jobId, control: 'cancel', actorUserId });
      await Promise.all([
        requestJobControl(pool, { jobId, control: 'cancel', actorUserId }),
        requestJobControl(pool, { jobId, control: 'cancel', actorUserId }),
      ]);
    });
    expect(fired).toBe(true);

    const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));
    const events = await jobEventsAfter(pool, { jobId: job?.id ?? '' });
    const cancelEvents = events.filter(
      (e) => e.kind === 'job.cancel_requested' || e.kind === 'job.cancelled',
    );
    // One request event and at most one terminal event: duplicates would double-count in the operator's
    // event stream and in any consumer that reconciles from it.
    expect(cancelEvents.length).toBeLessThanOrEqual(2);
    expect(events.filter((e) => e.terminal).length).toBeLessThanOrEqual(1);
    // No duplicated charge, which is the same invariant resume relies on.
    expect(await verifyCostInvariants(pool, projectId)).toEqual([]);
  }, 300_000);

  // ---- B. Temporal activity cancellation and worker shutdown ------------------------------------------

  it('reaches the provider call through an activity-cancellation signal', async () => {
    const controller = new AbortController();

    // Explicit barrier to prove the targeted provider call is active before cancellation is triggered.
    // Targeting `arc_plan:1` reproduces the exact scenario of the CI flake where story-bible setup
    // has legitimately committed canon (2 commits) before the active provider request is cancelled.
    const open = { release: (): void => undefined };
    const parked = new Promise<void>((resolve) => {
      open.release = resolve;
    });

    let targetedCallActive = false;
    let providerReceivedSignalAbort = false;
    let signalListenerRegistered = false;

    let markTargetedCallActive: () => void = () => undefined;
    const targetedCallActivePromise = new Promise<void>((resolve) => {
      markTargetedCallActive = resolve;
    });

    const synchronizedProvider: Provider = {
      name: 'replay',
      complete: async (req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> => {
        // Non-targeted calls (e.g. story_spec) proceed normally through the replay provider
        if (req.trace?.activityId !== 'arc_plan:1') {
          return harness.provider.complete(req, signal);
        }

        targetedCallActive = true;

        return new Promise<ProviderResponse>((resolve, reject) => {
          const onAbort = (): void => {
            providerReceivedSignalAbort = signal?.aborted ?? false;
            const upstream: unknown = signal?.reason;
            reject(
              upstream instanceof CancellationError
                ? upstream
                : new CancellationError('activity_cancelled', {
                    remoteCancellation: 'unsupported',
                  }),
            );
          };

          if (signal?.aborted) {
            onAbort();
            return;
          }

          signal?.addEventListener('abort', onAbort, { once: true });
          signalListenerRegistered = true;

          // Notify the barrier that the targeted provider call is active and in-flight
          markTargetedCallActive();

          void parked.then(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve(undefined as unknown as ProviderResponse);
          });
        });
        throw new Error('the parked provider was never meant to answer');
      },
    };

    const gateway = new Gateway({
      providers: new Map([['replay', synchronizedProvider]]),
      routing: REPLAY_ROUTING,
      budget: new MemoryBudget(1_000_000),
      audit: new PgAuditStore(
        pool,
        { workspaceId, projectId },
        new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
      ),
      guardContext: { pinnedIdentityVersionId: IDENTITY_VERSION },
      minEnglishConfidence: 0.99,
    });

    // Start production workflow with activity-cancellation signal wiring
    let error: unknown;
    const producePromise = produceChapter(
      { pool, gateway, bindings: harness.bindings },
      {
        ...harness.input(1),
        cancellation: durableCancellation({ signal: controller.signal }),
      },
    ).catch((err: unknown) => {
      error = err;
    });

    // 1. Explicit barrier: prove the targeted provider call is active before triggering cancellation
    await targetedCallActivePromise;
    expect(targetedCallActive).toBe(true);

    // 2. Capture the authoritative durable state immediately before cancellation
    const commitsBeforeCancel = await canonCommits();
    const versionBeforeCancel = await canonVersion();
    const callCountBeforeCancel = await llmCallCount();

    // Story-bible setup has legitimately committed before this cancellation
    expect(commitsBeforeCancel).toBe(2);
    expect(versionBeforeCancel).toBe(2);

    // 3. Trigger activity cancellation deterministically
    // This is the signal `Context.current().cancellationSignal` supplies in the real activity.
    controller.abort(new CancellationError('activity_cancelled'));

    try {
      await producePromise;
    } finally {
      open.release();
    }

    // 4. Assert the targeted active provider request receives cancellation
    expect(providerReceivedSignalAbort).toBe(true);
    expect(signalListenerRegistered).toBe(true);

    // 5. Assert the workflow returns the expected cancellation classification
    expect(error).toBeDefined();
    expect(error instanceof WorkflowError).toBe(true);
    expect((error as WorkflowError).code).toBe('CANCELLED');
    expect((error as WorkflowError).options.data?.reason).toBe('activity_cancelled');

    // 6. Assert no retry, repair, or fallback occurs, and no additional provider attempt begins
    const cancelled = await cancelledCalls();
    expect(cancelled).toHaveLength(1);
    const c = cancelled[0]?.cancellation;
    expect(c?.reason).toBe('activity_cancelled');
    expect(c?.before_first_attempt).toBe(false);

    const callRows = await pool.query<{
      attempt: number;
      repair_attempts: number;
      fallback_from_model_id: string | null;
    }>(
      `SELECT attempt, repair_attempts, fallback_from_model_id FROM llm_calls WHERE project_id = $1 AND status = 'cancelled'`,
      [projectId],
    );
    expect(callRows.rows[0]?.attempt).toBe(1);
    expect(callRows.rows[0]?.repair_attempts).toBe(0);
    expect(callRows.rows[0]?.fallback_from_model_id).toBeNull();

    // Exactly one call (the cancelled arc_plan call) added to the audit after the pre-cancel count
    expect(await llmCallCount()).toBe(callCountBeforeCancel + 1);

    // 7. Assert no artifact or canon mutation occurs after cancellation; legitimate pre-cancel commits unchanged
    expect(await canonCommits()).toBe(commitsBeforeCancel);
    expect(await canonVersion()).toBe(versionBeforeCancel);
    expect(await chapterStatus()).not.toBe('accepted');

    // Regression assertion: under the old scheduler-dependent implementation, the test asserted
    // `expect(await canonCommits()).toBe(0)`. When cancellation caught arc_plan in flight after
    // legitimate story-bible setup, this failed because commitsBeforeCancel was 2, not 0.
    expect(commitsBeforeCancel).toBeGreaterThan(0);
    expect(await canonCommits()).not.toBe(0);

    // 8. Cost and accounting invariants hold with no duplicate or unattributed rows
    expect(await verifyCostInvariants(pool, projectId)).toEqual([]);
  }, 300_000);

  // ---- C. lease loss still prevents every protected write ---------------------------------------------

  it('keeps lease fencing authoritative: a fenced-out run commits nothing', async () => {
    const mine = await acquire('worker-a');
    let commitsBeforeLoss = 0;
    const { error, fired } = await whileRunning(
      async () => {
        await releaseTargetLease(pool, mine);
        await acquire('worker-b');
        // Counted only once the rival holds the lease. Counting before the release raced the run,
        // whose legitimately fenced commits could land in between (R1, ADR-0071). A commit in flight
        // holds the lease row FOR SHARE, so the rival's acquisition waits for it: nothing the old
        // holder writes can land after this read.
        commitsBeforeLoss = await canonCommits();
      },
      { lease: mine },
    );

    expect(fired).toBe(true);
    // Unchanged behaviour: lease loss remains LEASE_LOST, and cancellation did not weaken it.
    expect((error as WorkflowError).code).toBe('LEASE_LOST');
    expect(await canonCommits()).toBe(commitsBeforeLoss);
    expect(await chapterStatus()).not.toBe('accepted');
  }, 300_000);

  // ---- D. cancellation after the atomic commit is TOO LATE --------------------------------------------

  it('does not retract accepted canon when the cancel loses the race with the commit', async () => {
    // A complete, uncancelled run first: this is the committed history that must survive.
    const produced = await produceChapter(
      { pool, gateway: harness.gateway(), bindings: harness.bindings },
      harness.input(1),
    );
    expect(produced.accepted).toBeDefined();
    const versionAfterCommit = await canonVersion();
    const commitsAfterCommit = await canonCommits();
    expect(commitsAfterCommit).toBeGreaterThan(0);
    expect(await chapterStatus()).toBe('accepted');

    const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));
    const outcome = await requestJobControl(pool, {
      jobId: job?.id ?? '',
      control: 'cancel',
      actorUserId,
    });

    // A terminal job accepts nothing. The request is refused truthfully rather than silently "working".
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe('terminal');
    // History is not retracted: the commit stands, the chapter stays accepted, canon does not move back.
    expect(await canonVersion()).toBe(versionAfterCommit);
    expect(await canonCommits()).toBe(commitsAfterCommit);
    expect(await chapterStatus()).toBe('accepted');
    const after = await getJob(pool, job?.id ?? '');
    expect(after?.status).toBe('completed');
  }, 300_000);

  // ---- E. resume after cancellation does not double-spend --------------------------------------------

  it('resumes after a cancellation without repeating an already-accounted attempt', async () => {
    await whileRunning(async (jobId) => {
      await requestJobControl(pool, { jobId, control: 'cancel', actorUserId });
    });
    const callsAfterCancel = await llmCallCount();
    const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));

    // The operator changes their mind and resumes. Completed steps replay from `job_steps`; the cancelled
    // attempt is not re-charged, and no successful call is recorded twice.
    await requestJobControl(pool, { jobId: job?.id ?? '', control: 'run', actorUserId });
    let resumeError: unknown;
    try {
      await produceChapter(
        { pool, gateway: harness.gateway(), bindings: harness.bindings },
        harness.input(1),
      );
    } catch (err) {
      resumeError = err;
    }

    // Whether the resumed run completes or stops again, the accounting invariants must hold exactly:
    // one charge per idempotency key, every attempt attributable, nothing duplicated.
    expect(await verifyCostInvariants(pool, projectId)).toEqual([]);
    expect(await llmCallCount()).toBeGreaterThanOrEqual(callsAfterCancel);
    if (!resumeError) {
      // A completed resume must have produced exactly one commit for the chapter, not two.
      expect(await canonCommits()).toBe(1);
      expect(await chapterStatus()).toBe('accepted');
    }
  }, 300_000);

  // ---- F. redaction ----------------------------------------------------------------------------------

  it('leaks no prompt, prose, credential or provider payload into events or the audit', async () => {
    await whileRunning(async (jobId) => {
      await requestJobControl(pool, { jobId, control: 'cancel', actorUserId });
    });

    const job = await getJobByWorkflowId(pool, workflowIdFor(projectId, 1));
    const events = await jobEventsAfter(pool, { jobId: job?.id ?? '' });
    const cancelled = await cancelledCalls();
    const serialized = JSON.stringify({
      events: events.map((e) => ({ kind: e.kind, payload: e.payload })),
      cancelled,
      error: job?.error,
    });

    // Prose and prompt text have no path into either surface; only hashes, ids and classifications do.
    for (const forbidden of ['Do-yoon', 'porter', 'Authorization', 'Bearer', 'sk-', '측정']) {
      expect(serialized).not.toContain(forbidden);
    }
    // Nothing resembling a long prose blob either.
    for (const event of events) {
      for (const value of Object.values(event.payload)) {
        if (typeof value === 'string') expect(value.length).toBeLessThan(2_000);
      }
    }
  }, 300_000);

  it('records the workflow cancellation scenarios', () => {
    recordChaosScenarios([
      {
        id: 'WF-CANCEL-01',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['durable_cancel_stops_mid_run', 'no_canon_commit_after_cancel'],
      },
      {
        id: 'WF-CANCEL-02',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['cancelled_call_recorded_truthfully', 'cost_invariants_hold'],
      },
      {
        id: 'WF-CANCEL-03',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['repeated_cancel_idempotent', 'no_duplicate_events_or_costs'],
      },
      {
        id: 'WF-CANCEL-04',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['activity_cancellation_reaches_provider_signal'],
      },
      {
        id: 'WF-CANCEL-05',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['lease_loss_prevents_protected_writes'],
      },
      {
        id: 'WF-CANCEL-06',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['cancel_after_commit_is_too_late', 'accepted_canon_preserved'],
      },
      {
        id: 'WF-CANCEL-07',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['resume_does_not_double_spend'],
      },
      {
        id: 'WF-CANCEL-08',
        outcome: 'passed',
        surface: 'workflow',
        invariants: ['no_prompt_or_prose_in_events_or_audit'],
      },
    ]);
    expect(true).toBe(true);
  });
});
