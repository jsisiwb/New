import { describe, expect, it } from 'vitest';
import { percentile, roleStats, roundOf } from './run-report.js';

const call = (role: string, over: Record<string, unknown> = {}) => ({
  role,
  status: 'succeeded',
  attempt: 1,
  latency_ms: 1000,
  usage: { input: 10, output: 20 },
  cost_cents: '0',
  created_at: new Date('2026-09-24T00:00:00Z'),
  attempt_records: [{ outcome: 'succeeded' }],
  ...over,
});

describe('run report aggregation (audit §8.4, §10.5)', () => {
  it('uses nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it('counts attempts and failed attempts per role; latency only from succeeded calls', () => {
    const stats = roleStats([
      call('prose_judge', { latency_ms: 300_000 }),
      call('prose_judge', {
        attempt: 2,
        latency_ms: 500_000,
        attempt_records: [{ outcome: 'failed' }, { outcome: 'succeeded' }],
      }),
      call('prose_judge', {
        status: 'failed',
        attempt: 3,
        latency_ms: 0,
        usage: null,
        attempt_records: [{ outcome: 'failed' }, { outcome: 'failed' }, { outcome: 'failed' }],
      }),
      call('scene_writer'),
    ]);
    expect(stats.map((s) => s.role)).toEqual(['prose_judge', 'scene_writer']);
    const judge = stats[0];
    expect(judge).toMatchObject({ calls: 3, succeeded: 2, attempts: 6, failed_attempts: 4 });
    expect(judge?.latency_ms).toEqual({ p50: 300_000, p90: 500_000, max: 500_000, total: 800_000 });
    expect(judge?.tokens).toEqual({ input: 20, output: 40 });
  });

  it('tallies a scorecard: severities, sources, lint rules with the worst severity, dimension composition', () => {
    const round = roundOf(
      {
        manuscript_version_id: 'v1',
        overall: { score: 71 },
        sections: { prose: { rubric_score: 80, lint_composite: 88 } },
        issues: [
          {
            source: 'lint:ko_style',
            severity: 'minor',
            kind: 'weak_pacing',
            metric: { rule_id: 'KO-DLG-SHARE' },
          },
          {
            source: 'lint:ko_style',
            severity: 'major',
            kind: 'weak_pacing',
            metric: { rule_id: 'KO-DLG-SHARE' },
          },
          { source: 'lint:ko_style', severity: 'minor', kind: 'literary_drift' },
          { source: 'contract_checker', severity: 'blocking', kind: 'missing_required_event' },
        ],
        acceptance: {
          gate_outcome: 'rejected',
          auto_approvable: false,
          dimension_results: [{ dimension: 'prose', score: 83, threshold: 80, passed: true }],
        },
      },
      { version_no: 1, quarantined: false, accepted: false },
    );
    expect(round.counts).toEqual({ blocking: 1, major: 1, minor: 2, note: 0 });
    expect(round.sources).toEqual({ 'lint:ko_style': 3, contract_checker: 1 });
    expect(round.lint).toEqual({
      'KO-DLG-SHARE': { count: 2, worst: 'major' },
      literary_drift: { count: 1, worst: 'minor' },
    });
    expect(round.dimensions).toEqual([
      {
        dimension: 'prose',
        score: 83,
        threshold: 80,
        passed: true,
        rubric_score: 80,
        lint_composite: 88,
      },
    ]);
  });
});
