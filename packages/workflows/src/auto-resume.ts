/**
 * ADR-0109 (unattended runs, part 2): whether a run that came to rest resumes on its own, and after how long.
 *
 * Run 2's bridge failed every probe for half an hour twice (18:54–19:25 and 21:15–22:10 UTC) and rate-limited two of
 * its workspaces; each outage left a run `failed` with a retryable model-call error until someone typed
 * `novel:resume`. An unattended batch (chapters 6–15) needs the runner to wait and resume by itself — but only for
 * faults a resume can cure, and never past a budget.
 */

export interface AutoResumeOptions {
  /** Resumes allowed in one `novel:run` process. */
  readonly maxResumes: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface AutoResumeDecision {
  readonly resume: boolean;
  readonly delayMs: number;
  readonly reason: string;
}

interface RunAtRest {
  readonly status: string;
  readonly last_error?: Record<string, unknown> | null | undefined;
}

/**
 * Failed runs a resume can cure: a model call the gateway gave up on (bridge outage, rate limit, truncation, an
 * answer off its schema) or a concurrent call — both recommend `retry_step` — and a rejected extraction, which a
 * resume asks again (ADR-0107). A budget stop, a cancellation, a pack that does not fit, an invalid plan or an
 * internal fault is left to the operator, as is every run that rests for attention, pause or completion.
 */
export function autoResumeDecision(
  run: RunAtRest,
  resumed: number,
  opts: AutoResumeOptions,
): AutoResumeDecision {
  const none = (reason: string): AutoResumeDecision => ({ resume: false, delayMs: 0, reason });
  if (run.status !== 'failed') return none(`run is ${run.status}`);
  const err = run.last_error ?? {};
  const code = typeof err.code === 'string' ? err.code : 'UNKNOWN';
  const actions = Array.isArray(err.recommended_actions) ? err.recommended_actions : [];
  const message = typeof err.message === 'string' ? err.message : '';
  const curable =
    code === 'EXTRACTION_REJECTED' ||
    ((code === 'MODEL_CALL_FAILED' || code === 'CONCURRENT_CALL') &&
      actions.includes('retry_step'));
  if (!curable) return none(`${code} is left to the operator`);
  if (resumed >= opts.maxResumes)
    return none(`${code}: the resume budget of ${String(opts.maxResumes)} is spent`);
  // A throttled bridge is given twice as long before the next attempt.
  const throttled = /retryable_throttled|rate.?limit|HTTP 429/iu.test(message);
  const delayMs = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** resumed * (throttled ? 2 : 1));
  return {
    resume: true,
    delayMs,
    reason: `${code}${throttled ? ' (throttled)' : ''}: resume ${String(resumed + 1)} of ${String(opts.maxResumes)}`,
  };
}
