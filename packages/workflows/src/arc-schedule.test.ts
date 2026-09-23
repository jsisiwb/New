import { describe, expect, it } from 'vitest';
import { ARC_WINDOW, arcForChapter, previousArcOf, scheduleFromBlueprint } from './story-plan.js';
import { type SeriesBlueprint } from './story-plan.js';

function blueprint(ranges: readonly [number, number][]): SeriesBlueprint {
  return {
    seasons: ranges.map(([from, to], i) => ({
      ordinal: i + 1,
      title: `S${String(i + 1)}`,
      objective: 'o',
      chapter_range_est: { from, to },
    })),
  } as unknown as SeriesBlueprint;
}

describe('arc schedule from the blueprint (ADR-0056)', () => {
  it('splits a long season into ~10-chapter arcs that tile it exactly', () => {
    const s = scheduleFromBlueprint(
      'p',
      blueprint([
        [1, 50],
        [51, 100],
      ]),
    );
    expect(ARC_WINDOW).toBe(10);
    expect(s.arcs).toHaveLength(10);
    expect(s.arcs.slice(0, 5).map((a) => [a.from, a.to, a.ordinal, a.arcInSeason])).toEqual([
      [1, 10, 1, 1],
      [11, 20, 1, 2],
      [21, 30, 1, 3],
      [31, 40, 1, 4],
      [41, 50, 1, 5],
    ]);
    for (let ch = 1; ch <= 100; ch++) expect(arcForChapter(s, ch)?.from).toBeLessThanOrEqual(ch);
    expect(new Set(s.arcs.map((a) => a.id)).size).toBe(10);
  });

  it('keeps short seasons as one arc (fixture lineage) and folds a short remainder into the last arc', () => {
    const short = scheduleFromBlueprint('p', blueprint([[1, 3]]));
    expect(short.arcs.map((a) => [a.from, a.to, a.arcInSeason])).toEqual([[1, 3, 1]]);
    const odd = scheduleFromBlueprint('p', blueprint([[1, 44]]));
    expect(odd.arcs.map((a) => [a.from, a.to])).toEqual([
      [1, 10],
      [11, 20],
      [21, 30],
      [31, 44],
    ]);
  });

  it('chains arcs across season boundaries', () => {
    const s = scheduleFromBlueprint(
      'p',
      blueprint([
        [1, 50],
        [51, 100],
      ]),
    );
    const first = arcForChapter(s, 51);
    expect(first?.arcInSeason).toBe(1);
    expect(first && previousArcOf(s, first)?.to).toBe(50);
    const opening = arcForChapter(s, 1);
    expect(opening && previousArcOf(s, opening)).toBeUndefined();
  });
});
