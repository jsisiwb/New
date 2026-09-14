/**
 * Prompt registry (ADR-0016, docs/05-generation/03). Families are directories under packages/prompts/families;
 * each version is an immutable folder `vX.Y.Z/` with `prompt.json` (metadata) plus `system.md` and `user.md`
 * templates. The content hash covers metadata + both templates, so any edit produces a different hash and a
 * mismatch against the recorded hash is a registry error. Templates use a strict variable allowlist:
 * `{{name}}` placeholders must all be declared in `input_variables`; unknown placeholders fail at load time.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RoleVariant } from '@yeonjae/narrative';

export type ModelClass = 'R' | 'P' | 'M' | 'C' | 'E';
export type PromptStatus = 'draft' | 'candidate' | 'active' | 'deprecated';

export interface PromptVersionMeta {
  readonly family: string;
  readonly version: string;
  readonly role: string;
  readonly purpose: string;
  readonly style_sensitive: boolean;
  readonly manuscript_producing: boolean;
  readonly identity_variant: RoleVariant | null;
  readonly model_class: ModelClass;
  readonly input_variables: readonly string[];
  readonly output_schema: string | null;
  readonly output_mode: 'json' | 'text';
  readonly params: {
    readonly temperature: number;
    readonly max_tokens: number;
    readonly top_p?: number | undefined;
  };
  readonly failure_behavior: {
    readonly on_schema_invalid: 'repair_then_regenerate' | 'regenerate' | 'fail';
    readonly on_truncation: 'continue' | 'regenerate' | 'fail';
    readonly max_attempts: number;
  };
  readonly status: PromptStatus;
  readonly changelog: string;
  readonly regression_cases: readonly string[];
  readonly content_hash?: string | undefined;
}

export interface PromptVersion extends PromptVersionMeta {
  readonly id: string; // family@version
  readonly content_hash: string;
  readonly system_template: string;
  readonly user_template: string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function familiesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', 'families');
}

export function contentHash(meta: PromptVersionMeta, system: string, user: string): string {
  // Accept a full PromptVersion too: derived fields never participate in the hash.
  const { content_hash: _omit, ...rest } = meta as PromptVersionMeta & {
    id?: string;
    system_template?: string;
    user_template?: string;
  };
  delete rest.id;
  delete rest.system_template;
  delete rest.user_template;
  const canonical = JSON.stringify(sortKeys(rest));
  return `sha256:${createHash('sha256').update(canonical).update('\u0000').update(system).update('\u0000').update(user).digest('hex')}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function placeholders(template: string): Set<string> {
  const out = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) if (m[1]) out.add(m[1]);
  return out;
}

export class PromptRegistryError extends Error {
  constructor(
    readonly code:
      | 'HASH_MISMATCH'
      | 'UNKNOWN_VARIABLE'
      | 'MISSING_VARIABLE'
      | 'NOT_FOUND'
      | 'INVALID_META'
      | 'IDENTITY_VARIANT_REQUIRED',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'PromptRegistryError';
  }
}

export class PromptRegistry {
  private readonly versions = new Map<string, PromptVersion>();

  static fromDirectory(dir: string = familiesDir()): PromptRegistry {
    const reg = new PromptRegistry();
    if (!existsSync(dir)) return reg;
    for (const family of readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()) {
      const famDir = join(dir, family);
      for (const version of readdirSync(famDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^v\d+\.\d+\.\d+$/.test(d.name))
        .map((d) => d.name)
        .sort()) {
        const vDir = join(famDir, version);
        const meta = JSON.parse(
          readFileSync(join(vDir, 'prompt.json'), 'utf8'),
        ) as PromptVersionMeta;
        const system = readFileSync(join(vDir, 'system.md'), 'utf8');
        const user = readFileSync(join(vDir, 'user.md'), 'utf8');
        reg.add(meta, system, user, `${family}/${version}`);
      }
    }
    return reg;
  }

  add(
    meta: PromptVersionMeta,
    system: string,
    user: string,
    label = `${meta.family}@${meta.version}`,
  ): PromptVersion {
    if (meta.family.length === 0 || !/^\d+\.\d+\.\d+$/.test(meta.version)) {
      throw new PromptRegistryError(
        'INVALID_META',
        `${label}: family and semver version are required`,
      );
    }
    if (meta.style_sensitive && !meta.identity_variant) {
      throw new PromptRegistryError(
        'IDENTITY_VARIANT_REQUIRED',
        `${label}: style-sensitive prompts must name an identity variant`,
      );
    }
    if (meta.manuscript_producing && !meta.style_sensitive) {
      throw new PromptRegistryError(
        'INVALID_META',
        `${label}: manuscript-producing prompts are style-sensitive by definition`,
      );
    }
    if (meta.style_sensitive && !system.includes('{{narrative_identity_block}}')) {
      throw new PromptRegistryError(
        'MISSING_VARIABLE',
        `${label}: style-sensitive system template must embed {{narrative_identity_block}}`,
      );
    }
    const declared = new Set([
      ...meta.input_variables,
      ...(meta.style_sensitive ? ['narrative_identity_block', 'identity_tail'] : []),
    ]);
    for (const tpl of [system, user]) {
      for (const v of placeholders(tpl)) {
        if (!declared.has(v))
          throw new PromptRegistryError(
            'UNKNOWN_VARIABLE',
            `${label}: placeholder {{${v}}} is not declared in input_variables`,
          );
      }
    }
    const hash = contentHash(meta, system, user);
    if (meta.content_hash && meta.content_hash !== hash) {
      throw new PromptRegistryError(
        'HASH_MISMATCH',
        `${label}: recorded ${meta.content_hash} ≠ computed ${hash} (prompt versions are immutable; add a new version)`,
      );
    }
    const id = `${meta.family}@${meta.version}`;
    if (this.versions.has(id))
      throw new PromptRegistryError('INVALID_META', `${id} already registered`);
    const pv: PromptVersion = {
      ...meta,
      id,
      content_hash: hash,
      system_template: system,
      user_template: user,
    };
    this.versions.set(id, pv);
    return pv;
  }

  get(id: string): PromptVersion {
    const v = this.versions.get(id);
    if (!v) throw new PromptRegistryError('NOT_FOUND', `prompt ${id} not found`);
    return v;
  }

  list(): PromptVersion[] {
    return [...this.versions.values()];
  }

  families(): string[] {
    return [...new Set(this.list().map((v) => v.family))].sort();
  }

  /** Latest `active` version per family — the default prompt set. */
  activeSet(): PromptSet {
    const mapping: Record<string, string> = {};
    for (const fam of this.families()) {
      const active = this.list()
        .filter((v) => v.family === fam && v.status === 'active')
        .sort((a, b) => compareSemver(b.version, a.version));
      const first = active[0];
      if (first) mapping[fam] = first.id;
    }
    return {
      id: `set:${createHash('sha256').update(JSON.stringify(mapping)).digest('hex').slice(0, 16)}`,
      mapping,
    };
  }
}

export interface PromptSet {
  readonly id: string;
  readonly mapping: Readonly<Record<string, string>>;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface RenderedPrompt {
  readonly system: string;
  readonly user: string;
  readonly promptVersionId: string;
  readonly promptHash: string;
}

/** Render a version with its variables. Every declared variable must be supplied; nothing else is interpolated. */
export function renderPrompt(
  pv: PromptVersion,
  vars: Readonly<Record<string, string>>,
): RenderedPrompt {
  const required = new Set([
    ...pv.input_variables,
    ...(pv.style_sensitive ? ['narrative_identity_block', 'identity_tail'] : []),
  ]);
  for (const v of required) {
    if (!(v in vars))
      throw new PromptRegistryError(
        'MISSING_VARIABLE',
        `${pv.id}: variable {{${v}}} was not supplied`,
      );
  }
  const fill = (tpl: string) => tpl.replace(PLACEHOLDER, (_m, name: string) => vars[name] ?? '');
  return {
    system: fill(pv.system_template),
    user: fill(pv.user_template),
    promptVersionId: pv.id,
    promptHash: pv.content_hash,
  };
}
