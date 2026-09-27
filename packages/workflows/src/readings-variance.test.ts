import { describe, expect, it } from 'vitest';
import type { Generated } from '@yeonjae/domain';
import {
  analyzeReadingVariance,
  gateSides,
  readingBase,
  sameRawFinding,
  tripleVariance,
} from './readings-variance.js';

type Issue = Generated.IssueSchema.Issue;

function mockIssue(
  id: string,
  start?: number,
  end?: number,
  severity: Issue['severity'] = 'major',
  kind: Issue['kind'] = 'register_error',
): Issue {
  return {
    id,
    source: 'judge:prose_judge',
    dimension: 'prose',
    kind,
    severity,
    confidence: 1,
    claim: `test claim for ${id}`,
    chapter_span:
      start !== undefined ? { start, end: end ?? start + 10, quote: 'test' } : undefined,
  };
}

describe('Reading Variance Analysis (STEP 1.2)', () => {
  it('groups findings across 5 readings and measures 1-of-5 noise vs >=3-of-5 consensus', () => {
    // Shared finding across all 5 readings: span 10..20
    const shared1 = (r: number) => mockIssue(`shared1_r${r}`, 10, 20);
    // Finding across 3 of 5 readings: span 50..60
    const shared2 = (r: number) => mockIssue(`shared2_r${r}`, 50, 60);
    // Single reading findings
    const noiseR1 = mockIssue('noise_r1', 100, 110);
    const noiseR2 = mockIssue('noise_r2', 200, 210);

    const r1 = [shared1(1), shared2(1), noiseR1];
    const r2 = [shared1(2), shared2(2), noiseR2];
    const r3 = [shared1(3), shared2(3)];
    const r4 = [shared1(4)];
    const r5 = [shared1(5)];

    const dimensionScores = [
      { prose: 80, structure: 85 },
      { prose: 82, structure: 82 },
      { prose: 79, structure: 84 },
      { prose: 84, structure: 86 },
      { prose: 81, structure: 83 },
    ];

    const res = analyzeReadingVariance([r1, r2, r3, r4, r5], dimensionScores);
    expect(res.totalReadings).toBe(5);
    expect(res.totalClusters).toBe(4); // shared1, shared2, noiseR1, noiseR2
    expect(res.seenInCount[5]).toBe(1); // shared1
    expect(res.seenInCount[3]).toBe(1); // shared2
    expect(res.seenInCount[1]).toBe(2); // noiseR1, noiseR2

    // share seen in >= 3 readings: 2 / 4 = 0.5
    expect(res.shareSeenInAtLeast[3]).toBe(0.5);

    // score spreads
    expect(res.scoreSpreads.prose?.spread).toBe(5); // 84 - 79
    expect(res.scoreSpreads.prose?.median).toBe(81);
    expect(res.scoreSpreads.structure?.spread).toBe(4); // 86 - 82
  });
});

describe('stored consensus readings (run 6, STEP 1.2)', () => {
  const r = (
    issues: { kind: string; severity: string; quote?: string }[],
    score?: number,
    rubric: Record<string, number> = {},
  ) => ({ issues, score, rubric });

  it('clusters raw findings by kind and overlapping quote, and counts what a 2-of-3 quorum drops', () => {
    const t = tripleVariance([
      r([{ kind: 'repeated_scene', severity: 'major', quote: 'ㄱㄴ ㄷ' }], 82, { hook_timing: 5 }),
      r(
        [
          { kind: 'repeated_scene', severity: 'major', quote: 'ㄱㄴㄷㄹ' },
          { kind: 'pacing_slow', severity: 'major' },
        ],
        78,
        { hook_timing: 3 },
      ),
      r([{ kind: 'pacing_slow', severity: 'minor', quote: 'ㅁ' }], 80, { hook_timing: 4 }),
    ]);
    expect(t.distinct).toBe(3);
    expect(t.seenIn).toEqual({ 2: 1, 1: 2 });
    expect(t.heavyQuorum).toBe(1);
    expect(t.heavySingle).toBe(1);
    expect(t.scoreSpread).toBe(4);
    expect(t.rubricSpread).toEqual({ hook_timing: 2 });
  });

  it('matches quoteless findings only with quoteless ones, and names the base activity of a reading', () => {
    expect(sameRawFinding({ kind: 'a', severity: 'major' }, { kind: 'a', severity: 'minor' })).toBe(
      true,
    );
    expect(
      sameRawFinding(
        { kind: 'a', severity: 'major' },
        { kind: 'a', severity: 'major', quote: 'ㄱ' },
      ),
    ).toBe(false);
    expect(readingBase('structure_judge:2:r1:full:c3')).toBe('structure_judge:2:r1:full');
    expect(readingBase('structure_judge:2:r1')).toBe('structure_judge:2:r1');
  });
});

describe('a judge against its gate (run 6, STEP 1.2)', () => {
  it('finds readings of one text on both sides of the gate', () => {
    const all = (v: number) => ({
      hook_timing: v,
      dialogue_forwardness: v,
      local_payoff: v,
      ending_pull: v,
      exposition_control: v,
    });
    // Rubric scores 75, 100 and 50 (mean − 1) × 25 against a gate of 78.
    expect(gateSides([all(4), all(5), all(3)], 'structure', 78)).toEqual({
      straddles: true,
      medianBelow: true,
    });
    expect(gateSides([all(5), all(5), all(4)], 'structure', 78)).toEqual({
      straddles: true,
      medianBelow: false,
    });
    expect(gateSides([all(5), all(5)], 'structure', 78).straddles).toBe(false);
  });
});
