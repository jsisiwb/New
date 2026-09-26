/** ADR-0109: which failed runs an unattended `novel:run` resumes by itself, and when. */
import { describe, expect, it } from 'vitest';
import { autoResumeDecision } from './auto-resume.js';

const opts = { maxResumes: 3, baseDelayMs: 60_000, maxDelayMs: 600_000 };
const failed = (last_error: Record<string, unknown>) => ({ status: 'failed', last_error });
const bridge502 = failed({
  code: 'MODEL_CALL_FAILED',
  message: 'PROVIDER_FAILED: provider notion returned HTTP 502 [failure_class=retryable_provider]',
  recommended_actions: ['retry_step'],
});

describe('auto-resume (ADR-0109)', () => {
  it('resumes a bridge failure with a doubling delay up to the cap, within the budget', () => {
    expect(autoResumeDecision(bridge502, 0, opts)).toMatchObject({ resume: true, delayMs: 60_000 });
    expect(autoResumeDecision(bridge502, 2, opts)).toMatchObject({
      resume: true,
      delayMs: 240_000,
    });
    expect(autoResumeDecision(bridge502, 3, opts)).toMatchObject({ resume: false });
    expect(
      autoResumeDecision(bridge502, 2, { ...opts, maxResumes: 9, maxDelayMs: 100_000 }).delayMs,
    ).toBe(100_000);
  });

  it('waits twice as long for a throttled bridge', () => {
    const throttled = failed({
      code: 'MODEL_CALL_FAILED',
      message: 'PROVIDER_FAILED: rate limited [failure_class=retryable_throttled]',
      recommended_actions: ['retry_step'],
    });
    expect(autoResumeDecision(throttled, 1, opts)).toMatchObject({
      resume: true,
      delayMs: 240_000,
    });
  });

  it('asks a rejected extraction again and resumes a concurrent call', () => {
    expect(autoResumeDecision(failed({ code: 'EXTRACTION_REJECTED' }), 0, opts).resume).toBe(true);
    expect(
      autoResumeDecision(
        failed({ code: 'CONCURRENT_CALL', recommended_actions: ['retry_step'] }),
        0,
        opts,
      ).resume,
    ).toBe(true);
  });

  it('leaves budget stops, cancellations, plan and pack faults and every run at rest to the operator', () => {
    const left = [
      failed({ code: 'MODEL_CALL_FAILED', recommended_actions: ['raise_budget'] }),
      failed({ code: 'CANCELLED' }),
      failed({ code: 'PACK_FAILED' }),
      failed({ code: 'ARC_PLAN_INVALID' }),
      failed({ code: 'INTERNAL' }),
      { status: 'needs_attention', last_error: { code: 'APPROVAL_BLOCKED' } },
      { status: 'paused', last_error: null },
      { status: 'completed', last_error: null },
    ];
    for (const run of left) expect(autoResumeDecision(run, 0, opts).resume).toBe(false);
  });
});
