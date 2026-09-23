/**
 * Output-shape examples generated from the answer schema (ADR-0057). The renderer walks the schema and a
 * base example together: every required field appears, enum fields list only schema values (a base may
 * narrow them to a role-specific subset, written "a|b"), numbers stay inside the schema's range, and the
 * Korean placeholder text of the base is kept as guidance. Shape notes (ranges, long enums, per-type payload
 * fields) are derived from the same schema, so no hand-written note can disagree with it.
 *
 * A generated example is a fixed point: rendering it again returns it unchanged. CI checks that property
 * for every generated prompt version.
 */
type Json = Record<string, unknown>;

export interface RenderedShape {
  readonly example: unknown;
  readonly notes: readonly string[];
}

const MAX_INLINE_ENUM = 12;
// Placeholders tried, in order, for a string field whose schema pattern rejects "...".
const PATTERN_PLACEHOLDERS = ['status', 'location', 'p1', 'x1', 'a'];

export function renderShape(schema: Json, base: unknown): RenderedShape {
  const notes: string[] = [];
  const example = render(schema, base, [], notes);
  return { example, notes: [...new Set(notes)] };
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function firstOption(v: unknown): unknown {
  return typeof v === 'string' && /^[a-z0-9_]+(\|[a-z0-9_]+)+$/.test(v) ? v.split('|')[0] : v;
}

/** Merge allOf members and pick the oneOf/anyOf branch the base discriminates (or the first). */
function resolve(node: Json, base: unknown, notes: string[], path: readonly string[]): Json {
  let out: Json = { ...node };
  delete out.allOf;
  delete out.oneOf;
  delete out.anyOf;
  delete out.if;
  delete out.then;
  delete out.else;
  const merge = (member: Json) => {
    const m = resolve(member, base, notes, path);
    const mine = (out.properties as Json | undefined) ?? {};
    const theirs = (m.properties as Json | undefined) ?? {};
    const properties: Json = { ...theirs };
    // The same property declared by several members must satisfy all of them.
    for (const [k, v] of Object.entries(mine))
      properties[k] = k in theirs ? { allOf: [theirs[k], v] } : v;
    out = {
      ...m,
      ...out,
      properties,
      required: [
        ...new Set([
          ...((m.required as string[] | undefined) ?? []),
          ...((out.required as string[] | undefined) ?? []),
        ]),
      ],
    };
  };
  for (const member of (node.allOf as Json[] | undefined) ?? []) merge(member);
  const union = (node.oneOf ?? node.anyOf) as Json[] | undefined;
  if (union?.length) {
    const disc = discriminator(union);
    let pick: Json = union[0] ?? {};
    if (disc && isObj(base)) {
      const want = firstOption(base[disc]);
      pick = union.find((b) => constOf(b, disc) === want) ?? pick;
      const other = Object.keys((pick.properties as Json | undefined) ?? {}).find(
        (k) => k !== disc,
      );
      if (other) {
        const parts = union.map(
          (b) =>
            `${String(constOf(b, disc))}: ${requiredOf((b.properties as Json)[other]).join(', ') || '—'}`,
        );
        notes.push(
          `- ${[...path, other].join('.')}의 필수 필드는 ${disc}마다 다르다 — ${parts.join('; ')}`,
        );
      }
    }
    merge(pick);
  }
  return out;
}

function discriminator(union: readonly Json[]): string | undefined {
  const first = union[0]?.properties as Json | undefined;
  if (!first) return undefined;
  return Object.keys(first).find((k) => union.every((b) => constOf(b, k) !== undefined));
}

function constOf(branch: Json, key: string): unknown {
  const p = (branch.properties as Json | undefined)?.[key];
  return isObj(p) ? p.const : undefined;
}

function requiredOf(node: unknown): string[] {
  if (!isObj(node)) return [];
  const own = (node.required as string[] | undefined) ?? [];
  const nested = ((node.allOf as Json[] | undefined) ?? []).flatMap(requiredOf);
  return [...new Set([...own, ...nested])];
}

function typeOf(node: Json): string | undefined {
  const t = node.type;
  if (Array.isArray(t)) return (t as string[]).find((x) => x !== 'null');
  if (typeof t === 'string') return t;
  if (node.properties || node.additionalProperties) return 'object';
  if (node.items) return 'array';
  return undefined;
}

function render(node: Json, base: unknown, path: readonly string[], notes: string[]): unknown {
  const n = resolve(node, base, notes, path);
  if ('const' in n) return n.const;
  if (Array.isArray(n.enum)) return renderEnum(n.enum as unknown[], base, path, notes);
  const type = typeOf(n);
  if (type === 'object') return renderObject(n, base, path, notes);
  if (type === 'array') {
    const items = isObj(n.items) ? n.items : {};
    const b = Array.isArray(base) ? base : [];
    if (b.length === 0 && ((n.minItems as number | undefined) ?? 0) === 0 && Array.isArray(base))
      return [];
    const itemPath = path.length ? [...path.slice(0, -1), `${path[path.length - 1]}[]`] : ['[]'];
    return [render(items, b[0], itemPath, notes)];
  }
  if (type === 'string') return renderString(n, base);
  if (type === 'boolean') return typeof base === 'boolean' ? base : true;
  if (type === 'integer' || type === 'number') return renderNumber(n, base, path, notes);
  return base ?? '...';
}

function renderEnum(values: unknown[], base: unknown, path: readonly string[], notes: string[]) {
  if (typeof base === 'string') {
    const options = base.split('|');
    if (options.every((o) => values.includes(o))) return base;
  }
  if (values.includes(base)) return base;
  if (values.length <= MAX_INLINE_ENUM && values.every((v) => typeof v === 'string'))
    return values.join('|');
  notes.push(`- ${path.join('.')}: 다음 값 가운데 하나 — ${values.map(String).join(', ')}`);
  return values[0];
}

function renderString(n: Json, base: unknown): string {
  if (typeof base === 'string') return base;
  if (typeof n.pattern !== 'string') return '...';
  const re = new RegExp(n.pattern, 'u');
  return PATTERN_PLACEHOLDERS.find((p) => re.test(p)) ?? '...';
}

function renderNumber(n: Json, base: unknown, path: readonly string[], notes: string[]) {
  const min = n.minimum as number | undefined;
  const max = n.maximum as number | undefined;
  if (min !== undefined && max !== undefined) notes.push(`- ${path.join('.')}: ${min}~${max}`);
  const ok =
    typeof base === 'number' &&
    (min === undefined || base >= min) &&
    (max === undefined || base <= max);
  if (ok) return base;
  return min ?? 0;
}

function renderObject(n: Json, base: unknown, path: readonly string[], notes: string[]) {
  const props = (n.properties as Record<string, Json> | undefined) ?? {};
  const extra = isObj(n.additionalProperties) ? n.additionalProperties : undefined;
  const required = (n.required as string[] | undefined) ?? [];
  const b = isObj(base) ? base : {};
  const out: Json = {};
  for (const [k, v] of Object.entries(b)) {
    const child = props[k] ?? extra;
    if (child) out[k] = render(child, v, [...path, k], notes);
  }
  for (const k of required)
    if (!(k in out) && props[k]) out[k] = render(props[k], undefined, [...path, k], notes);
  if (Object.keys(out).length === 0 && extra && Object.keys(props).length === 0)
    out.key = render(extra, undefined, [...path, 'key'], notes);
  return out;
}
