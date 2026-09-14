import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertValid, defValidatorFor, loadSchemas, validatorFor } from './schemas.js';
import { type CanonDelta } from './generated/canon-delta.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string): unknown => JSON.parse(readFileSync(`${root}${rel}`, 'utf8'));

describe('schema loading and runtime validation', () => {
  it('loads every schema with the expected $id and resolves cross-file refs', () => {
    const { schemas } = loadSchemas();
    const files = readdirSync(`${root}schemas`).filter((f) => f.endsWith('.schema.json'));
    expect(schemas.size).toBe(files.length);
    // A cross-file $ref (common.schema.json#/$defs/storyClock) must compile without error.
    expect(() => validatorFor('fact.schema.json')).not.toThrow();
  });

  it('validates fixture examples exactly like the Python validator does', () => {
    const cases: [string, string][] = [
      ['examples/fixture/story-intake.json', 'story-intake.schema.json'],
      ['examples/fixture/chapter-contract.ch12.json', 'chapter-contract.schema.json'],
      ['examples/fixture/canon-delta.ch09.json', 'canon-delta.schema.json'],
      ['examples/fixture/register-profile.seoha.json', 'register-profile.schema.json'],
      ['examples/narrative-profiles/lang-en.v1.json', 'narrative-identity.schema.json'],
      [
        'examples/narrative-profiles/genre-romance-fantasy.v1.json',
        'narrative-identity.schema.json',
      ],
      ['examples/production-policies/standard.v1.json', 'production-policy.schema.json'],
    ];
    for (const [file, schema] of cases) {
      const r = validatorFor(schema)(read(file));
      expect(r.ok, `${file}: ${JSON.stringify(!r.ok && r.errors)}`).toBe(true);
    }
  });

  it('enforces the canon-delta discriminated union (payload shape per type)', () => {
    const delta = assertValid<CanonDelta>(
      'canon-delta.schema.json',
      read('examples/fixture/canon-delta.ch09.json'),
    );
    const validate = validatorFor('canon-delta.schema.json');
    const broken = structuredClone(delta);
    const first = broken.items[0];
    if (!first) throw new Error('fixture has no items');
    // A fact payload on an item typed `event` must fail.
    (first as { type: string }).type = first.type === 'event' ? 'fact' : 'event';
    expect(validate(broken).ok).toBe(false);
    // A supersede without supersedes_ref must fail.
    const noRef = structuredClone(delta);
    const sup = noRef.items.find((i) => i.op === 'supersede');
    if (!sup) throw new Error('fixture has no supersede item');
    delete (sup as { supersedes_ref?: string }).supersedes_ref;
    expect(validate(noRef).ok).toBe(false);
  });

  it('exposes $defs validators (storyClock, realityFrame, manuscriptStatus)', () => {
    const clock = defValidatorFor('common.schema.json', 'storyClock');
    expect(clock({ chapter_no: 9, ordinal: 46, precision: 'exact' }).ok).toBe(true);
    expect(clock({ chapter_no: 9, ordinal: 1_000_000, precision: 'exact' }).ok).toBe(false);
    expect(clock({ chapter_no: 9, precision: 'exact' }).ok).toBe(false);
    const status = defValidatorFor('common.schema.json', 'manuscriptStatus');
    expect(status('approved').ok).toBe(true);
    expect(status('draft').ok).toBe(false);
    const frame = defValidatorFor('fact.schema.json', 'factFrame');
    expect(frame('source_story').ok).toBe(true);
    expect(frame('dream').ok).toBe(false);
  });

  it('reports useful error paths', () => {
    const r = validatorFor('story-intake.schema.json')({ title_working: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.keyword === 'required')).toBe(true);
    expect(() => assertValid('story-intake.schema.json', {})).toThrow(/failed schema validation/);
  });
});
