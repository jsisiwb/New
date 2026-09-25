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
import {
  ProfileStore,
  sha256,
  voiceProfileRef,
  type NarrativeProfile,
  type VoiceProfile,
} from '@yeonjae/narrative';
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
  // Korean-only layer (ADR-0056): no English lineage exists, so English projects skip it.
  harem: 'genre/harem@1',
};

/**
 * The newest Korean-authored version (≥ 2) of a profile id in the store, or undefined. Korean projects
 * compose from the latest craft layers at novel start (ADR-0056); the composed document is then pinned,
 * so a project never drifts when a newer layer is added later.
 */
function latestKoreanRef(store: ProfileStore, id: string): string | undefined {
  const cap = AUTO_LAYER_CAP[id] ?? Infinity;
  const versions = store
    .list()
    .filter((p) => p.id === id && p.version >= 2 && p.version <= cap)
    .map((p) => p.version);
  return versions.length > 0 ? `${id}@${String(Math.max(...versions))}` : undefined;
}

/**
 * The newest version a project composes without asking (ADR-0073). Later versions add rules that change
 * what a new project is gated by, so they are opt-in: a policy names them (`identity.language_layer`).
 */
const AUTO_LAYER_CAP: Readonly<Record<string, number>> = {
  'lang/ko': 5,
  // ADR-0089: v4 adds device variants; a policy names it in identity.genre_layers.
  'genre/regression': 3,
};

export interface IdentityCompositionOptions {
  /** `policy.identity.language_layer` of the project's pinned policy, when it names one. */
  readonly languageLayer?: string | undefined;
  /** `policy.identity.genre_layers` (ADR-0089): overlay versions taken instead of the newest uncapped one. */
  readonly genreLayers?: readonly string[] | undefined;
  /** The voice profile `policy.identity.voice_profile` names (ADR-0083, C3); used when its language matches. */
  readonly voice?: VoiceProfile | undefined;
  /** Corpus passages selected under `policy.identity.operator_exemplars` (ADR-0083, C5). */
  readonly operatorExemplars?: readonly OperatorExemplar[] | undefined;
  /** `policy.identity.device_lexicon` (ADR-0084, U2): record the premise device from the intake. */
  readonly deviceLexicon?: boolean | undefined;
  /** `policy.identity.device_rules` (ADR-0090): the device rule's wording the identity records. */
  readonly deviceRules?: 2 | undefined;
  /** `policy.identity.protagonist_type` (ADR-0090): record the intake's protagonist type. */
  readonly protagonistType?: boolean | undefined;
}

/** The protagonist type an intake names, when the compiler has a line for it (ADR-0090, G8-4). */
export function protagonistTypeOf(intake: StoryIntake): 'munchkin' | undefined {
  return /먼치킨|munchkin|사기캐|오버파워/iu.test(intake.protagonist_type ?? '')
    ? 'munchkin'
    : undefined;
}

export type StoryDevice = NonNullable<NonNullable<NarrativeProfile['preferences']>['story_device']>;

/**
 * The premise device an intake describes (ADR-0084, U2): possession by genre, told apart as game or novel
 * possession by the premise's own words; otherwise regression or reincarnation by genre.
 */
export function storyDeviceOf(intake: StoryIntake): StoryDevice | undefined {
  const genres = [intake.genre.primary, ...(intake.genre.secondary ?? [])];
  const words = [intake.premise, intake.world_concept ?? '', intake.protagonist_type ?? ''].join(
    ' ',
  );
  if (genres.includes('possession'))
    return /게임|game/i.test(words)
      ? 'game_possession'
      : /소설|원작|novel/i.test(words)
        ? 'novel_possession'
        : 'possession';
  if (genres.includes('regression')) return 'regression';
  if (genres.includes('reincarnation')) return 'reincarnation';
  return undefined;
}

export type OperatorExemplar = NonNullable<
  NonNullable<NarrativeProfile['preferences']>['operator_exemplars']
>[number];

export function composedRefFor(projectId: string): string {
  return `project/${projectId}@1`;
}

/** Build the composed profile document for an intake. Pure; validated before return. */
export function identityProfileFromIntake(
  projectId: string,
  intake: StoryIntake,
  store: ProfileStore,
  opts: IdentityCompositionOptions = {},
): NarrativeProfile {
  const known = new Set(store.list().map((p) => `${p.id}@${p.version}`));
  // ADR-0054: manuscript language is per-project. `manuscript_language` in the intake chooses the
  // Output-Language profile; unset keeps the legacy English default so the fixture lineage is stable.
  // ADR-0055: a Korean project composes from the Korean-authored layers (@2), so every rule the model
  // reads is Korean and none of the English-manuscript policies (romanization, English terms) apply.
  const isKo = intake.manuscript_language === 'ko';
  const requested = opts.languageLayer;
  const requestedFits =
    requested !== undefined &&
    known.has(requested) &&
    requested.startsWith(isKo ? 'lang/ko@' : 'lang/en@');
  const langRef = requestedFits
    ? requested
    : isKo
      ? (latestKoreanRef(store, 'lang/ko') ?? 'lang/ko@2')
      : 'lang/en@1';
  const tradRef = isKo
    ? (latestKoreanRef(store, 'tradition/kr-webnovel') ?? 'tradition/kr-webnovel@2')
    : 'tradition/kr-webnovel@1';
  const lang = store.get(langRef).output_language;
  const trad = store.get(tradRef).tradition;
  if (!lang?.contract_text || !trad?.contract_text)
    throw new Error(`the global ${langRef} and ${tradRef} profiles must carry contract text`);
  const overlays = [intake.genre.primary, ...(intake.genre.secondary ?? [])]
    .map((g) => GENRE_PROFILES[g])
    .map((ref) => {
      if (!ref || !isKo) return ref;
      const id = ref.replace(/@\d+$/, '');
      const named = opts.genreLayers?.find((r) => r.replace(/@\d+$/, '') === id && known.has(r));
      return named ?? latestKoreanRef(store, id);
    })
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
  const manuscriptLanguage = intake.manuscript_language === 'ko' ? 'ko' : 'en';
  const voice = opts.voice?.language === manuscriptLanguage ? opts.voice : undefined;
  const device = storyDeviceOf(intake);
  const textual = [
    ...(intake.prose_preferences ?? []),
    // The terminology layer has no free-text field; the operator's note must still reach the model.
    ...(intake.terminology_preferences?.notes ? [intake.terminology_preferences.notes] : []),
  ].map((text) => ({
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
      output_language: langRef,
      tradition: tradRef,
      ...(genres.length > 0 ? { genres } : {}),
      ...(primary ? { primary_genre: primary } : {}),
    },
    // The two contracts are copied VERBATIM from the global layers with their hashes: a composed profile
    // must carry them (schema), and `composeIdentity` refuses any text that differs from the global one.
    output_language: {
      language: lang.language ?? (intake.manuscript_language === 'ko' ? 'ko' : 'en'),
      locale: intake.manuscript_language === 'ko' ? 'ko-KR' : (intake.spelling_locale ?? 'en-US'),
      contract_text: lang.contract_text,
      contract_hash: lang.contract_hash ?? sha256(lang.contract_text),
    },
    tradition: {
      tradition_id: 'kr-webnovel',
      contract_text: trad.contract_text,
      contract_hash: trad.contract_hash ?? sha256(trad.contract_text),
    },
    ...(isKo ? koreanProjectLayers(intake) : englishProjectLayers(intake)),
    preferences: {
      ...(textual.length > 0 ? { textual } : {}),
      forbidden_expressions: [],
      // ADR-0073: point of view, the operator's style sample and contrast pairs travel with the identity,
      // so every role that reads the identity reads them; intakes without them compose as before.
      ...(intake.pov ? { pov: intake.pov } : {}),
      ...(intake.style_sample?.trim()
        ? { style_sample: { text: intake.style_sample.trim() } }
        : {}),
      ...(intake.contrast_pairs?.length ? { contrast_pairs: intake.contrast_pairs } : {}),
      // ADR-0083: the operator's voice and corpus passages are copied in, so the project reads frozen bytes.
      ...(voice
        ? {
            operator_voice: {
              ref: voiceProfileRef(voice),
              writer: [...voice.writer],
              planner: [...voice.planner],
              judges: [...voice.judges],
            },
          }
        : {}),
      ...(isKo && opts.operatorExemplars?.length
        ? { operator_exemplars: opts.operatorExemplars.map((e) => ({ ...e })) }
        : {}),
      ...(isKo && opts.deviceLexicon && device ? { story_device: device } : {}),
      ...(isKo && opts.deviceLexicon && device && opts.deviceRules === 2
        ? { story_device_rules: 2 as const }
        : {}),
      ...(isKo && opts.protagonistType && protagonistTypeOf(intake)
        ? { protagonist_type: 'munchkin' as const }
        : {}),
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
    languageLayer?: string | undefined;
    genreLayers?: readonly string[] | undefined;
    voice?: VoiceProfile | undefined;
    deviceLexicon?: boolean | undefined;
    deviceRules?: 2 | undefined;
    protagonistType?: boolean | undefined;
    /** Resolved only when the project has no pinned identity yet (it reads the corpus). */
    operatorExemplars?: (() => Promise<readonly OperatorExemplar[]>) | undefined;
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
    const profile = identityProfileFromIntake(input.projectId, input.intake, store, {
      languageLayer: input.languageLayer,
      genreLayers: input.genreLayers,
      voice: input.voice,
      operatorExemplars: input.operatorExemplars ? await input.operatorExemplars() : undefined,
      deviceLexicon: input.deviceLexicon,
      deviceRules: input.deviceRules,
      protagonistType: input.protagonistType,
    });
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
    // The manuscript language is project data (ADR-0054 §5): manuscript versions, summaries and search
    // documents take it from here.
    'UPDATE projects SET settings = settings || $2::jsonb, output_language = $3, updated_at = now() WHERE id = $1',
    [
      input.projectId,
      JSON.stringify({ narrative_identity_ref: ref, narrative_identity_version_id: versionId }),
      input.intake.manuscript_language === 'ko' ? 'ko' : 'en',
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

type ProjectLayers = Pick<
  NarrativeProfile,
  'setting' | 'naming' | 'register_policy' | 'terminology'
>;

function namedCharacters(intake: StoryIntake): string[] {
  return [intake.main_character, ...(intake.supporting_characters ?? [])]
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map((c) => c.name);
}

function englishProjectLayers(intake: StoryIntake): ProjectLayers {
  const namingStyle = intake.naming_preferences?.style;
  const settingType = intake.setting_preferences?.setting_type;
  return {
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
        ...namedCharacters(intake).map((n) => `Keep the name "${n}" exactly as given.`),
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
    },
  };
}

const SECONDARY_WORLD_GENRES = new Set([
  'romance-fantasy',
  'villainess',
  'academy',
  'murim',
  'possession',
  'reincarnation',
  'game-world',
]);

/**
 * Korean-manuscript project layers. The English layers' romanization, contraction and "sir/ma’am" rules are
 * meaningless (and harmful) for Korean prose; Korean speech levels and 호칭 carry register instead.
 */
function koreanProjectLayers(intake: StoryIntake): ProjectLayers {
  const namingStyle = intake.naming_preferences?.style;
  const genres = [intake.genre.primary, ...(intake.genre.secondary ?? [])];
  const inferredSecondary =
    namingStyle === 'western' ||
    namingStyle === 'invented' ||
    genres.some((g) => SECONDARY_WORLD_GENRES.has(g));
  return {
    setting: {
      setting_type:
        intake.setting_preferences?.setting_type ??
        (inferredSecondary ? 'secondary_world' : 'modern_korea'),
      ...(intake.setting_preferences?.notes ? { notes: [intake.setting_preferences.notes] } : {}),
      ...(intake.world_concept ? { place_names_policy: intake.world_concept.slice(0, 300) } : {}),
      cultural_texture: 'preserve_behaviors_localize_language',
      cultural_reference_policy: '각주 없이 행동이나 대사 안에서 필요한 만큼만 풀어 준다.',
    },
    naming: {
      style: namingStyle ?? (inferredSecondary ? 'western' : 'korean_romanized'),
      notes: [
        ...(intake.naming_preferences?.notes ? [intake.naming_preferences.notes] : []),
        ...namedCharacters(intake).map((n) => `이름 "${n}"은(는) 주어진 표기 그대로 쓴다.`),
      ],
    },
    register_policy: {
      rendering_rules: [
        {
          condition: '격식≥3 그리고 존대≥3',
          guidance:
            '하십시오체·해요체와 직함 호칭(교수님, 공작님, 전하). 부탁은 의문형으로 돌려 말한다.',
        },
        {
          condition: '격식≤1 그리고 친밀≥2',
          guidance: '반말(해체·해라체)과 이름·애칭. 농담과 장난스러운 핀잔이 자연스럽다.',
        },
        {
          condition: '처음 만난 사이 또는 서열이 불분명함',
          guidance: '해요체로 시작하고, 서열이 확인되는 순간 말높이가 바뀐다.',
        },
      ],
      anti_patterns: [
        '장면마다 흔들리는 말높이(같은 관계에서 반말·존댓말이 이유 없이 섞임)',
        '모든 인물이 똑같은 말투',
        '높임법의 기계적 남발(‘~하시었습니다’ 같은 과잉 존대)',
        '영어식 호칭 직역(‘미스터’, ‘서’, ‘마이 레이디’)',
      ],
      allowed_shift_reasons: [
        'anger',
        'intimacy_step',
        'mockery',
        'public_formality',
        'emotional_outburst',
      ],
      strictness: 'standard',
    },
    terminology: {
      default_decision: intake.terminology_preferences?.default_decision ?? 'translate',
      terms: [],
    },
  };
}
