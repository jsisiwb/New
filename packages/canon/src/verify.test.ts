import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toNfcText } from '@yeonjae/prose';
import { verifyDelta } from './verify.js';
import { withFactClocks } from './accept.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const text = toNfcText(
  readFileSync(`${ROOT}examples/fixture/manuscripts/ch09.accepted.txt`, 'utf8'),
);
const delta = JSON.parse(readFileSync(`${ROOT}examples/fixture/canon-delta.ch09.json`, 'utf8')) as {
  items: Record<string, unknown>[];
  manuscript_version_id: string;
};
const MAIN = '0191b2a0-0000-7000-8000-000000050001';
const PRIOR = '0191b2a0-0000-7000-8000-000000050002';
const ctx = {
  source: 'chapter_acceptance' as const,
  manuscripts: new Map([[delta.manuscript_version_id, text]]),
  manuscriptStatus: new Map([[delta.manuscript_version_id, 'approved']]),
  timelines: new Map<string, 'main' | 'prior_loop'>([
    [MAIN, 'main'],
    [PRIOR, 'prior_loop'],
  ]),
  mainTimelineId: MAIN,
  clockMax: { chapter_no: 9, ordinal: 999, precision: 'exact' as const },
};

describe('deterministic delta verification', () => {
  it('accepts the fixture ch.9 delta against its manuscript', () => {
    expect(verifyDelta(delta, ctx)).toEqual({ ok: true, issues: [] });
  });

  it('rejects schema violations before anything else', () => {
    const r = verifyDelta({ ...delta, items: [{ local_id: 'x' }] }, ctx);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.code).toBe('SCHEMA_INVALID');
  });

  it('dates an asserted fact without valid_from at its item’s clock, and rejects one with neither (ADR-0105)', () => {
    const fact = delta.items.find((i) => i.type === 'fact' && i.op === 'assert');
    if (!fact) throw new Error('fixture has no asserted fact');
    const { valid_from: _vf, ...payload } = fact.payload as Record<string, unknown>;
    const clock = { chapter_no: 9, ordinal: 50, precision: 'exact' };
    const undated = { ...delta, items: [{ ...fact, story_clock: clock, payload }] };
    const filled = withFactClocks(undated) as typeof delta;
    expect((filled.items[0]?.payload as { valid_from?: unknown }).valid_from).toEqual(clock);
    expect(verifyDelta(filled, ctx)).toEqual({ ok: true, issues: [] });
    // Nothing to fill: the same object back.
    expect(withFactClocks(delta)).toBe(delta);
    const { story_clock: _sc, ...clockless } = { ...fact, payload };
    const neither = withFactClocks({ ...delta, items: [clockless] });
    expect(verifyDelta(neither, ctx).issues).toEqual([
      expect.objectContaining({ code: 'SCHEMA_INVALID', item: fact.local_id }),
    ]);
  });

  it('rejects a paraphrased quote and an off-by-one span with item-level detail', () => {
    const bad = structuredClone(delta);
    const ev = (bad.items[0] as { evidence: { quote: string; start: number; end: number }[] })
      .evidence[0];
    if (!ev) throw new Error('no evidence');
    ev.quote = ev.quote.replace('Black', 'Dark ');
    const r = verifyDelta(bad, ctx);
    expect(r.issues.map((i) => i.code)).toContain('EVIDENCE_MISMATCH');
    expect(r.issues[0]?.item).toBe('ev-1');
  });

  it('rejects retract in a chapter-acceptance delta, allows it for a correction', () => {
    // items[2] is the fixture's location supersede (has supersedes_ref, which retract also requires)
    const base = delta.items.find((i) => i.op === 'supersede' && i.type === 'fact');
    if (!base) throw new Error('fixture has no fact supersede');
    const item = { ...base, op: 'retract', local_id: 'r' };
    const bad = { ...delta, items: [item] };
    expect(verifyDelta(bad, ctx).issues.map((i) => i.code)).toContain('ILLEGAL_OP');
    expect(
      verifyDelta(bad, { ...ctx, source: 'user_correction' }).issues.map((i) => i.code),
    ).not.toContain('ILLEGAL_OP');
  });

  it('rejects future validity (planned ≠ happened) and frame × timeline violations', () => {
    const f = structuredClone(delta.items[1]) as {
      payload: Record<string, unknown>;
      frame: string;
      local_id: string;
    };
    f.local_id = 'future';
    f.payload.valid_from = { chapter_no: 13, ordinal: 0, precision: 'exact' };
    expect(verifyDelta({ ...delta, items: [f] }, ctx).issues.map((i) => i.code)).toContain(
      'FUTURE_VALIDITY',
    );
    const g = structuredClone(delta.items[1]) as {
      payload: Record<string, unknown>;
      frame: string;
      local_id: string;
    };
    g.local_id = 'wrongframe';
    g.frame = 'prior_loop';
    g.payload.timeline_id = MAIN;
    expect(verifyDelta({ ...delta, items: [g] }, ctx).issues.map((i) => i.code)).toContain(
      'FRAME_VIOLATION',
    );
    g.payload.timeline_id = PRIOR;
    expect(
      verifyDelta({ ...delta, items: [g] }, ctx).issues.filter((i) => i.code === 'FRAME_VIOLATION'),
    ).toEqual([]);
  });

  it('refuses evidence into a working version and flags unverifiable manuscripts', () => {
    const working = verifyDelta(delta, {
      ...ctx,
      manuscriptStatus: new Map([[delta.manuscript_version_id, 'working']]),
    });
    expect(working.issues.every((i) => i.code === 'EVIDENCE_MISMATCH')).toBe(true);
    const missing = verifyDelta(delta, { ...ctx, manuscripts: new Map() });
    expect(missing.issues[0]?.code).toBe('EVIDENCE_UNVERIFIABLE');
  });
});
