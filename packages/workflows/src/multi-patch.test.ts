import { describe, expect, it } from 'vitest';
import { clusterIssueSpans, mergePatches, widestScope } from './multi-patch.js';

const issue = (id: string, start?: number, end?: number) => ({
  id,
  chapter_span: start === undefined ? undefined : { start, end },
});

describe('multi-patch revision helpers (ADR-0077)', () => {
  it('clusters spans that lie within the gap and keeps distant ones apart', () => {
    const c = clusterIssueSpans(
      [issue('c', 500, 540), issue('a', 10, 30), issue('b', 60, 80), issue('d', 900, 950)],
      1000,
      50,
    );
    expect(c.map((x) => [x.start, x.end, x.issues.map((i) => i.id)])).toEqual([
      [10, 80, ['a', 'b']],
      [500, 540, ['c']],
      [900, 950, ['d']],
    ]);
  });

  it('leaves spanless issues out, unless no issue has a span', () => {
    expect(clusterIssueSpans([issue('a', 5, 9), issue('x')], 100, 0)).toEqual([
      { start: 5, end: 9, issues: [issue('a', 5, 9)] },
    ]);
    expect(clusterIssueSpans([issue('x'), issue('y')], 100, 0)).toEqual([
      { start: 0, end: 100, issues: [issue('x'), issue('y')] },
    ]);
    expect(clusterIssueSpans([], 100, 0)).toEqual([]);
    // A span outside the text is not usable.
    expect(clusterIssueSpans([issue('a', 90, 120)], 100, 0)).toEqual([
      { start: 0, end: 100, issues: [issue('a', 90, 120)] },
    ]);
  });

  it('merges patches right to left in code points and reports the envelope', () => {
    // Synthetic test string, not manuscript prose.
    const parent = '가나다라마바사아자차';
    const r = mergePatches(parent, [
      { start: 7, end: 9, newText: 'ㅇㅈㅈ' },
      { start: 1, end: 3, newText: 'X' },
    ]);
    expect(r.revised).toBe('가X라마바사ㅇㅈㅈ차');
    expect(r.envelope).toEqual({ start: 1, end: 9 });
    expect(r.middle).toBe('X라마바사ㅇㅈㅈ');
    // The envelope patch reproduces the revision from the parent.
    const cps = Array.from(parent);
    expect(cps.slice(0, 1).join('') + r.middle + cps.slice(9).join('')).toBe(r.revised);
  });

  it('refuses overlapping patches', () => {
    expect(() =>
      mergePatches('가나다라마', [
        { start: 0, end: 3, newText: 'a' },
        { start: 2, end: 4, newText: 'b' },
      ]),
    ).toThrow(/overlap/);
  });

  it('takes the widest scope', () => {
    expect(widestScope(['sentence', 'paragraph'])).toBe('paragraph');
    expect(widestScope(['sentence', 'scene', 'dialogue'])).toBe('scene');
    expect(widestScope(['sentence'])).toBe('sentence');
  });
});
