/**
 * ADR-0086 (V2, live defect G5-3): findings are attributed to the text a patch changed, a passing dimension may
 * move inside its passing band, and a score-only failure gets its judge's weakest passages as targets.
 */
import { describe, expect, it } from 'vitest';
import { requirePolicy, validatorFor } from '@yeonjae/domain';
import { changedRanges, patchRegression } from './comparison.js';
import { scoreTargets, type Scorecard } from './evaluation.js';

const V14 = requirePolicy('policy/standard@14');
const V15 = requirePolicy('policy/standard@15');

interface IssueIn {
  id: string;
  dimension: Scorecard['issues'][number]['dimension'];
  kind: Scorecard['issues'][number]['kind'];
  severity?: 'blocking' | 'major' | 'minor';
  span?: { start: number; end: number };
}

function card(input: {
  prose: number;
  structure: number;
  genre?: number;
  voice?: number;
  issues?: IssueIn[];
  weakest?: { quote: string; why: string }[];
}): Scorecard {
  const genre = input.genre ?? 85;
  const voice = input.voice ?? 85;
  const issues = (input.issues ?? []).map((i) => ({
    id: i.id,
    source: 'judge:continuity_checker',
    dimension: i.dimension,
    kind: i.kind,
    severity: i.severity ?? ('major' as const),
    override_class: 'reviewer' as const,
    confidence: 0.9,
    claim: '지적',
    status: 'open' as const,
    ...(i.span
      ? {
          chapter_span: {
            manuscript_version_id: '0191b2a0-0000-7000-8000-00000c0e0001',
            start: i.span.start,
            end: i.span.end,
            quote: '인용',
            paragraph_ids: [],
          },
        }
      : {}),
  }));
  const hasMajor = (d: string) =>
    issues.some((i) => i.dimension === d && (i.severity === 'major' || i.severity === 'blocking'));
  const dims: [string, number, number][] = [
    ['prose', input.prose, 78],
    ['structure', input.structure, 78],
    ['genre', genre, 72],
    ['voice', voice, 76],
  ];
  const c = {
    id: '0191b2a0-0000-7000-8000-00000c0e0002',
    manuscript_version_id: '0191b2a0-0000-7000-8000-00000c0e0001',
    canon_version: 1,
    overall: {
      score: (input.prose + input.structure) / 2,
      blocking_count: issues.filter((i) => i.severity === 'blocking').length,
      major_count: issues.filter((i) => i.severity === 'major').length,
      minor_count: 0,
    },
    sections: {
      prose: {
        score: input.prose,
        passed: input.prose >= 78,
        ...(input.weakest ? { weakest_passages: input.weakest } : {}),
      },
      structure: { score: input.structure, passed: input.structure >= 78 },
      genre: { score: genre, passed: genre >= 72 },
      voice: { score: voice, passed: voice >= 76 },
      output_language: { score: 100, passed: true },
      contract_compliance: { score: 100, passed: true },
      continuity: { score: hasMajor('continuity') ? 0 : 100, passed: !hasMajor('continuity') },
      knowledge: { score: 100, passed: true },
    },
    issues,
    acceptance: {
      criteria_results: [],
      dimension_results: dims.map(([dimension, score, threshold]) => ({
        dimension: dimension as 'prose',
        score,
        threshold,
        passed: score >= threshold,
      })),
      auto_approvable: false,
      production_policy_version: 'policy/standard@15',
      gate_outcome: 'rejected',
    },
  };
  const v = validatorFor<Scorecard>('scorecard.schema.json')(c);
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.value;
}

// Synthetic one-line paragraphs (test strings, not manuscript).
const PARENT = ['첫 줄이다.', '고칠 줄이다.', '셋째 줄이다.', '넷째 줄이다.'].join('\n');
const CHILD = ['첫 줄이다.', '고친 줄이 되었다.', '셋째 줄이다.', '넷째 줄이다.'].join('\n');

describe('changed ranges', () => {
  it('finds the lines each version has that the other does not', () => {
    const r = changedRanges({ parent: PARENT, child: CHILD });
    expect(r.parent).toEqual([{ start: 7, end: 14 }]);
    expect(r.child).toEqual([{ start: 7, end: 17 }]);
    expect(changedRanges({ parent: PARENT, child: PARENT })).toEqual({ parent: [], child: [] });
  });
});

describe('patch regression under revision.convergence (ADR-0086)', () => {
  it('keeps a patch that repaired structure while genre fell from 100 to 90 above its gate (G5a r3)', () => {
    const before = card({
      prose: 80,
      structure: 77.5,
      genre: 100,
      issues: [
        {
          id: '0191b2a0-0000-7000-8000-00000c0e0003',
          dimension: 'structure',
          kind: 'weak_ending',
          span: { start: 7, end: 14 },
        },
      ],
    });
    const after = card({ prose: 80, structure: 88, genre: 90 });
    const input = {
      before,
      after,
      dimension: 'structure' as const,
      targetedIssueIds: ['0191b2a0-0000-7000-8000-00000c0e0003'],
      texts: { parent: PARENT, child: CHILD },
    };
    expect(patchRegression(V14, input).failures).toContain('protected_dimension_regressed');
    const v15 = patchRegression(V15, input);
    expect(v15.failures).toEqual([]);
    expect(v15.passed).toBe(true);
  });

  it('still fails a patch that drops a protected dimension below its gate', () => {
    const report = patchRegression(V15, {
      before: card({
        prose: 82,
        structure: 70,
        issues: [
          {
            id: '0191b2a0-0000-7000-8000-00000c0e0003',
            dimension: 'structure',
            kind: 'weak_ending',
            span: { start: 7, end: 14 },
          },
        ],
      }),
      after: card({ prose: 74, structure: 85 }),
      dimension: 'structure',
      targetedIssueIds: ['0191b2a0-0000-7000-8000-00000c0e0003'],
      texts: { parent: PARENT, child: CHILD },
    });
    expect(report.failures).toContain('protected_dimension_regressed');
  });

  it('does not blame a patch for a new finding in text it did not change, and does for one in text it wrote', () => {
    const before = card({
      prose: 80,
      structure: 70,
      issues: [
        {
          id: '0191b2a0-0000-7000-8000-00000c0e0003',
          dimension: 'structure',
          kind: 'weak_ending',
          span: { start: 7, end: 14 },
        },
      ],
    });
    const untouched = card({
      prose: 80,
      structure: 85,
      issues: [
        // The third line is identical in both versions: judge variance on shared text.
        {
          id: '0191b2a0-0000-7000-8000-00000c0e0004',
          dimension: 'continuity',
          kind: 'canon_contradiction',
          span: { start: 18, end: 25 },
        },
      ],
    });
    const base = {
      before,
      dimension: 'structure' as const,
      targetedIssueIds: ['0191b2a0-0000-7000-8000-00000c0e0003'],
      texts: { parent: PARENT, child: CHILD },
    };
    const kept = patchRegression(V15, { ...base, after: untouched });
    expect(kept.newIssueKinds).toEqual([]);
    expect(kept.passed).toBe(true);
    const written = card({
      prose: 80,
      structure: 85,
      issues: [
        {
          id: '0191b2a0-0000-7000-8000-00000c0e0004',
          dimension: 'continuity',
          kind: 'canon_contradiction',
          span: { start: 8, end: 12 },
        },
      ],
    });
    const blamed = patchRegression(V15, { ...base, after: written });
    expect(blamed.newIssueKinds).toEqual(['canon_contradiction']);
    expect(blamed.passed).toBe(false);
    // Without the texts the rule is the old one: any new kind fails.
    expect(patchRegression(V15, { ...base, texts: undefined, after: untouched }).passed).toBe(
      false,
    );
  });
});

describe('score-only targets (ADR-0086, G5-3e)', () => {
  it('turns a failing dimension with no major into its weakest passages, anchored in the text', () => {
    const text = '첫 줄이다.\n약한 문장이 여기에 있다.\n끝.';
    const sc = card({
      prose: 75.4,
      structure: 88,
      weakest: [
        { quote: '약한 문장이 여기에 있다.', why: '어색한 직역' },
        { quote: '원고에 없는 문장.', why: '없는 인용' },
      ],
    });
    const targets = scoreTargets(sc, text);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ dimension: 'prose', severity: 'minor', kind: 'other' });
    expect(targets[0]?.chapter_span).toMatchObject({ start: 7, end: 21 });
    // A failing dimension that already has a major finding is targeted through that finding instead.
    const withMajor = card({
      prose: 75.4,
      structure: 88,
      weakest: [{ quote: '약한 문장이 여기에 있다.', why: '어색' }],
      issues: [
        { id: '0191b2a0-0000-7000-8000-00000c0e0003', dimension: 'prose', kind: 'literary_drift' },
      ],
    });
    expect(scoreTargets(withMajor, text)).toEqual([]);
  });
});
