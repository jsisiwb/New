/**
 * Provider-failure classification (B-4-2). The classifier decides whether the gateway may spend money on a
 * second route, so its default matters more than its cleverness: an UNRECOGNIZED failure must be
 * non-retryable, because rerouting an unknown fault multiplies spend on a guess.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyProviderFailure,
  isRetryable,
  ProviderFailure,
  RETRYABLE_CLASSES,
  type FailureClass,
} from './failures.js';

describe('provider failure classification (B-4-2)', () => {
  it("an adapter's own verdict is authoritative", () => {
    for (const cls of [
      'retryable_transport',
      'retryable_throttled',
      'retryable_provider',
      'non_retryable_request',
      'non_retryable_unknown',
    ] as const) {
      expect(classifyProviderFailure(new ProviderFailure(cls, 'stated by the adapter'))).toBe(cls);
    }
  });

  it('classifies transport and timeout faults as retryable', () => {
    const cases = [
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      new Error('fetch failed'),
      new Error('request timed out after 60s'),
      new Error('deadline exceeded'),
    ];
    for (const err of cases) expect(isRetryable(classifyProviderFailure(err))).toBe(true);
  });

  it('classifies throttling and provider-side faults as retryable', () => {
    expect(classifyProviderFailure(Object.assign(new Error('slow down'), { status: 429 }))).toBe(
      'retryable_throttled',
    );
    expect(classifyProviderFailure(new Error('429 Too Many Requests'))).toBe('retryable_throttled');
    expect(classifyProviderFailure(new Error('model is overloaded'))).toBe('retryable_throttled');
    expect(classifyProviderFailure(Object.assign(new Error('boom'), { status: 503 }))).toBe(
      'retryable_provider',
    );
    expect(classifyProviderFailure(new Error('502 Bad Gateway'))).toBe('retryable_provider');
  });

  it('classifies rejected requests as NON-retryable so they cannot be rerouted', () => {
    const cases = [
      Object.assign(new Error('bad request'), { status: 400 }),
      Object.assign(new Error('nope'), { status: 401 }),
      Object.assign(new Error('nope'), { status: 403 }),
      new Error('invalid_request_error: unsupported parameter'),
      new Error('Incorrect API key provided'),
      new Error('content_filter triggered'),
      new Error("This model's maximum context length is 8192 tokens"),
    ];
    for (const err of cases) {
      const cls = classifyProviderFailure(err);
      expect(isRetryable(cls), `${err.message} must not authorize fallback`).toBe(false);
    }
  });

  it('a rejected request is not rerouted merely because its message also mentions a network word', () => {
    // "invalid request" wins over "network": the request is wrong on every route.
    expect(
      isRetryable(classifyProviderFailure(new Error('invalid_request: network parameter missing'))),
    ).toBe(false);
  });

  it('defaults an unrecognized failure to non-retryable (fail closed)', () => {
    expect(classifyProviderFailure(new Error('something nobody has seen before'))).toBe(
      'non_retryable_unknown',
    );
    expect(classifyProviderFailure({ weird: true })).toBe('non_retryable_unknown');
    expect(classifyProviderFailure(undefined)).toBe('non_retryable_unknown');
  });

  it('only the three retryable classes authorize fallback', () => {
    const all: FailureClass[] = [
      'retryable_transport',
      'retryable_throttled',
      'retryable_provider',
      'non_retryable_request',
      'non_retryable_unknown',
    ];
    expect(all.filter(isRetryable)).toEqual([...RETRYABLE_CLASSES]);
  });

  it('a possibly-completed timeout is still retryable but records that the work may have happened', () => {
    // The response was lost after the provider may have finished. Idempotency is what prevents double
    // spend on the retry; the classification only decides whether a retry is allowed at all.
    const err = new ProviderFailure('retryable_transport', 'timeout after dispatch', {
      possiblyCompleted: true,
    });
    expect(isRetryable(classifyProviderFailure(err))).toBe(true);
    expect(err.detail.possiblyCompleted).toBe(true);
  });

  it('carries no prompt, prose or credential material in its classification surface', () => {
    const err = new ProviderFailure(
      'non_retryable_request',
      'Incorrect API key provided: sk-live',
      {
        status: 401,
      },
    );
    // The classifier returns a class only; it never echoes the message it was given.
    expect(classifyProviderFailure(err)).toBe('non_retryable_request');
    expect(RETRYABLE_CLASSES.join(',')).not.toContain('sk-');
  });
});
