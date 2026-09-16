/**
 * Redaction and observability unit tests (Checkpoint 7; observability plan §5.3).
 *
 * The requirement is absolute — "no manuscript/prompt text (IDs + hashes only)" — so these tests are
 * written as an attack on the serializer rather than a demonstration of it. The important cases are the
 * ones where a leak would be *plausible*:
 *
 *  * a field whose name looks structurally safe (`session_id` is an identifier) but whose value is
 *    security-relevant;
 *  * prose arriving under a key nobody blocklisted, which is the failure mode a blocklist guarantees;
 *  * a secret nested inside an object or array under an allowed key;
 *  * a trace id supplied by the client, which reaches logs and the audit and must not be injectable.
 */
import { describe, expect, it } from 'vitest';
import {
  isLoggableKey,
  logFields,
  logLine,
  Metrics,
  METRIC,
  REDACTED,
  traceIdFrom,
} from './observability.js';

describe('log field redaction is default-deny', () => {
  it('drops every field the allowlist does not name, not just known-bad names', () => {
    // `weird_new_field` is on no blocklist anywhere. A blocklist design would log it; this must not.
    const out = logFields({
      job_id: 'job-1',
      weird_new_field: 'the tower had not yet fallen',
      another_unreviewed_key: 'anything at all',
    });
    expect(out).toEqual({ job_id: 'job-1' });
  });

  it('refuses security-relevant names even when they have a safe identifier shape', () => {
    // Each of these ends in `_id` or is otherwise shaped like metadata, which is exactly why shape alone
    // cannot be the test: logging a live session id lets a log reader correlate an active session.
    for (const key of [
      'session_id',
      'api_key_id',
      'csrf_token',
      'password_hash',
      'password_verifier',
      'authorization',
      'auth_header',
      'cookie',
      'provider_credential',
      'database_url',
      'connection_string',
      'dsn',
    ]) {
      expect(isLoggableKey(key), key).toBe(false);
      expect(logFields({ [key]: 'value' }), key).toEqual({});
    }
  });

  it('permits a *_hash digest, because a digest of prose is not prose', () => {
    // `content_hash` and `prompt_hash` are the plan's required span attributes and both contain a
    // forbidden fragment, so the carve-out is load-bearing rather than a convenience.
    expect(isLoggableKey('content_hash')).toBe(true);
    expect(isLoggableKey('prompt_hash')).toBe(true);
    expect(logFields({ content_hash: 'sha256:abc' })).toEqual({ content_hash: 'sha256:abc' });
    // Two limits keep the carve-out narrow. It is the SUFFIX, not the word:
    expect(isLoggableKey('hash_of_password_input')).toBe(false);
    expect(isLoggableKey('password_hash_algorithm')).toBe(false);
    // …and it never covers a CREDENTIAL digest. A password hash is the verifier an attacker cracks
    // offline; a session or key hash is the stored form the server compares against.
    for (const key of ['password_hash', 'session_hash', 'api_key_hash', 'token_hash']) {
      expect(isLoggableKey(key), key).toBe(false);
      expect(logFields({ [key]: 'sha256:abc' }), key).toEqual({});
    }
  });

  it('permits a numeric measure of content, because a count is not the content', () => {
    // `llm_tokens_total` is a required metric, but these names contain the very fragments that block
    // prompt and completion BODIES. A count cannot reconstruct prose, so the measure is allowed…
    for (const key of ['input_tokens', 'output_tokens', 'byte_size', 'prose_count']) {
      expect(isLoggableKey(key), key).toBe(true);
    }
    // A bearer token is still refused: the credential forms are matched, not the plural measure.
    for (const key of ['csrf_token', 'session_token', 'bearer_token', 'token_hash']) {
      expect(isLoggableKey(key), key).toBe(false);
    }
    // …while the bare content keys stay refused.
    for (const key of ['input', 'output', 'prose', 'content']) {
      expect(isLoggableKey(key), key).toBe(false);
    }
  });

  it('refuses every field that could carry prose or prompt text', () => {
    for (const key of [
      'text',
      'prose',
      'manuscript',
      'manuscript_text',
      'prompt',
      'prompt_body',
      'quote',
      'content',
      'body',
      'output',
      'input',
      'summary',
      'statement',
      'justification',
      'delta',
      'payload',
      'title',
      'email',
      'display_name',
    ]) {
      expect(isLoggableKey(key), key).toBe(false);
    }
  });

  it('allows identifiers, hashes, counts and closed enums', () => {
    const out = logFields({
      workspace_id: 'ws-1',
      project_id: 'pr-1',
      job_id: 'job-1',
      workflow_id: 'chapter:pr-1:1',
      content_hash: 'sha256:abc',
      pack_hash: 'sha256:def',
      chapter_no: 4,
      canon_version: 7,
      cost_cents: 12,
      input_tokens: 900,
      stale_count: 2,
      status: 'accepted',
      role: 'scene_writer',
      model_class: 'P',
      reason: 'fenced_out',
      duration_ms: 31,
      replayed: true,
    });
    expect(out.workspace_id).toBe('ws-1');
    expect(out.content_hash).toBe('sha256:abc');
    expect(out.chapter_no).toBe(4);
    expect(out.replayed).toBe(true);
    expect(out.reason).toBe('fenced_out');
    // Every field supplied above is an allowed shape, so none is dropped. Asserting "nothing was lost"
    // rather than a magic count keeps the test meaningful when the allowlist grows.
    expect(Object.keys(out).sort()).toEqual(
      [
        'workspace_id',
        'project_id',
        'job_id',
        'workflow_id',
        'content_hash',
        'pack_hash',
        'chapter_no',
        'canon_version',
        'cost_cents',
        'input_tokens',
        'stale_count',
        'status',
        'role',
        'model_class',
        'reason',
        'duration_ms',
        'replayed',
      ].sort(),
    );
  });

  it('never renders a nested object or array, so a secret cannot ride inside an allowed key', () => {
    const out = logFields({
      // `result` IS allowed as a key — and that is the point: its value must still not be expanded.
      result: { password: 'hunter2', text: 'the tower had not yet fallen' },
      items: ['a', 'b', 'c'],
    });
    expect(out.result).toBe(REDACTED);
    // A list becomes its length, which is the useful and safe projection.
    expect(out.items).toBe(3);
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('tower');
  });

  it('bounds string length, because an id or hash is short and a long value is suspicious', () => {
    const long = 'x'.repeat(500);
    expect(logFields({ job_id: long }).job_id).toBe(REDACTED);
    expect(logFields({ job_id: 'x'.repeat(200) }).job_id).toBe('x'.repeat(200));
  });

  it('emits a single structured JSON line with correlation ids and nothing else', () => {
    const line = logLine(
      {
        level: 'info',
        msg: 'request completed',
        request_id: 'req-1',
        trace_id: '0af7651916cd43dd8448eb211c80319c',
        workspace_id: 'ws-1',
        job_id: 'job-1',
      },
      { status_code: 200, route: '/v1/projects', duration_ms: 12, password: 'hunter2' },
    );
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('request completed');
    expect(parsed.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(parsed.status_code).toBe(200);
    expect(parsed).not.toHaveProperty('password');
    expect(line).not.toContain('hunter2');
    // One line: a multi-line record breaks line-delimited JSON ingestion.
    expect(line).not.toContain('\n');
  });
});

describe('trace correlation', () => {
  it('accepts a well-formed W3C traceparent', () => {
    expect(traceIdFrom('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toBe(
      '0af7651916cd43dd8448eb211c80319c',
    );
  });

  it('ignores a malformed or client-invented traceparent instead of passing it through', () => {
    // Trace ids reach logs and the llm_calls audit, so an arbitrary client string must not propagate —
    // the same reasoning that makes a forwarded client IP untrustworthy without an explicit trusted proxy.
    for (const bad of [
      undefined,
      '',
      'not-a-traceparent',
      '00-short-b7ad6b7169203331-01',
      '00-00000000000000000000000000000000-b7ad6b7169203331-01',
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01 injected',
      '{"level":"error","msg":"fake"}',
    ]) {
      expect(traceIdFrom(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('metrics registry', () => {
  it('counts and renders Prometheus text with sorted, bounded labels', () => {
    const m = new Metrics();
    m.increment(METRIC.requests, 'help', { route: '/v1/projects', status: '200' });
    m.increment(METRIC.requests, 'help', { route: '/v1/projects', status: '200' });
    m.increment(METRIC.requests, 'help', { route: '/v1/projects', status: '401' });
    expect(m.total(METRIC.requests, { route: '/v1/projects', status: '200' })).toBe(2);
    expect(m.total(METRIC.requests, { route: '/v1/projects', status: '401' })).toBe(1);

    const text = m.render();
    expect(text).toContain(`# TYPE ${METRIC.requests} counter`);
    expect(text).toContain(`${METRIC.requests}{route="/v1/projects",status="200"} 2`);
  });

  it('drops unsafe label names so the metrics endpoint cannot become a leak channel', () => {
    const m = new Metrics();
    m.increment(METRIC.authFailures, 'help', { code: 'UNAUTHENTICATED', password: 'hunter2' });
    const text = m.render();
    expect(text).toContain('code="UNAUTHENTICATED"');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('password');
  });

  it('records latency histograms with cumulative buckets', () => {
    const m = new Metrics();
    m.observe(METRIC.requestLatency, 'help', 0.02, { route: '/v1/projects' });
    m.observe(METRIC.requestLatency, 'help', 2, { route: '/v1/projects' });
    const text = m.render();
    // 0.02s falls in le=0.05 and every larger bucket; 2s only in le=5 and above.
    expect(text).toContain(`${METRIC.requestLatency}_bucket{route="/v1/projects",le="0.05"} 1`);
    expect(text).toContain(`${METRIC.requestLatency}_bucket{route="/v1/projects",le="5"} 2`);
    expect(text).toContain(`${METRIC.requestLatency}_count{route="/v1/projects"} 2`);
  });

  it('reports zero rather than throwing for a series that was never touched', () => {
    expect(new Metrics().total(METRIC.canonCommits)).toBe(0);
  });
});
