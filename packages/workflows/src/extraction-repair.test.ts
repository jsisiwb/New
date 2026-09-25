/**
 * ADR-0102 (G17-2): G17a's extractor answer, reduced to its four drift shapes (the event summary is its own), yields each
 * item's own errors and the schema's shapes for the types it used.
 */
import { describe, expect, it } from 'vitest';
import { extractionItemErrors, extractionRepairNote, proposalShapes } from './extraction-repair.js';

const hero = '018f0000-0000-7000-8000-000000000001';
const rival = '018f0000-0000-7000-8000-000000000002';
const promise = '018f0000-0000-7000-8000-000000000003';
const items = [
  {
    op: 'assert',
    type: 'event',
    payload: {
      type: 'action',
      summary: '시온이 마력 측정기에 손을 대어 기계를 폭발시킨다.',
      participants: [hero],
    },
  },
  {
    op: 'assert',
    type: 'relationship_state',
    payload: {
      type: 'hostility',
      from_entity_id: rival,
      to_entity_id: hero,
      valid_from: { chapter_no: 1, ordinal: 2, precision: 'exact' },
    },
  },
  { op: 'assert', type: 'promise_event', payload: { kind: 'foreshadowing', promise_id: promise } },
  {
    op: 'assert',
    type: 'fact',
    payload: { entity_id: hero, attribute: 'status: official_mana_measurement = 0, class = F' },
  },
];

describe('the extractor repair note (ADR-0102)', () => {
  it('names each item’s own errors, not every branch of the union', () => {
    const errors = extractionItemErrors(items);
    expect(errors).toEqual(
      expect.arrayContaining([
        'items[0] (event).payload/participants/0 must be object',
        'items[1] (relationship_state).payload/type must be equal to one of the allowed values',
        'items[2] (promise_event).op must be open|advance|pay',
        'items[2] (promise_event).payload/kind must be equal to one of the allowed values',
        expect.stringMatching(/^items\[3\] \(fact\)\.payload\/attribute must match pattern/u),
      ]),
    );
    expect(errors.join('\n')).not.toMatch(/knower|proposition_id/u);
    expect(extractionItemErrors([{ type: 'feeling', payload: {} }])[0]).toMatch(
      /^items\[0\]\.type "feeling" is not one of fact\|event\|/u,
    );
  });

  it('renders the shapes of the types used from the schemas', () => {
    const shapes = proposalShapes(['event', 'promise_event', 'event']);
    expect(shapes.split('\n')).toHaveLength(2);
    expect(shapes).toContain(
      '"participants!":[{"entity_id!":"uuid","role!":"agent|patient|witness|speaker|hearer|mentioned"}]',
    );
    expect(shapes).toContain(
      '- promise_event (op: open|advance|pay): {"promise_id!":"uuid","kind!":"opened|advanced|paid"',
    );
    const note = extractionRepairNote(
      ['items[0] (event).payload/participants/0 must be object'],
      ['event'],
      true,
    );
    expect(note).toMatch(/^\n\n다시 쓰기: /u);
    expect(note).toContain('같은 사건과 근거 인용을 그대로 두고');
  });
});
