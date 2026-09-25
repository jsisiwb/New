/**
 * ADR-0102 (live defect G17-2): the first live extraction of an accepted-quality chapter (G17a) failed the canon-delta
 * schema on four shapes: event participants as bare ids, a relationship type outside its enum, a promise event without
 * its kind, a fact whose value was folded into its attribute. The repair note names each item's own errors — its
 * payload validated against its own branch of the union, not every branch at once — and the payload shapes of the
 * types the answer used, rendered from the schemas.
 */
import { defValidatorFor, loadSchemas } from '@yeonjae/domain';

type Json = Record<string, unknown>;

interface Branch {
  readonly def: string;
  readonly ops?: readonly string[] | undefined;
}

let branchesCache: Map<string, Branch> | undefined;

/** The canon-delta union's branches: item type → payload proposal and the ops it allows. */
function branches(): Map<string, Branch> {
  if (branchesCache) return branchesCache;
  const delta = loadSchemas().schemas.get('canon-delta.schema.json')?.schema as Json | undefined;
  const item = ((delta?.$defs as Json | undefined)?.deltaItem ?? {}) as { allOf?: Json[] };
  const union = (item.allOf ?? []).find((p) => Array.isArray(p.oneOf))?.oneOf as Json[] | undefined;
  const out = new Map<string, Branch>();
  for (const b of union ?? []) {
    const props = (b.properties ?? {}) as Record<string, Json | undefined>;
    const type = props.type?.const;
    const ref = props.payload?.$ref;
    if (typeof type !== 'string' || typeof ref !== 'string') continue;
    const def = ref.split('#/$defs/')[1];
    if (!def) continue;
    const ops = props.op?.enum;
    out.set(type, { def, ...(Array.isArray(ops) ? { ops: ops.map(String) } : {}) });
  }
  branchesCache = out;
  return out;
}

/** Each item's own schema errors: its type, its op, and its payload against that type's proposal schema. */
export function extractionItemErrors(items: readonly unknown[]): string[] {
  const all = branches();
  const out: string[] = [];
  items.forEach((raw, i) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Json;
    const type = typeof item.type === 'string' ? item.type : undefined;
    const branch = type === undefined ? undefined : all.get(type);
    if (type === undefined || !branch) {
      out.push(
        `items[${String(i)}].type ${JSON.stringify(item.type)} is not one of ${[...all.keys()].join('|')}`,
      );
      return;
    }
    if (branch.ops && !branch.ops.includes(String(item.op)))
      out.push(`items[${String(i)}] (${type}).op must be ${branch.ops.join('|')}`);
    const r = defValidatorFor('canon-delta-payloads.schema.json', branch.def)(item.payload);
    if (!r.ok)
      for (const e of r.errors)
        out.push(
          `items[${String(i)}] (${type}).payload${e.path === '/' ? '' : e.path} ${e.message}${e.missingProperty ? ` (${e.missingProperty})` : ''}`,
        );
  });
  return [...new Set(out)];
}

/** A compact rendering of a schema: `!` marks a required field, `a|b` an enum. */
function render(schema: unknown, file: string, depth: number): unknown {
  if (!schema || typeof schema !== 'object') return 'any';
  const s = schema as Json;
  if (typeof s.$ref === 'string') {
    const [refFile, def] = s.$ref.split('#/$defs/');
    if (def === 'uuid') return 'uuid';
    if (depth > 3 || !def) return 'object';
    // A local ref (`#/$defs/x`) splits to an empty file name.
    const target = refFile !== undefined && refFile.length > 0 ? refFile : file;
    const defs = (loadSchemas().schemas.get(target)?.schema.$defs ?? {}) as Json;
    return render(defs[def], target, depth + 1);
  }
  if (Array.isArray(s.enum)) return s.enum.map(String).join('|');
  if (s.const !== undefined) return s.const;
  if (s.type === 'array') return [render(s.items, file, depth + 1)];
  if (s.type === 'object' || s.properties) {
    const required = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
    return Object.fromEntries(
      Object.entries((s.properties ?? {}) as Json).map(([k, v]) => [
        `${k}${required.has(k) ? '!' : '?'}`,
        render(v, file, depth + 1),
      ]),
    );
  }
  if (typeof s.pattern === 'string') return `string matching ${s.pattern}`;
  // G17a's repaired answer still wrote a relationship axis of 8 where the schema allows at most 5.
  if (typeof s.minimum === 'number' || typeof s.maximum === 'number')
    return `${typeof s.type === 'string' ? s.type : 'number'} ${typeof s.minimum === 'number' ? String(s.minimum) : ''}..${typeof s.maximum === 'number' ? String(s.maximum) : ''}`;
  return typeof s.type === 'string' ? s.type : 'any';
}

/** The payload shapes, rendered from the schemas, of the item types an answer used. */
export function proposalShapes(types: readonly string[]): string {
  const all = branches();
  const defs = (loadSchemas().schemas.get('canon-delta-payloads.schema.json')?.schema.$defs ??
    {}) as Json;
  return [...new Set(types)]
    .flatMap((t) => {
      const b = all.get(t);
      if (!b) return [];
      const shape = JSON.stringify(render(defs[b.def], 'canon-delta-payloads.schema.json', 0));
      return [`- ${t}${b.ops ? ` (op: ${b.ops.join('|')})` : ''}: ${shape}`];
    })
    .join('\n');
}

/** The repair instruction appended to the extractor's pre-pass: the errors, then the shapes. */
export function extractionRepairNote(
  errors: readonly string[],
  types: readonly string[],
  ko: boolean,
): string {
  const list = errors.slice(0, 30).join('\n');
  const shapes = proposalShapes(types);
  return ko
    ? `\n\n다시 쓰기: 직전 답의 items가 스키마와 맞지 않았다. 검증 오류:\n${list}\ntype별 payload 형식(!는 필수, a|b는 그중 하나):\n${shapes}\n같은 사건과 근거 인용을 그대로 두고 형식만 고쳐 답 전체를 다시 낸다.`
    : `\n\nRewrite: the previous answer's items did not validate. Errors:\n${list}\nPayload shapes by type (! required, a|b one of):\n${shapes}\nKeep the same events and evidence quotes; correct only the shapes and return the whole answer again.`;
}
