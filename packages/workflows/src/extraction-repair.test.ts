/**
 * ADR-0102 (G17-2): G17a's extractor answer, reduced to its four drift shapes (the event summary is its own), yields each
 * item's own errors and the schema's shapes for the types it used.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatorFor } from '@yeonjae/domain';
import {
  erroredFields,
  extractionItemErrors,
  extractionRepairNote,
  fieldShapes,
  proposalShapes,
  restoreRegressedFields,
} from './extraction-repair.js';

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
    expect(proposalShapes(['relationship_state'])).toMatch(/"hostility\?":"integer -?\d+\.\.5"/u);
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

/**
 * ADR-0103 (G17-3): G17a's second repair fixed every item and wrote `hypothesis_results` as
 * `{hypothesis_id, status, note, evidence_quotes}`; the two answers before it had an empty list.
 */
describe('a field an extractor repair broke (ADR-0103)', () => {
  type Delta = Record<string, unknown> & { items: Record<string, unknown>[] };
  const validate = validatorFor('canon-delta.schema.json');
  const example = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../examples/fixture/canon-delta.ch09.json', import.meta.url)),
      'utf8',
    ),
  ) as Delta;
  const bareParticipants = (d: Delta): Delta => ({
    ...d,
    items: d.items.map((i) => {
      const payload = i.payload as { participants?: { entity_id: string }[] };
      return i.type === 'event' && payload.participants
        ? {
            ...i,
            payload: { ...payload, participants: payload.participants.map((p) => p.entity_id) },
          }
        : i;
    }),
  });
  const g17aShape = [
    {
      hypothesis_id: 'contract:ch09:MH-1',
      status: 'confirmed',
      note: 'as designed',
      evidence_quotes: [],
    },
  ];
  const errorsOf = (d: unknown) => {
    const r = validate(d);
    return r.ok ? [] : r.errors;
  };

  it('names the top-level fields of the errors, never the envelope the workflow fills', () => {
    expect(
      [
        ...erroredFields([
          { path: '/hypothesis_results/0', message: 'm', keyword: 'required' },
          { path: '/items/2/type', message: 'm', keyword: 'const' },
          { path: '/', message: 'm', keyword: 'required', missingProperty: 'summary_l1' },
          { path: '/project_id', message: 'm', keyword: 'format' },
          { path: '/', message: 'm', keyword: 'additionalProperties' },
        ]),
      ].sort(),
    ).toEqual(['hypothesis_results', 'items', 'summary_l1']);
  });

  it('takes back a field that validated before the repair and fails after it', () => {
    const previous: Delta = { ...bareParticipants(example), hypothesis_results: [] };
    const repaired: Delta = { ...example, hypothesis_results: g17aShape };
    const before = errorsOf(previous);
    const after = errorsOf(repaired);
    expect([...erroredFields(before)]).toEqual(['items']);
    expect([...erroredFields(after)]).toEqual(['hypothesis_results']);
    const { answer, restored } = restoreRegressedFields(previous, before, repaired, after);
    expect(restored).toEqual(['hypothesis_results']);
    expect(answer.hypothesis_results).toEqual([]);
    expect(answer.items).toBe(repaired.items);
    expect(validate(answer).ok).toBe(true);
  });

  it('treats the item list as one field, and restores nothing that was already broken', () => {
    const previous: Delta = { ...example, hypothesis_results: g17aShape };
    const repaired: Delta = bareParticipants(example);
    const back = restoreRegressedFields(previous, errorsOf(previous), repaired, errorsOf(repaired));
    expect(back.restored).toEqual(['items']);
    expect(back.answer.items).toBe(previous.items);
    expect(validate(back.answer).ok).toBe(true);
    const both: Delta = { ...bareParticipants(example), hypothesis_results: g17aShape };
    const none = restoreRegressedFields(both, errorsOf(both), repaired, errorsOf(repaired));
    expect(none.restored).toEqual([]);
    expect(none.answer).toBe(repaired);
  });

  it('leaves out a field the repaired answer added broken where the answer before had none', () => {
    const { hypothesis_results: _dropped, ...previous }: Delta = bareParticipants(example);
    const repaired: Delta = { ...example, hypothesis_results: g17aShape };
    const { answer, restored } = restoreRegressedFields(
      previous,
      errorsOf(previous),
      repaired,
      errorsOf(repaired),
    );
    expect(restored).toEqual(['hypothesis_results']);
    expect('hypothesis_results' in answer).toBe(false);
    expect(validate(answer).ok).toBe(true);
  });

  it('renders the shapes of the top-level fields named by errors', () => {
    const shapes = fieldShapes(['hypothesis_results', 'items', 'summary_l1']);
    expect(shapes.split('\n')).toHaveLength(2);
    expect(shapes).toContain(
      '- hypothesis_results: [{"hypothesis_ref!":"string","result!":"realized|partially_realized|unrealized"',
    );
    expect(shapes).toContain('- summary_l1: "string of at most 900 characters"');
    const note = extractionRepairNote(
      ['/hypothesis_results/0 must NOT have additional properties'],
      [],
      true,
      ['hypothesis_results'],
    );
    expect(note).toContain(
      '\n최상위 필드 형식:\n- hypothesis_results: [{"hypothesis_ref!":"string"',
    );
    expect(note).not.toContain('type별 payload 형식');
    expect(note).toContain('오류가 없는 필드는 그대로 둔다.');
  });
});
