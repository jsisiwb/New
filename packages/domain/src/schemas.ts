/**
 * Runtime schema access. The JSON Schemas in schemas/ are the contract (AGENTS.md rule 3); this module loads
 * them once, registers them in one Ajv instance so cross-file `$ref`s resolve, and exposes typed validators.
 */
import ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

// ajv and ajv-formats are CommonJS; under NodeNext their default export is the module namespace object,
// whose `.default` is the class/function. Resolve both shapes so tsx (ESM) and node (dist) agree.
type Ajv2020Ctor = typeof ajv2020.Ajv2020;
type Ajv2020 = InstanceType<Ajv2020Ctor>;
const Ajv2020Class: Ajv2020Ctor =
  (ajv2020 as unknown as { default?: Ajv2020Ctor }).default ?? (ajv2020 as unknown as Ajv2020Ctor);
type AddFormats = (ajv: Ajv2020) => Ajv2020;
const addFormats: AddFormats =
  (ajvFormats as unknown as { default?: AddFormats }).default ??
  (ajvFormats as unknown as AddFormats);
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_BASE_URI = 'https://yeonjae.studio/schemas/';

function schemasDir(): string {
  // packages/domain/src → repo root → schemas (works from src via tsx and from dist via node)
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'schemas');
}

export interface LoadedSchema {
  readonly name: string;
  readonly id: string;
  readonly schema: Record<string, unknown>;
}

let cache: { ajv: Ajv2020; schemas: Map<string, LoadedSchema> } | undefined;

export function loadSchemas(): { ajv: Ajv2020; schemas: Map<string, LoadedSchema> } {
  if (cache) return cache;
  const ajv = new Ajv2020Class({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);
  const schemas = new Map<string, LoadedSchema>();
  const dir = schemasDir();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()) {
    const schema = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
    const id = String(schema.$id);
    if (id !== SCHEMA_BASE_URI + file) {
      throw new Error(`schema ${file} has unexpected $id ${id}`);
    }
    ajv.addSchema(schema, id);
    schemas.set(file, { name: file, id, schema });
  }
  cache = { ajv, schemas };
  return cache;
}

export interface ValidationFailure {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
  /** For `required` failures: the missing property name. */
  readonly missingProperty?: string | undefined;
}

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: readonly ValidationFailure[] };

function formatErrors(errors: ErrorObject[] | null | undefined): ValidationFailure[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message ?? 'invalid',
    keyword: e.keyword,
    ...(e.keyword === 'required' &&
    typeof (e.params as { missingProperty?: unknown }).missingProperty === 'string'
      ? { missingProperty: (e.params as { missingProperty: string }).missingProperty }
      : {}),
  }));
}

/** Build a validator for a top-level schema file, e.g. `validatorFor('story-intake.schema.json')`. */
export function validatorFor<T = unknown>(
  schemaFile: string,
): (input: unknown) => ValidationResult<T> {
  const { ajv } = loadSchemas();
  const fn = ajv.getSchema(SCHEMA_BASE_URI + schemaFile) as ValidateFunction<T> | undefined;
  if (!fn) throw new Error(`unknown schema ${schemaFile}`);
  return (input: unknown): ValidationResult<T> => {
    if (fn(input)) return { ok: true, value: input };
    return { ok: false, errors: formatErrors(fn.errors) };
  };
}

/** Validate against a `$defs` entry of a schema file, e.g. `defValidatorFor('common.schema.json', 'storyClock')`. */
export function defValidatorFor<T = unknown>(
  schemaFile: string,
  def: string,
): (input: unknown) => ValidationResult<T> {
  const { ajv } = loadSchemas();
  const ref = `${SCHEMA_BASE_URI}${schemaFile}#/$defs/${def}`;
  let fn = ajv.getSchema(ref) as ValidateFunction<T> | undefined;
  if (!fn) {
    ajv.addSchema({ $id: `${ref}--wrapper`, $ref: ref }, `${ref}--wrapper`);
    fn = ajv.getSchema(`${ref}--wrapper`) as ValidateFunction<T> | undefined;
  }
  if (!fn) throw new Error(`unknown definition ${ref}`);
  return (input: unknown): ValidationResult<T> => {
    if (fn(input)) return { ok: true, value: input };
    return { ok: false, errors: formatErrors(fn.errors) };
  };
}

/**
 * Validate and narrow in one step. The type parameter is a caller-declared contract (the generated type for
 * `schemaFile`); it cannot be inferred from `unknown` input, which is why it appears only in the return type.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function assertValid<T>(schemaFile: string, input: unknown, label = schemaFile): T {
  const r = validatorFor<T>(schemaFile)(input);
  if (r.ok) return r.value;
  const detail = r.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
  throw new Error(`${label} failed schema validation: ${detail}`);
}

type Json = Record<string, unknown>;

let shapeAjv: Ajv2020 | undefined;

/**
 * Validate against a bundled (self-contained) schema for SHAPE only: types, required fields, enums, ranges
 * and unknown properties. `format` is not checked, because output-shape examples carry placeholders such
 * as "엔티티 id" where the workflow later supplies a UUID (ADR-0057).
 */
export function shapeValidator(schema: Json): (input: unknown) => ValidationResult<unknown> {
  shapeAjv ??= new Ajv2020Class({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: false,
  });
  const fn = shapeAjv.compile(schema);
  return (input: unknown) =>
    fn(input) ? { ok: true, value: input } : { ok: false, errors: formatErrors(fn.errors) };
}

/**
 * A self-contained copy of a schema (or one of its `$defs`) with every `$ref` inlined, for consumers that
 * cannot resolve cross-file references: provider JSON-schema response formats and prompt shape generation
 * (ADR-0057). Cycles are refused rather than truncated.
 */
export function bundledSchema(schemaFile: string, def?: string): Json {
  const { schemas } = loadSchemas();
  const root = schemas.get(schemaFile);
  if (!root) throw new Error(`unknown schema ${schemaFile}`);
  const start = def === undefined ? root.schema : pointer(root.schema, `/$defs/${def}`, schemaFile);
  return inline(start, schemaFile, []) as Json;

  function inline(node: unknown, file: string, stack: readonly string[]): unknown {
    if (Array.isArray(node)) return node.map((n) => inline(n, file, stack));
    if (!node || typeof node !== 'object') return node;
    const obj = node as Json;
    if (typeof obj.$ref === 'string') {
      const [refFile, frag] = splitRef(obj.$ref, file);
      const key = `${refFile}#${frag}`;
      if (stack.includes(key)) throw new Error(`recursive $ref ${key} cannot be bundled`);
      const target = schemas.get(refFile);
      if (!target) throw new Error(`unknown $ref target ${obj.$ref} in ${file}`);
      const resolved = inline(pointer(target.schema, frag, refFile), refFile, [
        ...stack,
        key,
      ]) as Json;
      const { $ref: _ref, ...siblings } = obj;
      const rest = inline(siblings, file, stack) as Json;
      return Object.keys(rest).length === 0 ? resolved : { allOf: [resolved], ...rest };
    }
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '$id' || k === '$schema' || k === '$defs') continue;
      out[k] = inline(v, file, stack);
    }
    return out;
  }
}

function splitRef(ref: string, currentFile: string): [string, string] {
  const [file, frag = ''] = ref.split('#');
  const target =
    file === undefined || file === '' ? currentFile : file.replace(SCHEMA_BASE_URI, '');
  return [target, frag];
}

function pointer(schema: Json, frag: string, file: string): unknown {
  if (frag === '' || frag === '/') return schema;
  let node: unknown = schema;
  for (const raw of frag.replace(/^\//, '').split('/')) {
    const part = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!node || typeof node !== 'object' || !(part in (node as Json)))
      throw new Error(`unresolvable pointer #${frag} in ${file}`);
    node = (node as Json)[part];
  }
  return node;
}
