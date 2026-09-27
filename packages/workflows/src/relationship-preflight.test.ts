import { describe, expect, it } from 'vitest';
import { type CanonDelta } from './acceptance.js';
import { relationshipOverlapErrors, type RelationshipInterval } from './relationship-preflight.js';

const clock = (chapter_no: number, ordinal = 1) => ({
  chapter_no,
  ordinal,
  precision: 'exact' as const,
});
const prior: RelationshipInterval = {
  id: 'old',
  timeline_id: 'main',
  from_entity_id: 'a',
  to_entity_id: 'b',
  type: 'acquaintance',
  valid_from: clock(1),
  valid_to: null,
};
function proposal(extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  return {
    local_id: 'new',
    type: 'relationship_state',
    op: 'assert',
    frame: 'canonical',
    story_clock: clock(2),
    ...extra,
    payload: {
      from_entity_id: 'a',
      to_entity_id: 'b',
      type: 'ally',
      valid_from: clock(2),
      ...payload,
    },
  };
}
const delta = (...items: unknown[]) => ({ items }) as CanonDelta;

describe('relationship extraction preflight', () => {
  it('rejects overlap across relationship types without rewriting either proposal or history', () => {
    const d = delta(proposal());
    const before = JSON.stringify({ d, prior });
    expect(relationshipOverlapErrors(d, [prior], 'main')).toMatchObject([
      {
        path: '/items/0',
        keyword: 'relationship_overlap',
      },
    ]);
    expect(relationshipOverlapErrors(d, [prior], 'main')[0]?.message).toContain('"id":"old"');
    expect(JSON.stringify({ d, prior })).toBe(before);
  });
  it('keeps direction and timeline distinct', () => {
    expect(
      relationshipOverlapErrors(
        delta(proposal({}, { from_entity_id: 'b', to_entity_id: 'a' })),
        [prior],
        'main',
      ),
    ).toEqual([]);
    expect(
      relationshipOverlapErrors(delta(proposal({}, { timeline_id: 'other' })), [prior], 'main'),
    ).toEqual([]);
  });
  it('uses half-open intervals and still detects overlap with closed historical states', () => {
    expect(
      relationshipOverlapErrors(delta(proposal()), [{ ...prior, valid_to: clock(2) }], 'main'),
    ).toEqual([]);
    expect(
      relationshipOverlapErrors(delta(proposal()), [{ ...prior, valid_to: clock(3) }], 'main'),
    ).toHaveLength(1);
  });
  it('accepts explicit supersession without mutating the historical input', () => {
    expect(
      relationshipOverlapErrors(
        delta(proposal({ op: 'supersede', supersedes_ref: 'old' })),
        [prior],
        'main',
      ),
    ).toEqual([]);
    expect(prior.valid_to).toBeNull();
  });
  it('honors close order and close time', () => {
    const close = proposal({ op: 'close', supersedes_ref: 'old' });
    expect(relationshipOverlapErrors(delta(close, proposal()), [prior], 'main')).toEqual([]);
    expect(relationshipOverlapErrors(delta(proposal(), close), [prior], 'main')).toHaveLength(1);
    expect(
      relationshipOverlapErrors(
        delta({ ...close, story_clock: clock(3) }, proposal()),
        [prior],
        'main',
      ),
    ).toHaveLength(1);
  });
  it('catches overlapping assertions within one proposal, even for a previously unknown pair', () => {
    expect(
      relationshipOverlapErrors(delta(proposal(), proposal({ local_id: 'duplicate' })), [], 'main'),
    ).toHaveLength(1);
  });
});
