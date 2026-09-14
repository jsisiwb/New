/**
 * StoryClock ordering (ADR-0040). Narrative order (chapter_no, ordinal) is total within a timeline and is the
 * authoritative sort key; world order (calendar + world_date) is partial and only answers duration questions.
 */
export type ClockPrecision = 'exact' | 'approx' | 'unknown';

export interface StoryClock {
  readonly chapter_no: number;
  readonly ordinal: number;
  readonly precision: ClockPrecision;
  readonly calendar?: string | undefined;
  readonly world_date?: string | undefined;
  readonly uncertainty_days?: number | undefined;
}

export const ORDINAL_SPAN = 1_000_000;

/** Derived narrative ordering key (bigint-safe as a JS number up to chapter 9,007,199). */
export function narrativeOrd(c: StoryClock): number {
  if (!Number.isInteger(c.chapter_no) || c.chapter_no < 0)
    throw new RangeError('chapter_no must be a non-negative integer');
  if (!Number.isInteger(c.ordinal) || c.ordinal < 0 || c.ordinal >= ORDINAL_SPAN) {
    throw new RangeError(`ordinal must be an integer in [0, ${ORDINAL_SPAN})`);
  }
  return c.chapter_no * ORDINAL_SPAN + c.ordinal;
}

/** Total order within one timeline: negative, zero (simultaneous), positive. */
export function compareNarrative(a: StoryClock, b: StoryClock): number {
  return Math.sign(narrativeOrd(a) - narrativeOrd(b));
}

export type WorldComparison =
  | { comparable: true; sign: -1 | 0 | 1; days: number }
  | {
      comparable: false;
      reason:
        'unknown_precision' | 'calendar_incomparable' | 'unparseable' | 'overlapping_uncertainty';
    };

const RELATIVE = /^D([+-])(\d+)(?:T(\d{1,2}):(\d{2}))?$/;

/** Parse a world_date into a day number within its calendar; undefined when unparseable. */
export function worldDays(c: StoryClock): number | undefined {
  if (c.world_date === undefined) return undefined;
  const cal = c.calendar ?? 'relative_days';
  if (cal === 'relative_days') {
    const m = RELATIVE.exec(c.world_date);
    if (!m) return undefined;
    const sign = m[1] === '-' ? -1 : 1;
    const days = Number(m[2]);
    const hours = m[3] !== undefined ? Number(m[3]) : 0;
    const minutes = m[4] !== undefined ? Number(m[4]) : 0;
    return sign * (days + (hours * 60 + minutes) / 1440);
  }
  if (cal === 'gregorian') {
    const t = Date.parse(c.world_date);
    return Number.isNaN(t) ? undefined : t / 86_400_000;
  }
  return undefined; // era calendars need a project conversion anchor (Beta)
}

/** Partial world order: only within one calendar, never with unknown precision. */
export function compareWorld(a: StoryClock, b: StoryClock): WorldComparison {
  if (a.precision === 'unknown' || b.precision === 'unknown') {
    return { comparable: false, reason: 'unknown_precision' };
  }
  const calA = a.calendar ?? 'relative_days';
  const calB = b.calendar ?? 'relative_days';
  if (calA !== calB) return { comparable: false, reason: 'calendar_incomparable' };
  const da = worldDays(a);
  const db = worldDays(b);
  if (da === undefined || db === undefined) return { comparable: false, reason: 'unparseable' };
  const diff = db - da;
  const ua = a.precision === 'approx' ? (a.uncertainty_days ?? 0) : 0;
  const ub = b.precision === 'approx' ? (b.uncertainty_days ?? 0) : 0;
  if (Math.abs(diff) <= ua + ub && (ua > 0 || ub > 0)) {
    return { comparable: false, reason: 'overlapping_uncertainty' };
  }
  return { comparable: true, sign: Math.sign(diff) as -1 | 0 | 1, days: diff };
}

/** Elapsed days from a to b when the world order can answer; otherwise the reason it cannot. */
export function elapsedDays(a: StoryClock, b: StoryClock): WorldComparison {
  return compareWorld(a, b);
}

/** Deterministic total order for rendering: narrative order, then id (UUIDv7 = creation order). */
export function compareForRendering<T extends { clock: StoryClock; id: string }>(
  a: T,
  b: T,
): number {
  const n = compareNarrative(a.clock, b.clock);
  return n !== 0 ? n : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Is `clock` within [from, to) in narrative order? `to === null` means still open. */
export function withinValidity(
  clock: StoryClock,
  from: StoryClock,
  to: StoryClock | null,
): boolean {
  const c = narrativeOrd(clock);
  return c >= narrativeOrd(from) && (to === null || c < narrativeOrd(to));
}
