/**
 * Narrative Identity profiles as data (docs/02-narrative-identity/02). Profiles are loaded from
 * examples/narrative-profiles (the repository is the review surface until a database table exists), validated
 * against narrative-identity.schema.json, and composed into one identity per project: the two governing
 * layers (output language, tradition) plus genre overlays and the project's own layers.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertValid, type Generated } from '@yeonjae/domain';

export type NarrativeProfile = Generated.NarrativeIdentitySchema.NarrativeIdentityProfile;

export interface ProfileRef {
  readonly id: string;
  readonly version: number;
}

export function parseProfileRef(ref: string): ProfileRef {
  const m = /^(.+)@(\d+)$/.exec(ref);
  if (!m?.[1] || !m[2]) throw new Error(`profile ref must look like lang/en@1, got ${ref}`);
  return { id: m[1], version: Number(m[2]) };
}

export function profileRef(p: NarrativeProfile): string {
  return `${p.id}@${p.version}`;
}

function defaultDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'examples', 'narrative-profiles');
}

export class ProfileStore {
  private readonly byRef = new Map<string, NarrativeProfile>();

  static fromDirectory(dir: string = defaultDir()): ProfileStore {
    const store = new ProfileStore();
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith('.json'))
      .sort()) {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
      store.add(assertValid<NarrativeProfile>('narrative-identity.schema.json', raw, f));
    }
    return store;
  }

  add(profile: NarrativeProfile): this {
    const ref = profileRef(profile);
    if (this.byRef.has(ref))
      throw new Error(`duplicate profile ${ref}: profile versions are immutable`);
    this.byRef.set(ref, profile);
    return this;
  }

  get(ref: string): NarrativeProfile {
    const p = this.byRef.get(ref);
    if (!p) throw new Error(`unknown profile ${ref}; known: ${[...this.byRef.keys()].join(', ')}`);
    return p;
  }

  list(): NarrativeProfile[] {
    return [...this.byRef.values()];
  }
}

/** The eight layers, resolved. Layers 1–2 are mandatory (they carry the two governing contracts). */
export interface ComposedIdentity {
  readonly ref: string;
  readonly identityVersionId: string;
  readonly outputLanguage: NonNullable<NarrativeProfile['output_language']>;
  readonly tradition: NonNullable<NarrativeProfile['tradition']>;
  readonly genres: readonly NonNullable<NarrativeProfile['genre']>[];
  readonly primaryGenre: NonNullable<NarrativeProfile['genre']> | undefined;
  readonly setting: NarrativeProfile['setting'];
  readonly naming: NarrativeProfile['naming'];
  readonly registerPolicy: NarrativeProfile['register_policy'];
  readonly terminology: NarrativeProfile['terminology'];
  readonly preferences: NarrativeProfile['preferences'];
  readonly lineage: Readonly<Record<string, string>>;
  readonly conflicts: readonly string[];
}

export class ContractMissingError extends Error {
  constructor(readonly which: 'output_language' | 'tradition') {
    super(
      `composed identity is missing the ${which === 'output_language' ? 'Output-Language' : 'Narrative-Tradition'} contract`,
    );
    this.name = 'ContractMissingError';
  }
}

/**
 * Compose a project identity from its `composed` profile (lineage refs) plus the referenced global layers.
 * Scalar overrides follow JSON-merge-patch semantics for the layers the project owns; the two contracts are
 * taken verbatim from the global layers and can never be overridden by preferences (ADR-0027).
 */
export function composeIdentity(
  store: ProfileStore,
  composedRef: string,
  identityVersionId: string,
): ComposedIdentity {
  const composed = store.get(composedRef);
  if (composed.kind !== 'composed') throw new Error(`${composedRef} is not a composed identity`);
  const lineage = composed.lineage ?? {};
  const conflicts: string[] = [];

  const langRef = lineage.output_language;
  const tradRef = lineage.tradition;
  if (!langRef) throw new ContractMissingError('output_language');
  if (!tradRef) throw new ContractMissingError('tradition');
  const lang = store.get(langRef).output_language;
  const trad = store.get(tradRef).tradition;
  if (!lang?.contract_text) throw new ContractMissingError('output_language');
  if (!trad?.contract_text) throw new ContractMissingError('tradition');
  if (lang.language !== 'en') throw new Error(`OUTPUT_LANGUAGE_UNSUPPORTED: ${lang.language}`);

  const genres = (lineage.genres ?? []).map((ref) => {
    const g = store.get(ref).genre;
    if (!g) throw new Error(`${ref} has no genre layer`);
    return g;
  });
  const primaryGenre = lineage.primary_genre ? store.get(lineage.primary_genre).genre : genres[0];

  // Project-owned scalar override of the composed layers (locale etc.) — never the contract text.
  const outputLanguage = {
    ...lang,
    ...(composed.output_language ?? {}),
    contract_text: lang.contract_text,
  };
  if (
    composed.output_language?.contract_text &&
    composed.output_language.contract_text !== lang.contract_text
  ) {
    conflicts.push('project attempted to override the Output-Language Contract text; ignored');
  }
  const tradition = {
    ...trad,
    ...(composed.tradition ?? {}),
    contract_text: trad.contract_text,
    structure: { ...trad.structure, ...(composed.tradition?.structure ?? {}) },
    rhythm: { ...trad.rhythm, ...(composed.tradition?.rhythm ?? {}) },
  };
  if (
    composed.tradition?.contract_text &&
    composed.tradition.contract_text !== trad.contract_text
  ) {
    conflicts.push('project attempted to override the Narrative-Tradition Contract text; ignored');
  }
  // Preferences may tune numeric thresholds within layers but not the contracts (compiler rejects such keys).
  for (const key of Object.keys(composed.preferences?.numeric_overrides ?? {})) {
    if (key.includes('contract'))
      conflicts.push(`preference override targets a contract key (${key}); ignored`);
  }

  return {
    ref: composedRef,
    identityVersionId,
    outputLanguage,
    tradition,
    genres,
    primaryGenre,
    setting: composed.setting,
    naming: composed.naming,
    registerPolicy: composed.register_policy,
    terminology: composed.terminology,
    preferences: composed.preferences,
    lineage: Object.fromEntries(
      Object.entries(lineage).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
    ),
    conflicts,
  };
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}
