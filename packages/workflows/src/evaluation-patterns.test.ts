/**
 * ADR-0057 §5: a contract's must-not lexical pattern is model-written text. An invalid one used to throw out
 * of the deterministic checks (`new RegExp` on it directly); it is now a recorded finding and the guard still
 * runs, matching the pattern literally.
 */
import { requirePolicy } from '@yeonjae/domain';
import { describe, expect, it } from 'vitest';
import { type ManuscriptVersionRow } from '@yeonjae/db';
import { runDeterministicChecks } from './evaluation.js';
import { type ChapterContract } from './planning.js';
import { type WorkflowContext } from './runtime.js';

const ctx = {
  workflowId: 'chapter:test:1',
  policy: requirePolicy('policy/standard@1'),
  identity: { outputLanguage: { language: 'en' }, genres: [], tradition: {} },
} as unknown as WorkflowContext;

const text =
  'Seo-ha raised the blade and the gate answered with light.\n\n“Now,” she said, and stepped through the (betrayal door.';

function contract(patterns: string[]): ChapterContract {
  return {
    chapter_number: 1,
    scene_count: 1,
    length_target: { unit: 'words', value: 20, tolerance_ratio: 0.12 },
    must_not_happen: [
      { id: 'MN-1', description: 'no betrayal', source: 'spec', lexical_patterns: patterns },
    ],
  } as unknown as ChapterContract;
}

const version = { id: '00000000-0000-4000-8000-000000000001', text } as ManuscriptVersionRow;

describe('must-not lexical patterns are compiled safely (ADR-0057)', () => {
  it('records an invalid pattern as a finding instead of throwing, and still matches it literally', () => {
    const det = runDeterministicChecks(ctx, version, contract(['(betrayal']), []);
    const invalid = det.issues.find((i) => i.metric?.rule_id === 'CONTRACT-PATTERN-INVALID');
    expect(invalid).toMatchObject({ severity: 'minor', dimension: 'contract' });
    expect(det.issues.some((i) => i.kind === 'forbidden_development')).toBe(true);
    expect(det.contract_shape.passed).toBe(false);
  });

  it('keeps valid patterns as regexes and adds no finding for them', () => {
    const det = runDeterministicChecks(ctx, version, contract(['bet+rayal', 'dragon']), []);
    expect(det.issues.some((i) => i.metric?.rule_id === 'CONTRACT-PATTERN-INVALID')).toBe(false);
    expect(det.issues.filter((i) => i.kind === 'forbidden_development')).toHaveLength(1);
  });
});
