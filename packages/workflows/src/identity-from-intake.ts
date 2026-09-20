/**
 * Derive a project's composed Narrative Identity from its intake.
 *
 * The two governing layers (Output-Language contract, Narrative-Tradition contract) are always the
 * repository's global profiles and are never authored here (ADR-0027). What the intake decides is the
 * project-owned layers: which genre overlays apply (primary + secondary, when a profile exists for them),
 * the setting, naming and terminology policies, and the textual preferences the operator wrote. The
 * result validates against `narrative-identity.schema.json`, is stored as the project's
 * `narrative_identity` document (pinned, so production reads frozen bytes), and is registered in the
 * ProfileStore under `project/<projectId>@1` for the workflow context.
 */
import { createHash } from 'node:crypto';
import {
  appendIdentityDocument,
  pinIdentityDocument,
  pinnedIdentityDocument,
  type Pool,
} from '@yeonjae/db';
import { assertValid, uuidFromKey } from '@yeonjae/domain';
import { ProfileStore, sha256, type NarrativeProfile } from '@yeonjae/narrative';
import { type StoryIntake } from './planning.js';

const GENRE_PROFILES: Readonly<Record<string, string>> = {
  'hunter-gate': 'genre/hunter-gate@1',
  regression: 'genre/regression@1',
  academy: 'genre/academy@1',
  'romance-fantasy': 'genre/romance-fantasy@1',
  'slow-burn-romance': 'genre/romance-fantasy@1',
  villainess: 'genre/romance-fantasy@1',
  reincarnation: 'genre/regression@1',
  possession: 'genre/regression@1',
  dungeon: 'genre/hunter-gate@1',
  'system-progression': 'genre/hunter-gate@1',
  'apocalypse-survival': 'genre/hunter-gate@1',
  'game-world': 'genre/hunter-gate@1',
};

export function composedRefFor(projectId: string): string {
  return `project/${projectId}@1`;
}

/** Build the composed profile document for an intake. Pure; validated before return. */
export function identityProfileFromIntake(
  projectId: string,
  intake: StoryIntake,
  store: ProfileStore,
): NarrativeProfile {
  const known = new Set(store.list().map((p) => `${p.id}@${p.version}`));
  const lang = store.get('lang/en@1').output_language;
  const trad = store.get('tradition/kr-webnovel@1').tradition;
  if (!lang?.contract_text || !trad?.contract_text)
    throw new Error(
      'the global lang/en@1 and tradition/kr-webnovel@1 profiles must carry contract text',
    );
  const overlays = [intake.genre.primary, ...(intake.genre.secondary ?? [])]
    .map((g) => GENRE_PROFILES[g])
    .filter((ref): ref is string => ref !== undefined && known.has(ref));
  const unique = [...new Set(overlays)];
  const genres: NonNullable<NonNullable<NarrativeProfile['lineage']>['genres']> =
    unique.length >= 3
      ? [unique[0] ?? '', unique[1] ?? '', unique[2] ?? '']
      : unique.length === 2
        ? [unique[0] ?? '', unique[1] ?? '']
        : unique.length === 1
          ? [unique[0] ?? '']
          : [];
  const primary = genres[0];
  const namingStyle = intake.naming_preferences?.style;
  const settingType = intake.setting_preferences?.setting_type;
  const textual = (intake.prose_preferences ?? []).map((text) => ({
    text,
    priority: 'prefer' as const,
    scope: 'all' as const,
  }));
  const profile: NarrativeProfile = {
    id: `project/${projectId}`,
    kind: 'composed',
    version: 1,
    name: `${intake.title_working} — composed narrative identity`,
    lineage: {
      output_language: 'lang/en@1',
      tradition: 'tradition/kr-webnovel@1',
      ...(genres.length > 0 ? { genres } : {}),
      ...(primary ? { primary_genre: primary } : {}),
    },
    // The two contracts are copied VERBATIM from the global layers with their hashes: a composed profile
    // must carry them (schema), and `composeIdentity` refuses any text that differs from the global one.
    output_language: {
      language: 'en',
      locale: intake.spelling_locale ?? 'en-US',
      contract_text: lang.contract_text,
      contract_hash: lang.contract_hash ?? sha256(lang.contract_text),
    },
    tradition: {
      tradition_id: 'kr-webnovel',
      contract_text: trad.contract_text,
      contract_hash: trad.contract_hash ?? sha256(trad.contract_text),
    },
    setting: {
      setting_type: settingType ?? (namingStyle === 'western' ? 'other' : 'modern_korea'),
      ...(intake.setting_preferences?.notes ? { notes: [intake.setting_preferences.notes] } : {}),
      ...(intake.world_concept ? { place_names_policy: intake.world_concept.slice(0, 300) } : {}),
      cultural_texture: 'preserve_behaviors_localize_language',
      cultural_reference_policy:
        'Explain in-world through action or dialogue when needed; never footnote.',
    },
    naming: {
      style: namingStyle ?? 'korean_romanized',
      ...(namingStyle === undefined || namingStyle === 'korean_romanized'
        ? {
            romanization_system:
              intake.naming_preferences?.romanization_system ?? 'revised_romanization',
            name_order: 'family_given',
            given_name_hyphenation: 'hyphenated',
          }
        : {}),
      notes: [
        ...(intake.naming_preferences?.notes ? [intake.naming_preferences.notes] : []),
        ...[intake.main_character, ...(intake.supporting_characters ?? [])]
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          .map((c) => `Keep the name "${c.name}" exactly as given.`),
      ],
    },
    register_policy: {
      rendering_rules: [
        {
          condition: 'formality>=3 && deference>=3',
          guidance: 'Full titles or sir/ma’am; few contractions; requests phrased as questions.',
        },
        {
          condition: 'formality<=1 && familiarity>=2',
          guidance: 'First names or nicknames; contractions free; teasing allowed.',
        },
      ],
      anti_patterns: [
        'Honorific suffixes as English morphemes attached to names',
        'Literal kinship vocatives for non-kin',
        'Politeness calques',
      ],
      strictness: 'standard',
    },
    terminology: {
      default_decision: intake.terminology_preferences?.default_decision ?? 'translate',
      romanization_system: intake.naming_preferences?.romanization_system ?? 'revised_romanization',
      terms: [],
      ...(intake.terminology_preferences?.notes ? {} : {}),
    },
    preferences: {
      ...(textual.length > 0 ? { textual } : {}),
      forbidden_expressions: [],
    },
    calibration: { status: 'uncalibrated', notes: 'Composed from the intake at novel start.' },
  };
  const canonical = JSON.stringify(profile);
  const hashed: NarrativeProfile = {
    ...profile,
    content_hash: `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`,
  };
  return assertValid<NarrativeProfile>(
    'narrative-identity.schema.json',
    hashed,
    `project/${projectId}`,
  );
}

/**
 * Ensure the project pins a composed identity. A project that already pins one (settings) keeps it. A
 * project without one gets the intake-derived profile stored, pinned and registered; the profile store
 * returned includes it so `composeIdentity` resolves the project ref.
 */
export async function ensureProjectIdentity(
  pool: Pool,
  input: {
    workspaceId: string;
    projectId: string;
    intake: StoryIntake;
    store?: ProfileStore | undefined;
  },
): Promise<{ store: ProfileStore; ref: string; versionId: string; created: boolean }> {
  const store = input.store ?? ProfileStore.fromDirectory();
  const project = await pool.query<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM projects WHERE id = $1',
    [input.projectId],
  );
  const settings = project.rows[0]?.settings ?? {};
  const existingRef = settings.narrative_identity_ref;
  const existingVersion = settings.narrative_identity_version_id;
  if (typeof existingRef === 'string' && typeof existingVersion === 'string') {
    // A project-owned ref pinned earlier by this function lives in identity_documents, not on disk.
    if (existingRef === composedRefFor(input.projectId))
      await loadIntoStore(pool, input.projectId, store);
    return { store, ref: existingRef, versionId: existingVersion, created: false };
  }
  const ref = composedRefFor(input.projectId);
  let doc = await pinnedIdentityDocument(pool, {
    projectId: input.projectId,
    kind: 'narrative_identity',
  });
  if (!doc) {
    const profile = identityProfileFromIntake(input.projectId, input.intake, store);
    const appended = await appendIdentityDocument(pool, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: 'narrative_identity',
      expectedVersion: 0,
      payload: profile,
    });
    doc =
      (await pinIdentityDocument(pool, {
        projectId: input.projectId,
        kind: 'narrative_identity',
        version: appended.version,
      })) ?? appended;
  }
  const versionId = uuidFromKey(`${input.projectId}:narrative_identity:${doc.version}`);
  await pool.query(
    'UPDATE projects SET settings = settings || $2::jsonb, updated_at = now() WHERE id = $1',
    [
      input.projectId,
      JSON.stringify({ narrative_identity_ref: ref, narrative_identity_version_id: versionId }),
    ],
  );
  addProfile(store, doc.payload as unknown as NarrativeProfile);
  return { store, ref, versionId, created: true };
}

/** Load the project's pinned identity document into a store (idempotent). */
export async function loadIntoStore(
  pool: Pool,
  projectId: string,
  store: ProfileStore,
): Promise<void> {
  const doc = await pinnedIdentityDocument(pool, { projectId, kind: 'narrative_identity' });
  if (doc) addProfile(store, doc.payload as unknown as NarrativeProfile);
}

function addProfile(store: ProfileStore, profile: NarrativeProfile): void {
  try {
    store.get(`${profile.id}@${profile.version}`);
  } catch {
    store.add(profile);
  }
}
