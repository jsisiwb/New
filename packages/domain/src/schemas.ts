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
}

export type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: readonly ValidationFailure[] };

function formatErrors(errors: ErrorObject[] | null | undefined): ValidationFailure[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message ?? 'invalid',
    keyword: e.keyword,
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
