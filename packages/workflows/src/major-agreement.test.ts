/**
 * ADR-0100 (live defect G14-4): a taste judge's reviewer-class major blocks only when a second reading of the same text
 * reproduces its kind as major. The claims are short excerpts of G14a's structure-judge findings.
 */
import { describe, expect, it } from 'vitest';
import {
  agreementJudges,
  averageReadings,
  reproducedKinds,
  unconfirmMajors,
  type Issue,
} from './evaluation.js';

const reviewer = new Set(['late_hook', 'weak_pacing', 'weak_ending', 'excessive_exposition']);
const issue = (over: Partial<Issue>): Issue => ({
  id: 'i',
  kind: 'late_hook',
  dimension: 'structure',
  severity: 'major',
  status: 'open',
  source: 'judge:structure_judge',
  confidence: 0.9,
  claim: '첫 세 문장은 환호와 경기장 묘사에 쓰인다.',
  override_class: 'reviewer',
  ...over,
});
const fresh = new Map([['structure_judge', {}]]) as ReadonlyMap<never, unknown>;

describe('which judges read again (ADR-0100)', () => {
  it('names a fresh taste judge whose reviewer-class majors are all that blocks', () => {
    const minor = issue({ id: 'm', severity: 'minor', source: 'lint:ko_style' });
    expect(agreementJudges([issue({}), minor], fresh, reviewer)).toEqual(['structure_judge']);
  });

  it('names none when a blocking finding, a checker, a carried judge or another kind is in the way', () => {
    const cases: Partial<Issue>[] = [
      { severity: 'blocking' },
      { source: 'judge:continuity_checker', kind: 'character_inconsistency' },
      { source: 'judge:genre_judge' },
      { kind: 'format_drift' },
    ];
    for (const c of cases)
      expect(agreementJudges([issue({}), issue({ id: 'x', ...c })], fresh, reviewer)).toEqual([]);
    expect(agreementJudges([issue({ severity: 'minor' })], fresh, reviewer)).toEqual([]);
  });
});

describe('merging two readings (ADR-0100)', () => {
  it('keeps a reproduced major and records the rest as minor with a note', () => {
    const pacing = issue({ id: 'p', kind: 'weak_pacing' });
    const reread = [issue({ id: 'r' }), issue({ id: 'q', kind: 'weak_pacing', severity: 'minor' })];
    const out = unconfirmMajors(
      [issue({}), pacing],
      'judge:structure_judge',
      reproducedKinds(reread),
      reviewer,
      true,
    );
    expect(out.map((i) => i.severity)).toEqual(['major', 'minor']);
    expect(out[1]?.claim).toMatch(/^\(두 번째 판독에서 주요 결함으로 재현되지 않음\) /u);
    // Another judge's findings are untouched.
    const genre = issue({ id: 'g', source: 'judge:genre_judge' });
    expect(unconfirmMajors([genre], 'judge:structure_judge', new Set(), reviewer, true)).toEqual([
      genre,
    ]);
  });

  it('averages the two readings’ scores and keeps the first reading’s findings', () => {
    const first = {
      judge_score: 70,
      dimension_scores: { hook_timing: 2, ending_pull: 3 },
      issues: [],
    };
    const merged = averageReadings(first, {
      judge_score: 86,
      dimension_scores: { hook_timing: 4, ending_pull: 3 },
    });
    expect(merged).toEqual({
      judge_score: 78,
      dimension_scores: { hook_timing: 3, ending_pull: 3 },
      issues: [],
    });
  });
});
