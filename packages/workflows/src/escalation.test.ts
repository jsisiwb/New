/**
 * ADR-0116 (`standard@35`, G21-1): a finding's survival across kept patch rounds. Texts are synthetic two-word lines.
 */
import { describe, expect, it } from 'vitest';
import { findingKey, stuckTargets, updateSurvival, withSurvivalNotes } from './escalation.js';
import type { Issue } from './evaluation.js';

const issue = (text: string, quote: string, over: Partial<Issue> = {}): Issue => {
  const start = Array.from(text.slice(0, text.indexOf(quote))).length;
  return {
    id: 'i',
    kind: 'inventory_impossible',
    dimension: 'continuity',
    severity: 'major',
    status: 'open',
    source: 'judge:continuity_checker',
    confidence: 0.9,
    claim: '돈을 넣은 곳이 두 번 다르게 나온다.',
    override_class: 'reviewer',
    chapter_span: { start, end: start + Array.from(quote).length, quote },
    ...over,
  };
};

describe('a finding that survives its patches (ADR-0116)', () => {
  const v1 = '알파 하나.\n\n브라보 둘.\n\n찰리 셋.';
  const v2 = '알파 하나.\n\n문득 브라보 둘.\n\n찰리 셋.';

  it('keys a finding by its paragraph, whatever words or kind a reading used', () => {
    const a = issue(v1, '찰리');
    const b = issue(v1, '셋.', { kind: 'numeric_inconsistency' });
    expect(findingKey(a, v1)).toBe(findingKey(b, v1));
    expect(findingKey(a, v1)).not.toBe(findingKey(issue(v1, '알파'), v1));
  });

  it('counts a round the finding survived and forgets one it did not', () => {
    const stuck = issue(v1, '찰리');
    const fixed = issue(v1, '브라보');
    const after = [issue(v2, '찰리 셋')];
    const once = updateSurvival(new Map(), [stuck, fixed], v1, after, v2);
    expect([...once.values()]).toEqual([1]);
    const twice = updateSurvival(once, [issue(v2, '찰리')], v2, after, v2);
    expect(stuckTargets([issue(v2, '찰리'), issue(v2, '알파')], twice, v2, 2).length).toBe(1);
    expect(updateSurvival(twice, [issue(v2, '찰리')], v2, [], v2).size).toBe(0);
  });

  it('follows a survivor whose paragraph the patch edited around the quote', () => {
    const edited = '알파 하나.\n\n브라보 둘.\n\n문득 찰리 셋.';
    const once = updateSurvival(
      new Map(),
      [issue(v1, '찰리 셋')],
      v1,
      [issue(edited, '찰리 셋')],
      edited,
    );
    expect(stuckTargets([issue(edited, '찰리 셋')], once, edited, 1).length).toBe(1);
  });

  it('names the failure to the reviser only for a survivor', () => {
    const survived = updateSurvival(new Map(), [issue(v1, '찰리')], v1, [issue(v2, '찰리')], v2);
    const out = withSurvivalNotes([issue(v2, '찰리'), issue(v2, '알파')], survived, v2, true);
    expect(out[0]?.claim).toContain('지난 수정 뒤에도 이 결함이 그대로 남았다');
    expect(out[1]?.claim).toBe('돈을 넣은 곳이 두 번 다르게 나온다.');
  });
});
