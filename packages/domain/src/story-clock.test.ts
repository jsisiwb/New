import { describe, expect, it } from 'vitest';
import {
  compareForRendering,
  compareNarrative,
  compareWorld,
  narrativeOrd,
  withinValidity,
  type StoryClock,
} from './story-clock.js';

const c = (chapter_no: number, ordinal: number, extra: Partial<StoryClock> = {}): StoryClock => ({
  chapter_no,
  ordinal,
  precision: 'exact',
  ...extra,
});

describe('StoryClock (ADR-0040)', () => {
  it('narrative order is total and uses the derived ord key', () => {
    expect(narrativeOrd(c(9, 46))).toBe(9_000_046);
    expect(compareNarrative(c(9, 46), c(9, 80))).toBe(-1);
    expect(compareNarrative(c(10, 0), c(9, 999_999))).toBe(1);
    expect(compareNarrative(c(9, 5), c(9, 5))).toBe(0);
    expect(() => narrativeOrd(c(1, 1_000_000))).toThrow(RangeError);
  });

  it('a flashback sorts by when it happened (chapter 0) even though it is narrated later', () => {
    const flashback = c(0, 300, { calendar: 'relative_days', world_date: 'D-3650' });
    const chapter4 = c(4, 10, { calendar: 'relative_days', world_date: 'D+20' });
    expect(compareNarrative(flashback, chapter4)).toBe(-1);
    expect(compareWorld(flashback, chapter4)).toEqual({ comparable: true, sign: 1, days: 3670 });
  });

  it('world order excludes unknown precision and different calendars', () => {
    const a = c(3, 1, { calendar: 'relative_days', world_date: 'D+1' });
    const unknown: StoryClock = { chapter_no: 3, ordinal: 2, precision: 'unknown' };
    expect(compareWorld(a, unknown)).toEqual({ comparable: false, reason: 'unknown_precision' });
    const era = c(3, 3, { calendar: 'era:reign', world_date: 'Y3 autumn' });
    expect(compareWorld(a, era)).toEqual({ comparable: false, reason: 'calendar_incomparable' });
    expect(compareNarrative(a, era)).toBe(-1); // narrative order still answers
  });

  it('overlapping approx windows are unordered, disjoint ones are ordered', () => {
    const a = c(5, 1, { precision: 'approx', world_date: 'D+10', uncertainty_days: 3 });
    const b = c(5, 2, { precision: 'approx', world_date: 'D+12', uncertainty_days: 3 });
    const far = c(6, 1, { precision: 'approx', world_date: 'D+30', uncertainty_days: 2 });
    expect(compareWorld(a, b)).toEqual({ comparable: false, reason: 'overlapping_uncertainty' });
    expect(compareWorld(a, far)).toMatchObject({ comparable: true, sign: 1 });
  });

  it('parses relative day-times and gregorian dates', () => {
    const morning = c(1, 1, { world_date: 'D+0T08:00' });
    const noon = c(1, 2, { world_date: 'D+0T12:00' });
    expect(compareWorld(morning, noon)).toMatchObject({ comparable: true, sign: 1 });
    const g1 = c(1, 1, { calendar: 'gregorian', world_date: '2031-03-12' });
    const g2 = c(1, 2, { calendar: 'gregorian', world_date: '2031-03-14' });
    expect(compareWorld(g1, g2)).toEqual({ comparable: true, sign: 1, days: 2 });
  });

  it('simultaneous clocks tie-break deterministically by id for rendering', () => {
    const items = [
      { id: '0191b2a0-0000-7000-8000-000000000002', clock: c(9, 40) },
      { id: '0191b2a0-0000-7000-8000-000000000001', clock: c(9, 40) },
      { id: '0191b2a0-0000-7000-8000-000000000003', clock: c(9, 39) },
    ];
    expect([...items].sort(compareForRendering).map((i) => i.id.slice(-1))).toEqual([
      '3',
      '1',
      '2',
    ]);
  });

  it('validity intervals are half-open in narrative order (injury ch.9 → healed ch.14)', () => {
    const from = c(9, 46);
    const to = c(14, 20);
    expect(withinValidity(c(11, 0), from, to)).toBe(true);
    expect(withinValidity(c(14, 20), from, to)).toBe(false);
    expect(withinValidity(c(9, 46), from, to)).toBe(true);
    expect(withinValidity(c(99, 0), from, null)).toBe(true);
  });
});
