import { describe, expect, it } from 'vitest';
import { lostLeaseWaitMs } from './novel.js';

describe('taking back a lease this process lost (ADR-0091)', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const expires = new Date('2026-09-25T12:01:30Z');

  it('waits until the lease expires, plus a margin, when the run is still ours and in progress', () => {
    const run = { status: 'planning' as const, runner_id: 'cli:7', lease_expires_at: expires };
    expect(lostLeaseWaitMs(run, 'cli:7', now)).toBe(95_000);
    expect(lostLeaseWaitMs({ ...run, lease_expires_at: now }, 'cli:7', now)).toBe(5_000);
  });

  it('never waits on another runner’s lease or on a run at rest', () => {
    const run = { status: 'producing' as const, runner_id: 'cli:8', lease_expires_at: expires };
    expect(lostLeaseWaitMs(run, 'cli:7', now)).toBeUndefined();
    expect(
      lostLeaseWaitMs(
        { ...run, runner_id: 'cli:7', status: 'needs_attention' as const },
        'cli:7',
        now,
      ),
    ).toBeUndefined();
    expect(
      lostLeaseWaitMs({ ...run, runner_id: 'cli:7', lease_expires_at: null }, 'cli:7', now),
    ).toBeUndefined();
    expect(lostLeaseWaitMs(undefined, 'cli:7', now)).toBeUndefined();
  });
});
