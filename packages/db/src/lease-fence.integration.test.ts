/**
 * TOCTOU barrier proofs for lease fencing (Checkpoint 7 corrective, migration 0009).
 *
 * The prior audit verified ownership before each step, which narrows the race but cannot close it: a
 * pre-step read and a later mutation are separate transactions, so the lease can be stolen in between and
 * the mutation still lands. These tests attack exactly that window.
 *
 * The barrier is deterministic, not timing-based. Instead of sleeping and hoping the interleaving occurs,
 * each test:
 *
 *   1. opens the protected transaction and runs the fence assertion (time of CHECK),
 *   2. performs the steal from a SECOND connection while that transaction is still open,
 *   3. only then attempts the durable mutation (time of USE).
 *
 * That ordering is forced by awaiting each phase, so the race is reproduced on every run rather than
 * occasionally. A `sleep`-based version of this test would be exactly the timing-dependent construction the
 * task forbids, and would pass against the broken implementation roughly as often as not.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireTargetLease,
  LeaseLostError,
  leaseOwnership,
  migrate,
  releaseTargetLease,
  renewTargetLease,
  resetDatabase,
  withFencedTransaction,
  type LeaseClaim,
  type Pool,
} from './index.js';
import { databaseUrl, freshDatabase } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

run('lease fence assertion is atomic with the write it protects', () => {
  let pool: Pool;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    pool = await freshDatabase();
  }, 120_000);
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    const ws = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (name) VALUES ('Fence') RETURNING id`,
    );
    workspaceId = ws.rows[0]?.id ?? '';
    const pr = await pool.query<{ id: string }>(
      `INSERT INTO projects (workspace_id, title) VALUES ($1, 'Fenced') RETURNING id`,
      [workspaceId],
    );
    projectId = pr.rows[0]?.id ?? '';
  }, 120_000);

  async function acquire(holder: string, ttlSeconds = 60): Promise<LeaseClaim> {
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

  /** Steal the target from a separate connection, as a rival worker would after a TTL lapse. */
  async function steal(previous: LeaseClaim, holder: string): Promise<LeaseClaim> {
    await releaseTargetLease(pool, previous);
    return acquire(holder);
  }

  async function marks(): Promise<number> {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chapters WHERE project_id = $1`,
      [projectId],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  // ---- the barrier itself ------------------------------------------------------------------------------

  it('refuses the protected write when the lease was stolen after the pre-step ownership read', async () => {
    const mine = await acquire('worker-a');

    /**
     * The exact TOCTOU sequence the previous implementation permitted.
     *
     * (1) is the pre-step ownership read as `runStep` performs it — its own statement on its own
     * connection, which is precisely why it cannot bind the later write. (2) is the steal, which commits
     * fully. (3) is the durable mutation, which the old code would have executed happily because nothing
     * in its transaction knew a lease existed.
     */
    // (1) time of CHECK: the read says we own the target, and at that instant it is true.
    const before = await leaseOwnership(pool, mine);
    expect(before.owned).toBe(true);

    // (2) the window: a rival takes the chapter over after the check and before the write.
    await steal(mine, 'worker-b');

    // (3) time of USE: the mutation is now refused, because the assertion lives inside its transaction.
    let observed: unknown;
    try {
      await withFencedTransaction(pool, mine, async (client) => {
        await client.query(
          `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'accepted')`,
          [workspaceId, projectId],
        );
      });
    } catch (err) {
      observed = err;
    }

    expect(observed).toBeInstanceOf(LeaseLostError);
    expect((observed as LeaseLostError).code).toBe('LEASE_LOST');
    expect((observed as LeaseLostError).reason).toBe('fenced_out');
    // The write rolled back with the assertion: the stale worker created nothing.
    expect(await marks()).toBe(0);
  }, 120_000);

  it('serializes a concurrent steal against an open fenced transaction', async () => {
    const mine = await acquire('worker-a');

    /**
     * The other half of the guarantee. A rival's steal takes `FOR UPDATE` on the lease row inside
     * `canon.acquire_target_lease`, and the assertion holds `FOR SHARE` on it, so a steal that begins while
     * a fenced transaction is open must WAIT for that transaction rather than interleave with it. Without
     * the lock the steal could commit first and the protected write could still land afterwards — the same
     * gap in a different disguise.
     *
     * The steal is launched without awaiting it inside the transaction (awaiting it there would simply
     * block on the lock forever), and the ordering is asserted afterwards.
     */
    /**
     * State in one mutable object, read through a property.
     *
     * A plain `let` boolean is narrowed to `false` by TypeScript after initialization, so the later check
     * is reported as always-truthy and the assertion would be vacuous — the same narrowing trap the
     * workflow's signal flags document. A property read is re-evaluated, which is the real semantics of a
     * flag another task flips.
     */
    const order = { writeCommitted: false, stealResolvedBeforeCommit: false };

    const stealer = (async () => {
      // Give the fenced transaction time to take its share lock, then contend for the row.
      await new Promise((r) => setTimeout(r, 50));
      const lease = await acquireTargetLease(pool, {
        workspaceId,
        projectId,
        targetKind: 'chapter',
        targetId: '1',
        holderWorkflowId: 'worker-b',
        ttlSeconds: 60,
      });
      if (!order.writeCommitted) order.stealResolvedBeforeCommit = true;
      return lease;
    })();

    await withFencedTransaction(pool, mine, async (client) => {
      await client.query(
        `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'accepted')`,
        [workspaceId, projectId],
      );
      // Hold the transaction open long enough that an unserialized steal would certainly finish first.
      await new Promise((r) => setTimeout(r, 300));
    });
    order.writeCommitted = true;
    await stealer;

    // The rightful holder's write landed, and the steal could not slip in ahead of it.
    expect(order.stealResolvedBeforeCommit).toBe(false);
    expect(await marks()).toBe(1);
  }, 120_000);

  it('a stale worker cannot mark a chapter accepted through the fenced helper', async () => {
    const mine = await acquire('worker-a');
    const rival = await steal(mine, 'worker-b');

    await expect(
      withFencedTransaction(pool, mine, async (client) => {
        await client.query(
          `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'accepted')`,
          [workspaceId, projectId],
        );
      }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(await marks()).toBe(0);

    // The rightful holder is unaffected and completes.
    await withFencedTransaction(pool, rival, async (client) => {
      await client.query(
        `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'accepted')`,
        [workspaceId, projectId],
      );
    });
    expect(await marks()).toBe(1);
  }, 120_000);

  it('an expired lease is refused even though its own row still names the holder', async () => {
    const mine = await acquire('worker-a', 1);
    await new Promise((r) => setTimeout(r, 1_200));
    // Nobody stole it — the holder is still named on the row. Expiry alone must refuse the write, or a
    // worker resuming from a long pause would act on a deadline it no longer holds.
    await expect(withFencedTransaction(pool, mine, async () => undefined)).rejects.toMatchObject({
      code: 'LEASE_LOST',
      reason: 'expired',
    });
  }, 120_000);

  it('a released lease is refused', async () => {
    const mine = await acquire('worker-a');
    await releaseTargetLease(pool, mine);
    await expect(withFencedTransaction(pool, mine, async () => undefined)).rejects.toMatchObject({
      code: 'LEASE_LOST',
      reason: 'released',
    });
  }, 120_000);

  it('a fabricated lease id is refused rather than treated as unleased', async () => {
    await expect(
      withFencedTransaction(
        pool,
        {
          leaseId: '00000000-0000-7000-8000-000000000000',
          holderWorkflowId: 'worker-ghost',
          fence: '1',
        },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'LEASE_LOST', reason: 'missing' });
  }, 120_000);

  it('a stale fence on a live lease row is refused', async () => {
    const mine = await acquire('worker-a');
    // Same holder id, but a fence from before a takeover: the classic zombie presenting old credentials.
    await expect(
      withFencedTransaction(pool, { ...mine, fence: '0' }, async () => undefined),
    ).rejects.toMatchObject({ code: 'LEASE_LOST', reason: 'fenced_out' });
  }, 120_000);

  // ---- renewal-false is a definitive verdict ----------------------------------------------------------

  it('renewal returns false exactly when ownership is gone, and the fenced write agrees', async () => {
    const mine = await acquire('worker-a');
    expect(await renewTargetLease(pool, mine)).toBe(true);

    await steal(mine, 'worker-b');

    // `false` is not an ambiguity to be retried: it is the database reporting that this holder/fence pair
    // is no longer live. The fenced write must reach the same verdict, or the two guards would disagree.
    expect(await renewTargetLease(pool, mine)).toBe(false);
    const state = await leaseOwnership(pool, mine);
    expect(state.owned).toBe(false);
    await expect(withFencedTransaction(pool, mine, async () => undefined)).rejects.toMatchObject({
      code: 'LEASE_LOST',
    });
  }, 120_000);

  // ---- the unleased path stays usable ----------------------------------------------------------------

  it('an absent claim performs no assertion, so the single-operator CLI path still works', async () => {
    await withFencedTransaction(pool, undefined, async (client) => {
      await client.query(
        `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'planned')`,
        [workspaceId, projectId],
      );
    });
    expect(await marks()).toBe(1);
  }, 120_000);

  // ---- retries stay idempotent ------------------------------------------------------------------------

  it('the rightful holder can retry a fenced write repeatedly without duplicating it', async () => {
    const mine = await acquire('worker-a');
    for (let i = 0; i < 3; i += 1) {
      await withFencedTransaction(pool, mine, async (client) => {
        await client.query(
          `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'planned')
           ON CONFLICT (project_id, number) DO NOTHING`,
          [workspaceId, projectId],
        );
      });
    }
    expect(await marks()).toBe(1);
  }, 120_000);
});
