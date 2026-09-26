import { describe, expect, it } from 'vitest';
import {
  claimAnchor,
  findingInRange,
  isSpanlessJudgeFinding,
  claimForKoreanNote,
  nextRung,
  rejectionReasons,
  repeatDecision,
  targetsKey,
} from './ladder.js';

const TEXT = '첫 문단이다.\n\n둘째 문단이다.\n\n셋째 문단이다.';

describe('the escalation ladder helpers (ADR-0092)', () => {
  it('anchors a quoteless claim at the paragraph it names, the opening or the cut', () => {
    expect(claimAnchor('첫 3문장(p1~p3)에 상태창이 없다. 상태창은 p14에 나온다.', TEXT)).toBe(0);
    expect(claimAnchor('[p2]에서 회귀를 자각한다.', TEXT)).toBe(9);
    expect(claimAnchor('도입부가 풍경으로 열린다.', TEXT)).toBe(0);
    expect(claimAnchor('절단이 약하다.', TEXT)).toBe(19);
    expect(claimAnchor('p99를 인용한다.', TEXT)).toBeUndefined();
    expect(claimAnchor('인물의 말투가 흔들린다.', TEXT)).toBeUndefined();
  });

  it('treats only quoteless judge findings as spanless', () => {
    const base = { id: 'a', dimension: 'contract', kind: 'missing_required_event', claim: 'AC-1' };
    expect(isSpanlessJudgeFinding({ ...base, source: 'judge:contract_checker' })).toBe(true);
    expect(isSpanlessJudgeFinding({ ...base, source: 'lint:ko_style' })).toBe(false);
    expect(
      isSpanlessJudgeFinding({
        ...base,
        source: 'judge:contract_checker',
        chapter_span: { start: 3 },
      }),
    ).toBe(false);
  });

  it('places a finding in a scene by its quote or, when asked, by its claim', () => {
    const range = { start: 0, end: 9 };
    const f = { id: 'a', dimension: 'contract', kind: 'x', claim: '[p1] 도입' };
    expect(findingInRange(f, range, TEXT, true)).toBe(true);
    expect(findingInRange(f, range, TEXT, false)).toBe(false);
    expect(findingInRange({ ...f, chapter_span: { start: 12 } }, range, TEXT, true)).toBe(false);
  });

  it('keys targets by dimension, kind and position regardless of order', () => {
    const a = {
      id: '1',
      dimension: 'prose',
      kind: 'other',
      claim: 'x',
      chapter_span: { start: 5 },
    };
    const b = { id: '2', dimension: 'contract', kind: 'missing_required_event', claim: 'y' };
    expect(targetsKey([a, b])).toBe(targetsKey([b, { ...a, id: '9' }]));
    expect(targetsKey([a])).not.toBe(targetsKey([b]));
  });

  it('escalates a repeated patch round, stops a repeated rewrite, repeats anything else', () => {
    const last = { parentId: 'v1', targets: 'k', rung: 'patch' as const, reasons: [] };
    const next = { parentId: 'v1', targets: 'k', rung: 'patch' as const, rewritesLeft: true };
    expect(repeatDecision(undefined, next)).toBe('repeat');
    expect(repeatDecision(last, next)).toBe('escalate');
    expect(repeatDecision(last, { ...next, rewritesLeft: false })).toBe('stop');
    expect(repeatDecision({ ...last, rung: 'scene' }, next)).toBe('stop');
    expect(repeatDecision(last, { ...next, parentId: 'v2' })).toBe('repeat');
    expect(repeatDecision(last, { ...next, targets: 'other' })).toBe('repeat');
  });

  it('writes the rejection reasons in Korean with at most three introduced claims', () => {
    const r = rejectionReasons(
      ['targeted_worsened', 'new_blocking_or_major_issue', 'unknown_code'],
      ['가', '나', '다', '라'],
    );
    expect(r).toEqual(['겨냥한 차원의 점수가 떨어졌다', '새 결함이 생겼다', '가', '나', '다']);
    for (const line of r) expect(line).not.toMatch(/[A-Za-z]/);
  });

  it("renders a failed criterion claim for a Korean writer without the evaluator's English prefix", () => {
    expect(
      claimForKoreanNote('acceptance criterion AC-1 failed: 첫 3문장(p1~p3)에 상태창이 없다.'),
    ).toBe('계약 기준 AC-1 미충족: 첫 3문장(p1~p3)에 상태창이 없다.');
    expect(claimForKoreanNote('acceptance criterion AC-3 failed: deterministic')).toBe(
      '계약 기준 AC-3 미충족',
    );
    expect(claimForKoreanNote('절단이 약하다.')).toBe('절단이 약하다.');
  });

  it('takes the untried rung, then stops only when both failed (ADR-0093, G10-4)', () => {
    expect(nextRung(new Set(), 'scene', true)).toBe('scene');
    expect(nextRung(new Set(['scene']), 'scene', true)).toBe('patch');
    expect(nextRung(new Set(['patch']), 'patch', true)).toBe('scene');
    expect(nextRung(new Set(['patch']), 'patch', false)).toBe('stop');
    expect(nextRung(new Set(['patch', 'scene']), 'patch', true)).toBe('stop');
  });
});
