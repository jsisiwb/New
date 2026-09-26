/**
 * ADR-0100 (live defect G14-4): a taste judge's reviewer-class major blocks only when a second reading of the same text
 * reproduces its kind as major. The claims are short excerpts of G14a's structure-judge findings.
 */
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_CHECKERS,
  agreementJudges,
  averageReadings,
  reproducedKinds,
  unconfirmCheckerFindings,
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

describe('checkers read again under checker_agreement (ADR-0106)', () => {
  const kinds = new Set([
    ...reviewer,
    'inventory_impossible',
    'world_rule_violation',
    'numeric_inconsistency',
    'other',
  ]);
  const checker = (over: Partial<Issue>): Issue =>
    issue({
      id: 'c',
      source: 'judge:continuity_checker',
      dimension: 'continuity',
      kind: 'inventory_impossible',
      claim: '주머니에 넣은 적 없는 핸드폰이 주머니에서 울린다.',
      chapter_span: { start: 100, end: 130, paragraph_ids: ['p12'] },
      ...over,
    });
  const both = new Map([
    ['structure_judge', {}],
    ['continuity_checker', {}],
  ]) as ReadonlyMap<never, unknown>;

  it('names a fresh checker whose reviewer-class majors and blockings are all that blocks, with the judges', () => {
    const blocking = checker({ id: 'b', kind: 'world_rule_violation', severity: 'blocking' });
    expect(
      agreementJudges([issue({}), checker({}), blocking], both, kinds, AGREEMENT_CHECKERS),
    ).toEqual(['structure_judge', 'continuity_checker']);
    // Without the policy's checkers the ADR-0100 rule stands: a checker's finding leaves nothing to agree on.
    expect(agreementJudges([issue({}), checker({})], both, kinds)).toEqual([]);
  });

  it('names none for a canon-workflow kind, an escalated kind, a checker that did not run or a lint', () => {
    const cases: Partial<Issue>[] = [
      { kind: 'canon_contradiction', override_class: 'canon_workflow' },
      { override_class: 'canon_workflow' },
      { source: 'judge:contract_checker' },
      { source: 'lint:ko_style' },
    ];
    for (const c of cases)
      expect(
        agreementJudges([checker({}), checker({ id: 'x', ...c })], both, kinds, AGREEMENT_CHECKERS),
      ).toEqual([]);
    const onlyJudge = new Map([['structure_judge', {}]]) as ReadonlyMap<never, unknown>;
    expect(agreementJudges([checker({})], onlyJudge, kinds, AGREEMENT_CHECKERS)).toEqual([]);
  });

  it('keeps a finding reproduced by kind or by an overlapping span and records the rest as minor doubts', () => {
    const phone = checker({});
    const skill = checker({
      id: 's',
      kind: 'world_rule_violation',
      severity: 'blocking',
      chapter_span: { start: 400, end: 440, paragraph_ids: ['p40'] },
    });
    const clock = checker({
      id: 't',
      kind: 'numeric_inconsistency',
      chapter_span: { start: 800, end: 820, paragraph_ids: ['p70'] },
    });
    const reread = [
      checker({
        id: 'r1',
        kind: 'other',
        chapter_span: { start: 410, end: 430, paragraph_ids: ['p40'] },
      }),
      checker({ id: 'r2', kind: 'numeric_inconsistency', severity: 'minor' }),
    ];
    const out = unconfirmCheckerFindings(
      [phone, skill, clock],
      'judge:continuity_checker',
      reread,
      kinds,
      true,
    );
    expect(out.map((i) => i.severity)).toEqual(['minor', 'blocking', 'minor']);
    expect(out[0]?.override_class).toBe('advisory');
    expect(out[0]?.claim).toMatch(/^\(두 번째 판독에서 재현되지 않은 설정 의심\) /u);
    // A reading of the same kind anywhere reproduces it.
    const again = unconfirmCheckerFindings(
      [phone],
      'judge:continuity_checker',
      [checker({ id: 'r3', chapter_span: { start: 900, end: 910 } })],
      kinds,
      true,
    );
    expect(again[0]?.severity).toBe('major');
    // Another source's findings are untouched.
    const judge = issue({});
    expect(unconfirmCheckerFindings([judge], 'judge:continuity_checker', [], kinds, true)).toEqual([
      judge,
    ]);
  });
});
