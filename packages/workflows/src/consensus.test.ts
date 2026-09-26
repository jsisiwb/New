/**
 * ADR-0115 (`standard@34`): consensus readings and the finding ledger. Claims are synthetic one-liners.
 */
import { toNfcText, segmentParagraphs } from '@yeonjae/prose';
import { describe, expect, it } from 'vitest';
import {
  applyLedger,
  changedParagraphIds,
  clusterReadings,
  consensusCriteria,
  consensusIssues,
  medianReadings,
} from './consensus.js';
import type { Issue } from './evaluation.js';

const reviewer = new Set(['inventory_impossible', 'weak_ending', 'numeric_inconsistency']);
const issue = (over: Partial<Issue>): Issue => ({
  id: 'i',
  kind: 'inventory_impossible',
  dimension: 'continuity',
  severity: 'major',
  status: 'open',
  source: 'judge:continuity_checker',
  confidence: 0.9,
  claim: '돈을 넣은 곳이 두 번 다르게 나온다.',
  override_class: 'reviewer',
  ...over,
});
const at = (start: number, end: number, ids: string[]) => ({ start, end, paragraph_ids: ids });
const opts = {
  quorum: 2,
  reviewer,
  ko: true,
  classFor: (): Issue['override_class'] => 'reviewer',
};

describe('consensus of K readings (ADR-0115)', () => {
  it('keeps a finding two of three readings raise and notes one raised once', () => {
    const r1 = [issue({ id: 'a', chapter_span: at(0, 5, ['p1']) })];
    const r2 = [issue({ id: 'b', kind: 'numeric_inconsistency', chapter_span: at(2, 7, ['p1']) })];
    const r3 = [issue({ id: 'c', chapter_span: at(40, 45, ['p4']) })];
    const out = consensusIssues([r1, r2, r3], opts);
    expect(out.map((i) => [i.id, i.severity])).toEqual([
      ['a', 'major'],
      ['c', 'minor'],
    ]);
    expect(out[1]?.claim.startsWith('(3회 판독 중 1회만 주요 결함으로 지적) ')).toBe(true);
    expect(out[1]?.override_class).toBe('advisory');
  });

  it('takes the severity a quorum agrees on', () => {
    const span = at(0, 5, ['p1']);
    const out = consensusIssues(
      [
        [issue({ id: 'a', severity: 'blocking', chapter_span: span })],
        [issue({ id: 'b', chapter_span: span })],
        [],
      ],
      opts,
    );
    expect(out.map((i) => [i.id, i.severity])).toEqual([['a', 'major']]);
  });

  it('lets a hard kind stand on one reading', () => {
    const hard = issue({ id: 'h', kind: 'canon_contradiction', override_class: 'canon_workflow' });
    expect(consensusIssues([[hard], [], []], opts).map((i) => i.severity)).toEqual(['major']);
  });

  it('matches unquoted findings by kind and never merges findings of one reading', () => {
    const ending = issue({ id: 'e', kind: 'weak_ending', source: 'judge:structure_judge' });
    expect(consensusIssues([[ending], [{ ...ending, id: 'f' }], []], opts)[0]?.severity).toBe(
      'major',
    );
    const twice = [
      issue({ id: 'x', chapter_span: at(0, 5, ['p1']) }),
      issue({ id: 'y', chapter_span: at(1, 4, ['p1']) }),
    ];
    expect(clusterReadings([twice]).length).toBe(2);
  });
});

describe('median scores and criteria (ADR-0115)', () => {
  it('takes the median of each score', () => {
    const out = medianReadings([
      { judge_score: 70, dimension_scores: { a: 3, b: 5 } },
      { judge_score: 90, dimension_scores: { a: 4, b: 1 } },
      { judge_score: 80, dimension_scores: { a: 5 } },
    ]);
    expect(out.judge_score).toBe(80);
    expect(out.dimension_scores).toEqual({ a: 4, b: 3 });
  });

  it('fails a criterion only on a quorum of failing readings; an omitted criterion fails', () => {
    const pass = { criterion_id: 'AC-1', passed: true };
    const fail = { criterion_id: 'AC-1', passed: false, note: '없다' };
    expect(consensusCriteria([[pass], [fail], [pass]], 2)).toEqual([pass]);
    expect(consensusCriteria([[fail], [], [pass]], 2)).toEqual([fail]);
  });
});

describe('the finding ledger (ADR-0115)', () => {
  const before =
    '첫 문단이다.\n\n둘째 문단이다.\n\n셋째 문단이다.\n\n넷째 문단이다.\n\n다섯째 문단이다.';
  const after = before.replace('다섯째 문단이다.', '다섯째 문단을 고쳤다.');
  const paragraphs = segmentParagraphs(toNfcText(after));
  const changed = changedParagraphIds(segmentParagraphs(toNfcText(before)), paragraphs);
  const on = (k: number) => {
    const p = paragraphs[k];
    if (!p) throw new Error('no paragraph');
    return at(p.start, p.end, [p.id]);
  };
  const base = { changed, paragraphs, window: 1, ko: true };

  it('finds the changed paragraph by text', () => {
    expect([...changed]).toEqual([paragraphs[4]?.id]);
  });

  it('holds a new heavy finding on text that passed unchanged', () => {
    const out = applyLedger({
      ...base,
      fresh: [issue({ id: 'n', chapter_span: on(0) })],
      prior: [],
    });
    expect(out.issues.map((i) => i.severity)).toEqual(['minor']);
    expect(out.held.length).toBe(1);
    expect(out.issues[0]?.claim.startsWith('(앞서 통과한 대목의 새 지적')).toBe(true);
  });

  it('counts a finding in or next to changed text, or one re-raising an open entry', () => {
    const near = issue({ id: 'w', chapter_span: on(3) });
    const again = issue({ id: 'g', chapter_span: on(1) });
    const prior = [issue({ id: 'p', chapter_span: on(1) })];
    const out = applyLedger({ ...base, fresh: [near, again], prior });
    expect(out.issues.map((i) => [i.id, i.severity])).toEqual([
      ['w', 'major'],
      ['g', 'major'],
    ]);
    expect(out.carried).toEqual([]);
  });

  it('keeps an open entry on unchanged text open and resolves one whose text changed', () => {
    const stays = issue({ id: 's', chapter_span: on(1) });
    const fixed = issue({ id: 'f', chapter_span: on(4) });
    const out = applyLedger({ ...base, fresh: [], prior: [stays, fixed] });
    expect(out.issues.map((i) => i.id)).toEqual(['s']);
    expect(out.carried.map((i) => i.id)).toEqual(['s']);
  });

  it('drops a lighter re-reading of a carried entry', () => {
    const stays = issue({ id: 's', chapter_span: on(1) });
    const light = issue({ id: 'l', severity: 'minor', chapter_span: on(1) });
    expect(
      applyLedger({ ...base, fresh: [light], prior: [stays] }).issues.map((i) => i.id),
    ).toEqual(['s']);
  });
});
