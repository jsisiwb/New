/**
 * ADR-0102 (live defect G17-2): the first live extraction of an accepted-quality chapter (G17a) failed the canon-delta
 * schema on four shapes: event participants as bare ids, a relationship type outside its enum, a promise event without
 * its kind, a fact whose value was folded into its attribute. The repair note names each item's own errors — its
 * payload validated against its own branch of the union, not every branch at once — and the payload shapes of the
 * types the answer used, rendered from the schemas.
 *
 * ADR-0103 (G17-3): G17a's second repair fixed every item and wrote `hypothesis_results` in a shape of its own, where the
 * two answers before it had an empty list. A field that validated in the answer a repair was asked to correct and fails
 * in the repaired answer is taken back from that answer, and the note renders the shapes of the top-level fields named
 * by errors as well.
 */
import { defValidatorFor, loadSchemas, type ValidationFailure } from '@yeonjae/domain';

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
  if (typeof s.maxLength === 'number') return `string of at most ${String(s.maxLength)} characters`;
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

/** The fields the workflow fills around the extractor's answer; errors in them are never the answer's. */
const ENVELOPE_FIELDS = new Set([
  'project_id',
  'chapter_id',
  'manuscript_version_id',
  'base_canon_version',
  'stage',
  'extractor_call_id',
]);

/** The answer's top-level fields that a set of errors names; a missing required field names itself. */
export function erroredFields(errors: readonly ValidationFailure[]): Set<string> {
  const out = new Set<string>();
  for (const e of errors) {
    const field = e.path === '/' ? e.missingProperty : e.path.split('/')[1];
    if (field !== undefined && field !== '' && !ENVELOPE_FIELDS.has(field)) out.add(field);
  }
  return out;
}

/**
 * A repair may not break what already validated: each top-level field that fails in the repaired answer and had no
 * error in the answer it repaired is taken from that answer (absent there, it is left out). `items` is one field.
 */
export function restoreRegressedFields<T extends object>(
  previous: T,
  previousErrors: readonly ValidationFailure[],
  repaired: T,
  repairedErrors: readonly ValidationFailure[],
): { answer: T; restored: string[] } {
  const before = erroredFields(previousErrors);
  const restored = [...erroredFields(repairedErrors)].filter((f) => !before.has(f));
  if (restored.length === 0) return { answer: repaired, restored };
  const from = previous as Json;
  const answer = Object.fromEntries(
    Object.entries(repaired as Json).filter(([k]) => !restored.includes(k)),
  );
  for (const f of restored) if (Object.hasOwn(from, f)) answer[f] = from[f];
  return { answer: answer as T, restored };
}

/** The shapes of the answer's top-level fields, rendered from the schema (`items` has its shapes by type). */
export function fieldShapes(fields: readonly string[]): string {
  const delta = loadSchemas().schemas.get('canon-delta.schema.json')?.schema as Json | undefined;
  const props = (delta?.properties ?? {}) as Json;
  return [...new Set(fields)]
    .filter((f) => f !== 'items' && props[f] !== undefined)
    .map((f) => `- ${f}: ${JSON.stringify(render(props[f], 'canon-delta.schema.json', 0))}`)
    .join('\n');
}

/** The repair instruction appended to the extractor's pre-pass: the errors, then the shapes. */
export function extractionRepairNote(
  errors: readonly string[],
  types: readonly string[],
  ko: boolean,
  fields: readonly string[] = [],
): string {
  const list = errors.slice(0, 30).join('\n');
  const shapes = proposalShapes(types);
  const top = fieldShapes(fields);
  return ko
    ? `\n\n다시 쓰기: 직전 답이 스키마와 맞지 않았다. 검증 오류:\n${list}${shapes ? `\ntype별 payload 형식(!는 필수, a|b는 그중 하나):\n${shapes}` : ''}${top ? `\n최상위 필드 형식:\n${top}` : ''}\n같은 사건과 근거 인용을 그대로 두고 형식만 고쳐 답 전체를 다시 낸다. 오류가 없는 필드는 그대로 둔다.`
    : `\n\nRewrite: the previous answer did not validate. Errors:\n${list}${shapes ? `\nPayload shapes by type (! required, a|b one of):\n${shapes}` : ''}${top ? `\nTop-level field shapes:\n${top}` : ''}\nKeep the same events and evidence quotes; correct only the shapes, leave every field without errors as it was, and return the whole answer again.`;
}
