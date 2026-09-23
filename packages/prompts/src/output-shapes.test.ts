/**
 * ADR-0057: every active JSON prompt teaches a shape its schema accepts. The live-run fixes of ADR-0056
 * §11–12 were all prompts teaching shapes that disagreed with schemas (a string repetition_check, 0–100
 * dimension scores, invented issue kinds, a string repair); this suite makes that class of defect a CI
 * failure instead of a live-run discovery.
 */
import { describe, expect, it } from 'vitest';
import {
  OUTPUT_SHAPES,
  UNSCHEMATIZED_FAMILIES,
  allowedValuesAt,
  modelAnswerSchema,
  validateAnswerShape,
} from './output-shapes.js';
import { compareSemver, PromptRegistry, type PromptVersion } from './registry.js';
import { renderShape } from './shape-render.js';

const reg = PromptRegistry.fromDirectory();
const active = Object.values(reg.activeSet().mapping).map((id) => reg.get(id));
const SHAPE_LABEL = /^\[출력 스키마[^\n]*\]\n(\{[^\n]*\})$/m;

type Path = readonly (string | number)[];

function shapeExample(pv: PromptVersion): { label: string; example: unknown } | undefined {
  const m = SHAPE_LABEL.exec(`${pv.system_template}\n${pv.user_template}`);
  if (!m?.[1]) return undefined;
  return { label: m[0].split('\n')[0] ?? '', example: JSON.parse(m[1]) as unknown };
}

/** Every string value of the form "a|b|c" is a list of alternatives the prompt offers for one field. */
function alternatives(node: unknown, path: Path = []): { path: Path; options: string[] }[] {
  if (typeof node === 'string')
    return node.includes('|') && /^[a-z0-9_|]+$/.test(node)
      ? [{ path, options: node.split('|') }]
      : [];
  if (Array.isArray(node)) return node.flatMap((v, i) => alternatives(v, [...path, i]));
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([k, v]) => alternatives(v, [...path, k]));
  return [];
}

function withValue(node: unknown, path: Path, value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (Array.isArray(node))
    return (node as unknown[]).map((v, i) => (i === head ? withValue(v, rest, value) : v));
  const obj = node as Record<string, unknown>;
  return { ...obj, [head]: withValue(obj[head], rest, value) };
}

function firstAlternatives(example: unknown): unknown {
  let out = example;
  for (const a of alternatives(example)) out = withValue(out, a.path, a.options[0]);
  return out;
}

/** First path of a key anywhere in the example (note lines name fields by their key). */
function pathOfKey(node: unknown, key: string, path: Path = []): Path | undefined {
  const entries: [string | number, unknown][] = Array.isArray(node)
    ? node.map((v, i) => [i, v])
    : node && typeof node === 'object'
      ? Object.entries(node)
      : [];
  for (const [k, v] of entries) {
    if (k === key) return [...path, k];
    const p = pathOfKey(v, key, [...path, k]);
    if (p) return p;
  }
  return undefined;
}

describe('prompt output shapes follow their schemas (ADR-0057)', () => {
  it('every active JSON family is mapped to a schema or explicitly listed as unschematized', () => {
    for (const pv of active.filter((v) => v.output_mode === 'json')) {
      const mapped = pv.family in OUTPUT_SHAPES;
      expect(mapped !== UNSCHEMATIZED_FAMILIES.includes(pv.family), pv.id).toBe(true);
      if (mapped && OUTPUT_SHAPES[pv.family]?.def === undefined)
        expect(pv.output_schema, pv.id).toBe(OUTPUT_SHAPES[pv.family]?.schema);
    }
  });

  for (const pv of active.filter((v) => v.output_mode === 'json' && v.family in OUTPUT_SHAPES)) {
    describe(pv.id, () => {
      const found = shapeExample(pv);

      it('has one output-shape example that parses as JSON', () => {
        expect(found, `${pv.id} has no [출력 스키마 …] example line`).toBeDefined();
      });

      it('tells the model every field the workflow fills', () => {
        const text = `${pv.system_template}\n${pv.user_template}`;
        for (const path of OUTPUT_SHAPES[pv.family]?.workflowFilled ?? []) {
          const leaf = path.split('.').pop()?.replace('[]', '') ?? path;
          expect(text, `${pv.id} never names ${path}`).toContain(leaf);
        }
      });

      it('validates against the answer schema (first alternative of every "a|b" field)', () => {
        const r = validateAnswerShape(pv.family, firstAlternatives(found?.example));
        expect(r.ok ? [] : r.errors.map((e) => `${e.path} ${e.message}`), pv.id).toEqual([]);
      });

      it('offers only enum values the schema accepts, in the example and in its notes', () => {
        const base = firstAlternatives(found?.example);
        const bad: string[] = [];
        const check = (path: Path, option: string, where: string) => {
          const allowed = allowedValuesAt(pv.family, path);
          if (allowed && !allowed.has(option)) bad.push(`${where}: ${path.join('.')}=${option}`);
        };
        for (const a of alternatives(found?.example))
          for (const option of a.options) check(a.path, option, 'example');
        // Note lines such as "- kind: knowledge_leak(…), …" or "- drift_flags에는 …: translation_like(…)".
        const text = `${pv.system_template}\n${pv.user_template}`;
        for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
          const key = /^- ([a-z_]+)/.exec(line)?.[1];
          const path = key ? pathOfKey(base, key) : undefined;
          if (!path) continue;
          const at = path.reduce<unknown>(
            (n, p) => (n as Record<string | number, unknown> | undefined)?.[p],
            base,
          );
          for (const m of line.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\(/g))
            check(Array.isArray(at) ? [...path, 0] : path, m[1] ?? '', 'note');
        }
        expect(bad, pv.id).toEqual([]);
      });

      if (compareSemver(pv.version, '4.3.0') >= 0)
        it('is the renderer fixed point: generated from the schema, not hand-written', () => {
          const schema = modelAnswerSchema(pv.family);
          expect(schema).toBeDefined();
          const again = renderShape(schema ?? {}, found?.example);
          expect(again.example, pv.id).toEqual(found?.example);
          const text = `${pv.system_template}\n${pv.user_template}`;
          for (const note of again.notes) expect(text, pv.id).toContain(note);
          expect(found?.label, pv.id).toContain(
            (OUTPUT_SHAPES[pv.family]?.workflowFilled ?? []).join(', '),
          );
        });
    });
  }
});
