/**
 * ADR-0118: run 5's code-level changes are behind policy knobs, so every earlier pin runs the code paths it ran before.
 * Fixtures are synthetic tokens (ㄱ, ㄴ …), not prose.
 */
import { describe, expect, it } from 'vitest';
import { withFactClocks } from '@yeonjae/canon';
import { type Issue } from './evaluation.js';
import { clusterIssueSpans, type SpanIssue } from './multi-patch.js';
import { isLengthIssue, placeablePatchRound } from './revision.js';

/** The pre-run-5 implementation (packages/workflows/src/multi-patch.ts at 470aaba), verbatim. */
function legacyClusterIssueSpans<T extends SpanIssue>(
  issues: readonly T[],
  total: number,
  gap: number,
): { start: number; end: number; issues: T[] }[] {
  const spanned = issues
    .map((i) => ({ i, s: i.chapter_span?.start, e: i.chapter_span?.end }))
    .filter(
      (x): x is { i: T; s: number; e: number } =>
        x.s !== undefined && x.e !== undefined && x.s < x.e && x.s >= 0 && x.e <= total,
    )
    .sort((a, b) => a.s - b.s || a.e - b.e || (a.i.id < b.i.id ? -1 : 1));
  if (spanned.length === 0)
    return issues.length ? [{ start: 0, end: total, issues: [...issues] }] : [];
  const out: { start: number; end: number; issues: T[] }[] = [];
  for (const x of spanned) {
    const last = out[out.length - 1];
    if (last && x.s <= last.end + gap) {
      last.end = Math.max(last.end, x.e);
      last.issues.push(x.i);
    } else out.push({ start: x.s, end: x.e, issues: [x.i] });
  }
  return out;
}

/** A small deterministic generator, so the differential test is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const issue = (over: Partial<Issue> & Pick<Issue, 'id' | 'dimension' | 'kind'>): Issue => ({
  source: 'judge:structure',
  severity: 'major',
  status: 'open',
  claim: 'ㄱ',
  confidence: 0.9,
  ...over,
});

// Four paragraphs of synthetic tokens: p1 = ㄱㄱ (0–2), p2 = ㄴㄴ (4–6), p3 = ㄷㄷ (8–10), p4 = ㄹㄹ (12–14).
const TEXT = 'ㄱㄱ\n\nㄴㄴ\n\nㄷㄷ\n\nㄹㄹ';

describe('ADR-0118: pins without anchor_spanless cluster exactly as before run 5', () => {
  it('matches the pre-run-5 clustering on 2,000 random issue sets (no text given)', () => {
    const rnd = lcg(118);
    for (let n = 0; n < 2000; n++) {
      const total = 1 + Math.floor(rnd() * 400);
      const count = Math.floor(rnd() * 7);
      const issues: SpanIssue[] = [];
      for (let k = 0; k < count; k++) {
        const r = rnd();
        const start = Math.floor(rnd() * (total + 40)) - 20;
        const end = start + Math.floor(rnd() * 80) - 10;
        issues.push({
          id: `i${String(k)}${String(n % 3)}`,
          kind: rnd() < 0.2 ? 'length_out_of_range' : 'pacing_slow',
          dimension: rnd() < 0.2 ? 'length' : 'structure',
          claim: rnd() < 0.5 ? 'p1~p3 ㄱ' : 'ㄴ',
          chapter_span:
            r < 0.3
              ? undefined
              : r < 0.4
                ? null
                : r < 0.5
                  ? { paragraph_ids: ['p1'] }
                  : { start, end },
        });
      }
      const gap = Math.floor(rnd() * 60);
      expect(clusterIssueSpans(issues, total, gap)).toEqual(
        legacyClusterIssueSpans(issues, total, gap),
      );
    }
  });
});

describe('ADR-0118: the patch round anchor_spanless allows (placeablePatchRound)', () => {
  const length = issue({ id: 'len', dimension: 'length', kind: 'length_out_of_range' });
  const opening = issue({
    id: 'open',
    dimension: 'structure',
    kind: 'missing_required_event',
    claim: 'p1~p3 ㄱ',
  });

  it('never targets the chapter length, and places a paragraph-named finding (the G24r round)', () => {
    expect(isLengthIssue(length)).toBe(true);
    // Under the pre-run-5 tie-break `length` wins this pair; the patch round targets the opening finding instead.
    const round = placeablePatchRound({
      targets: [length, opening],
      scoreOnly: [],
      failing: undefined,
      allOpen: true,
      text: TEXT,
      gap: 0,
    });
    expect(round?.dimension).toBe('structure');
    expect(round?.targets.map((i) => i.id)).toEqual(['open']);
    const placed = clusterIssueSpans(round?.targets ?? [], 14, 0, TEXT);
    expect(placed.map((c) => [c.start, c.end])).toEqual([[0, 10]]);
  });

  it('allows no round when nothing can be placed', () => {
    const vague = issue({ id: 'vague', dimension: 'structure', kind: 'pacing_slow', claim: 'ㄴ' });
    for (const targets of [[length], [vague], [length, vague]])
      expect(
        placeablePatchRound({
          targets,
          scoreOnly: [],
          failing: undefined,
          allOpen: true,
          text: TEXT,
          gap: 0,
        }),
      ).toBeUndefined();
  });

  it('keeps a spanned finding and the score-only targets', () => {
    const spanned = issue({
      id: 'q',
      dimension: 'prose',
      kind: 'translation_like_english',
      chapter_span: { start: 4, end: 6 },
    });
    const weak = issue({
      id: 'w',
      dimension: 'voice',
      kind: 'voice_drift',
      severity: 'minor',
      chapter_span: { start: 12, end: 14 },
    });
    expect(
      placeablePatchRound({
        targets: [spanned, length],
        scoreOnly: [],
        failing: undefined,
        allOpen: false,
        text: TEXT,
        gap: 0,
      }),
    ).toEqual({ dimension: 'prose', targets: [spanned] });
    expect(
      placeablePatchRound({
        targets: [length],
        scoreOnly: [weak],
        failing: undefined,
        allOpen: false,
        text: TEXT,
        gap: 0,
      }),
    ).toEqual({ dimension: 'voice', targets: [] });
  });
});

describe('ADR-0118: the acceptance-time op normalization (839b3f8) changes only deltas acceptance refused', () => {
  it('returns every delta without a create op on an assert-only item as the same object', () => {
    const base = { base_canon_version: 3 };
    for (const items of [
      [{ type: 'event', op: 'assert', payload: {} }],
      [{ type: 'entity', op: 'create', payload: {} }],
      [{ type: 'proposition', op: 'create', payload: {} }],
      [],
    ]) {
      const delta = { ...base, items };
      expect(withFactClocks(delta)).toBe(delta);
    }
  });

  it('reads create as assert on the assert-only types, which verifyDelta rejects as ILLEGAL_OP', () => {
    const delta = {
      base_canon_version: 3,
      items: [
        { type: 'event', op: 'create', payload: {} },
        { type: 'entity', op: 'create', payload: {} },
      ],
    };
    const out = withFactClocks(delta) as { items: { op: string }[] };
    expect(out.items.map((i) => i.op)).toEqual(['assert', 'create']);
    expect(out.items[1]).toBe(delta.items[1]);
  });
});
