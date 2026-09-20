/**
 * Story planning: the model-driven path from a user's intake to a COMPLETE Story Bible and series plan.
 *
 *   intake → Story Spec (requirement_interpreter) → concept candidates (concept_generator × N)
 *   → [operator approves one concept] → cast (character_designer) → world (world_builder)
 *   → progression system (power_system_designer) → Series Blueprint (story_architect)
 *   → assembled StoryBible (entities, propositions, promises, seed canon commits) → arc plans per season.
 *
 * Every step is a Postgres-checkpointed `runStep` under one planning job (`plan:<project>`), so a crash or
 * a provider outage resumes exactly where it stopped and never re-spends a completed call. The bible the
 * chapter loop consumes (`StoryBible`) is ASSEMBLED deterministically from the model outputs: ids are
 * derived from stable keys, every reference is checked against the registry, and anything a model
 * emitted that does not resolve is dropped with a recorded note rather than silently invented.
 *
 * The bible is PLANNED data (ADR-0038): entities and promises become registry rows, seed facts become the
 * `bible` canon commit inside `buildStoryBible` when chapter 1 runs. Nothing here writes realized canon.
 */
import {
  ensureJob,
  ensurePromptSet,
  getArtifactById,
  getProject,
  updateJob,
  upsertPromptVersions,
  type Pool,
} from '@yeonjae/db';
import {
  canonicalPolicyHash,
  type Generated,
  requirePolicy,
  uuidFromKey,
  validatorFor,
  type PolicyRef,
} from '@yeonjae/domain';
import { composeIdentity, ProfileStore, type ComposedIdentity } from '@yeonjae/narrative';
import { PromptRegistry } from '@yeonjae/prompts';
import { type Gateway } from '@yeonjae/gateway';
import { WorkflowError } from './errors.js';
import {
  compileFor,
  interpretRequirements,
  validateIntake,
  type ArcPlan,
  type StoryBible,
  type StoryIntake,
  type StorySpec,
} from './planning.js';
import {
  existingArtifact,
  modelCall,
  runStep,
  saveArtifact,
  type WorkflowContext,
  type WorkflowPins,
} from './runtime.js';

export type Concept = Generated.ConceptSchema.ConceptCandidate;
export type SeriesBlueprint = Generated.SeriesBlueprintSchema.SeriesBlueprint;

export interface StoryPlanDeps {
  readonly pool: Pool;
  readonly gateway: Gateway;
  readonly registry?: PromptRegistry | undefined;
  readonly profiles?: ProfileStore | undefined;
}

export function planWorkflowIdFor(projectId: string): string {
  return `plan:${projectId}`;
}

/** Stable ids for plan objects so a resumed run (or chapter k) addresses the same season/arc/contract. */
export const planIds = {
  season: (projectId: string, ordinal: number) => uuidFromKey(`${projectId}:season:${ordinal}`),
  arc: (projectId: string, seasonOrdinal: number, arcOrdinal: number) =>
    uuidFromKey(`${projectId}:season:${seasonOrdinal}:arc:${arcOrdinal}`),
  contract: (projectId: string, chapterNo: number) =>
    uuidFromKey(`${projectId}:contract:${chapterNo}`),
  entity: (projectId: string, kind: string, name: string) =>
    uuidFromKey(`${projectId}:entity:${kind}:${name.trim().toLowerCase()}`),
  promise: (projectId: string, statement: string) =>
    uuidFromKey(`${projectId}:promise:${statement.trim().toLowerCase()}`),
  concept: (projectId: string, specVersion: number, angle: string) =>
    uuidFromKey(`${projectId}:concept:${specVersion}:${angle.trim().toLowerCase()}`),
};

/**
 * Build the planning job context. Mirrors `makeContext` for chapters but keyed on the project, because the
 * bible is produced once per project (per spec version) and shared by every chapter.
 */
export async function makePlanContext(
  deps: StoryPlanDeps,
  projectId: string,
): Promise<{ ctx: WorkflowContext; mainTimelineId: string; identity: ComposedIdentity }> {
  const project = await getProject(deps.pool, projectId);
  const registry = deps.registry ?? PromptRegistry.fromDirectory();
  const promptSet = registry.activeSet();
  const policies = requirePolicy(project.production_policy_version as PolicyRef);
  const settings = project.settings;
  const identityRef =
    typeof settings.narrative_identity_ref === 'string'
      ? settings.narrative_identity_ref
      : undefined;
  const identityVersionId =
    typeof settings.narrative_identity_version_id === 'string'
      ? settings.narrative_identity_version_id
      : undefined;
  if (!identityRef || !identityVersionId)
    throw new WorkflowError(
      'IDENTITY_UNPINNED',
      `project ${projectId} pins no composed Narrative Identity`,
      { step: 'init', recommendedActions: ['edit_manually'] },
    );
  const identity = composeIdentity(
    deps.profiles ?? ProfileStore.fromDirectory(),
    identityRef,
    identityVersionId,
  );
  const main = await deps.pool.query<{ id: string }>(
    `SELECT id FROM timelines WHERE project_id = $1 AND kind = 'main' ORDER BY id LIMIT 1`,
    [projectId],
  );
  const mainTimelineId = main.rows[0]?.id;
  if (!mainTimelineId)
    throw new WorkflowError('INTERNAL', 'project has no main timeline', { step: 'init' });
  const workflowId = planWorkflowIdFor(projectId);
  const pins: WorkflowPins = {
    promptSetId: promptSet.id,
    promptSet: promptSet.mapping,
    productionPolicyVersion: project.production_policy_version,
    productionPolicyHash: canonicalPolicyHash(policies),
    narrativeIdentityVersionId: identityVersionId,
    narrativeIdentityRef: identityRef,
    canonVersionRead: project.canon_version,
  };
  await upsertPromptVersions(
    deps.pool,
    registry.list().map((v) => ({
      id: v.id,
      family: v.family,
      version: v.version,
      content_hash: v.content_hash,
      role: v.role,
      style_sensitive: v.style_sensitive,
      manuscript_producing: v.manuscript_producing,
      identity_variant: v.identity_variant,
      model_class: v.model_class,
      output_schema: v.output_schema,
      status: v.status,
      meta: { purpose: v.purpose, params: v.params },
    })),
  );
  await ensurePromptSet(deps.pool, promptSet);
  const { job } = await ensureJob(deps.pool, {
    workspaceId: project.workspace_id,
    projectId,
    kind: 'story_plan',
    workflowId,
    idempotencyKey: workflowId,
    targetKind: 'project',
    targetId: projectId,
    canonVersionRead: project.canon_version,
    productionPolicyVersion: project.production_policy_version,
    promptSetId: promptSet.id,
    narrativeIdentityVersionId: identityVersionId,
    pins: {
      prompt_set_id: pins.promptSetId,
      prompt_set: pins.promptSet,
      production_policy_version: pins.productionPolicyVersion,
      production_policy_hash: pins.productionPolicyHash,
      narrative_identity_ref: pins.narrativeIdentityRef,
      narrative_identity_version_id: pins.narrativeIdentityVersionId,
      canon_version_read: pins.canonVersionRead,
    },
  });
  const bindings: Record<string, string> = {
    ...(job.progress as { bindings?: Record<string, string> }).bindings,
    project: projectId,
    main_timeline: mainTimelineId,
  };
  const ctx: WorkflowContext = {
    pool: deps.pool,
    gateway: deps.gateway,
    registry,
    promptSet,
    policy: policies,
    identity,
    workspaceId: project.workspace_id,
    projectId,
    job,
    workflowId,
    pins,
    trace: [],
    bindings,
  };
  return { ctx, mainTimelineId, identity };
}

// ---------------------------------------------------------------------------------------------------------
// Stage 1: spec + concept suggestions
// ---------------------------------------------------------------------------------------------------------

export interface ConceptRound {
  readonly specVersion: number;
  readonly specArtifactId: string;
  readonly concepts: readonly Concept[];
  readonly artifactId: string;
}

const ANGLES = [
  'the most faithful reading of the premise, maximizing the genre core fantasy',
  'a sharper hook: raise the stakes of chapter one and tighten the central mystery',
  'a character-forward angle: foreground relationships and register conflict without softening progression',
  'a subversive angle: keep every hard requirement but invert one reader expectation of the genre',
];

/**
 * Interpret the intake into a Story Spec and propose N distinct story concepts for the operator to choose
 * from. `count` defaults to the pinned policy's `candidates.concept_candidates`, floored at 2.
 */
export async function suggestConcepts(
  ctx: WorkflowContext,
  input: { intake: StoryIntake; specVersion?: number | undefined; count?: number | undefined },
): Promise<ConceptRound> {
  const specVersion = input.specVersion ?? 1;
  const spec = await interpretRequirements(ctx, input.intake, specVersion);
  const count = Math.max(
    2,
    Math.min(ANGLES.length, input.count ?? ctx.policy.candidates.concept_candidates),
  );
  const block = compileFor(ctx, 'planner_compact');
  const concepts: Concept[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ANGLES[i] ?? `alternative angle ${i + 1}`;
    const result = await runStep(
      ctx,
      'concept',
      async () => {
        const call = await modelCall<Partial<Concept>>(ctx, {
          step: 'concept',
          family: 'concept_generator',
          activityId: `concept:v${specVersion}:${i + 1}`,
          variables: {
            story_spec: renderSpec(spec.spec),
            angle_seed: angle,
            spec_version: String(specVersion),
          },
          block,
        });
        const candidate: Concept = {
          ...(call.output as Concept),
          id: planIds.concept(ctx.projectId, specVersion, `${i + 1}`),
          project_id: ctx.projectId,
          spec_version: specVersion,
          angle:
            typeof call.output.angle === 'string' && call.output.angle ? call.output.angle : angle,
          status: 'candidate',
          generator_call_id: call.llmCallId,
        };
        const v = validatorFor<Concept>('concept.schema.json')(candidate);
        if (!v.ok)
          throw new WorkflowError(
            'SPEC_INVALID',
            `concept ${i + 1} does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
            { step: 'concept', recommendedActions: ['regenerate'] },
          );
        const ref = await saveArtifact(ctx, {
          step: 'concept',
          kind: 'concept',
          key: `v${specVersion}:${i + 1}`,
          schema: 'concept.schema.json',
          payload: v.value,
        });
        return { concept: v.value, artifactId: ref.artifact_id };
      },
      `v${specVersion}:${i + 1}`,
    );
    concepts.push(result.concept);
  }
  const round = await saveArtifact(ctx, {
    step: 'concept',
    kind: 'concept_round',
    key: `v${specVersion}`,
    payload: { spec_version: specVersion, concept_ids: concepts.map((c) => c.id) },
  });
  await updateJob(ctx.pool, ctx.job.id, {
    status: 'waiting_review',
    currentStep: 'concept_review',
    progress: { stage: 'concepts_ready', spec_version: specVersion },
  });
  return { specVersion, specArtifactId: spec.artifactId, concepts, artifactId: round.artifact_id };
}

// ---------------------------------------------------------------------------------------------------------
// Stage 2: full bible from the approved concept
// ---------------------------------------------------------------------------------------------------------

interface CastOutput {
  characters?: {
    display_name?: string;
    role?: string;
    age_at_start?: number | string;
    background?: string;
    goals?: string[] | string;
    flaws?: string[] | string;
    secrets?: (
      string | { statement?: string; known_by?: string[]; reveal_not_before_chapter?: number }
    )[];
    arc?: string;
    voice_notes?: string[] | string;
    short_forms?: string[];
    aliases?: string[];
    rank?: string;
    registers?: {
      toward?: string;
      type?: string;
      formality?: number;
      deference?: number;
      familiarity?: number;
      directness?: number;
      contractions?: string;
      address_terms?: string[];
    }[];
  }[];
  propositions?: { statement?: string; kind?: string; secret?: unknown; entity_names?: string[] }[];
}

interface WorldOutput {
  world_rules?: { attribute?: string; statement?: string; value?: unknown; locked?: boolean }[];
  locations?: { display_name?: string; description?: string; aliases?: string[] }[];
  organizations?: { display_name?: string; description?: string; short_forms?: string[] }[];
  terminology?: { term?: string; decision?: string; english?: string }[];
}

interface PowerOutput {
  system_rules?: { attribute?: string; statement?: string; locked?: boolean }[];
  ranks?: { name?: string; description?: string }[];
  abilities?: { display_name?: string; description?: string; owner?: string }[];
  milestones?: { description?: string; chapter_from?: number; chapter_to?: number }[];
}

export interface StoryPlanResult {
  readonly specVersion: number;
  readonly concept: Concept;
  readonly bible: StoryBible;
  readonly bibleArtifactId: string;
  readonly blueprint: SeriesBlueprint;
  readonly blueprintArtifactId: string;
  readonly cast: number;
  readonly locations: number;
  readonly organizations: number;
  readonly propositions: number;
  readonly promises: number;
  readonly seasons: number;
  readonly notes: readonly string[];
}

const ENTITY_TYPES = new Set([
  'character',
  'location',
  'organization',
  'item',
  'ability',
  'term',
  'event_anchor',
  'timeline',
]);
const PROP_KINDS = new Set([
  'identity',
  'event',
  'location',
  'ability',
  'intent',
  'relationship',
  'world_rule',
  'secret',
  'other',
]);
const REL_TYPES = new Set([
  'stranger',
  'acquaintance',
  'colleague',
  'friend',
  'mentor',
  'disciple',
  'rival',
  'enemy',
  'ally',
  'family',
  'romantic_interest',
  'lover',
  'spouse',
  'superior',
  'subordinate',
  'other',
]);

/**
 * Generate the complete bible for the approved concept. Idempotent: every model call is checkpointed and
 * the assembled bible is a content-addressed artifact keyed by spec version + concept id.
 */
export async function buildFullBible(
  ctx: WorkflowContext,
  input: { intake: StoryIntake; spec: StorySpec; concept: Concept; mainTimelineId: string },
): Promise<StoryPlanResult> {
  const { spec, concept, intake } = input;
  const block = compileFor(ctx, 'planner_compact');
  const specText = renderSpec(spec);
  const conceptText = JSON.stringify(concept, null, 1);
  const notes: string[] = [];

  const castBrief = [
    intake.main_character
      ? `Main character: ${sketch(intake.main_character)}`
      : 'Main character: derive from the premise and concept.',
    ...(intake.supporting_characters ?? []).map((c) => `Supporting: ${sketch(c)}`),
    `Design 6–12 characters: protagonist, antagonist(s), 2–4 allies/mentors, love interest if romance is present, at least one foil. Every character needs registers toward each key counterpart.`,
  ].join('\n');

  const cast = await runStep(ctx, 'cast', async () => {
    const call = await modelCall<CastOutput>(ctx, {
      step: 'cast',
      family: 'character_designer',
      activityId: `cast:${concept.id}`,
      variables: { story_spec: specText, concept: conceptText, cast_brief: castBrief },
      block,
    });
    if (!Array.isArray(call.output.characters) || call.output.characters.length === 0)
      throw new WorkflowError('SPEC_INVALID', 'character_designer returned no characters', {
        step: 'cast',
        recommendedActions: ['regenerate'],
      });
    const ref = await saveArtifact(ctx, {
      step: 'cast',
      kind: 'cast',
      key: concept.id,
      payload: call.output,
    });
    return { output: call.output, artifactId: ref.artifact_id };
  });

  const world = await runStep(ctx, 'world', async () => {
    const call = await modelCall<WorldOutput>(ctx, {
      step: 'world',
      family: 'world_builder',
      activityId: `world:${concept.id}`,
      variables: { story_spec: specText, concept: conceptText },
      block,
    });
    const ref = await saveArtifact(ctx, {
      step: 'world',
      kind: 'world',
      key: concept.id,
      payload: call.output,
    });
    return { output: call.output, artifactId: ref.artifact_id };
  });

  const power = await runStep(ctx, 'power_system', async () => {
    const call = await modelCall<PowerOutput>(ctx, {
      step: 'power_system',
      family: 'power_system_designer',
      activityId: `power:${concept.id}`,
      variables: {
        story_spec: specText,
        concept: conceptText,
        world_rules: JSON.stringify(world.output.world_rules ?? [], null, 1),
      },
      block,
    });
    const ref = await saveArtifact(ctx, {
      step: 'power_system',
      kind: 'power_system',
      key: concept.id,
      payload: call.output,
    });
    return { output: call.output, artifactId: ref.artifact_id };
  });

  // ---- deterministic assembly of the registry ------------------------------------------------------
  const entities: StoryBible['entities'][number][] = [];
  const byName = new Map<string, string>();
  const addEntity = (
    type: string,
    name: string | undefined,
    extra: { description?: string; short_forms?: string[]; aliases?: string[] } = {},
  ): string | undefined => {
    const display = (name ?? '').trim();
    if (!display) return undefined;
    const key = display.toLowerCase();
    const existing = byName.get(key);
    if (existing) return existing;
    const id = planIds.entity(ctx.projectId, ENTITY_TYPES.has(type) ? type : 'term', display);
    entities.push({
      id,
      type: ENTITY_TYPES.has(type) ? type : 'term',
      display_name: display,
      ...(extra.short_forms?.length ? { short_forms: dedupe(extra.short_forms) } : {}),
      ...(extra.aliases?.length ? { aliases: dedupe(extra.aliases) } : {}),
      ...(extra.description ? { description: extra.description } : {}),
    });
    byName.set(key, id);
    for (const alias of [...(extra.short_forms ?? []), ...(extra.aliases ?? [])])
      if (alias.trim() && !byName.has(alias.trim().toLowerCase()))
        byName.set(alias.trim().toLowerCase(), id);
    return id;
  };
  const resolve = (name: string | undefined): string | undefined =>
    name ? byName.get(name.trim().toLowerCase()) : undefined;

  const characters = cast.output.characters ?? [];
  for (const c of characters) {
    addEntity('character', c.display_name, {
      description: [
        c.age_at_start !== undefined ? `${String(c.age_at_start)}.` : '',
        c.role ? `${c.role}.` : '',
        c.background ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 600),
      short_forms: c.short_forms ?? [],
      aliases: c.aliases ?? [],
    });
  }
  for (const l of world.output.locations ?? [])
    addEntity('location', l.display_name, {
      ...(l.description ? { description: l.description.slice(0, 400) } : {}),
      aliases: l.aliases ?? [],
    });
  for (const o of world.output.organizations ?? [])
    addEntity('organization', o.display_name, {
      ...(o.description ? { description: o.description.slice(0, 400) } : {}),
      short_forms: o.short_forms ?? [],
    });
  for (const a of power.output.abilities ?? [])
    addEntity('ability', a.display_name, {
      ...(a.description ? { description: a.description.slice(0, 400) } : {}),
    });
  const worldTermId = addEntity('term', 'World rules', {
    description: 'Locked world and progression rules of the setting.',
  });
  if (entities.length === 0)
    throw new WorkflowError('SPEC_INVALID', 'the bible has no entities after assembly', {
      step: 'bible_assembly',
      recommendedActions: ['regenerate'],
    });

  // ---- propositions (secrets + designer propositions) -----------------------------------------------
  const propositions: StoryBible['propositions'][number][] = [];
  const propKeys = new Set<string>();
  const addProposition = (
    statement: string | undefined,
    kind: string | undefined,
    entityIds: string[],
    secret?: {
      owner_ids: string[];
      allowed_knower_ids: string[];
      reveal_not_before_chapter?: number;
    },
  ): string | undefined => {
    const text = (statement ?? '').trim();
    if (!text) return undefined;
    const key = text.toLowerCase();
    if (propKeys.has(key)) return undefined;
    propKeys.add(key);
    const localId = `P${propositions.length + 1}`;
    propositions.push({
      local_id: localId,
      statement: text,
      kind: kind && PROP_KINDS.has(kind) ? kind : secret ? 'secret' : 'other',
      entity_ids: dedupe(entityIds),
      ...(secret ? { secret } : {}),
      truth: 'true',
    });
    return localId;
  };
  const secretHolders: { knowerId: string; localId: string }[] = [];
  for (const c of characters) {
    const ownerId = resolve(c.display_name);
    if (!ownerId) continue;
    for (const s of c.secrets ?? []) {
      const statement = typeof s === 'string' ? s : s.statement;
      const knownBy = typeof s === 'string' ? [] : (s.known_by ?? []);
      const knowers = dedupe([ownerId, ...knownBy.map(resolve).filter(isString)]);
      const notBefore = typeof s === 'string' ? undefined : s.reveal_not_before_chapter;
      const localId = addProposition(statement, 'secret', [ownerId], {
        owner_ids: [ownerId],
        allowed_knower_ids: knowers,
        ...(notBefore !== undefined && notBefore >= 1
          ? { reveal_not_before_chapter: notBefore }
          : {}),
      });
      if (localId) for (const k of knowers) secretHolders.push({ knowerId: k, localId });
    }
  }
  for (const p of cast.output.propositions ?? []) {
    const ids = (p.entity_names ?? []).map(resolve).filter(isString);
    addProposition(p.statement, p.kind, ids);
  }

  // ---- seed canon commit: world rules, ranks, registers, secret knowledge --------------------------
  const seedFacts: Record<string, unknown>[] = [];
  const clock0 = { chapter_no: 0, ordinal: 0, precision: 'exact' };
  const fact = (
    localId: string,
    entityId: string,
    attribute: string,
    value: unknown,
    valueText: string,
    importance: 'core' | 'major' | 'minor',
    locked = false,
  ): Record<string, unknown> => ({
    local_id: localId,
    type: 'fact',
    op: 'assert',
    frame: 'canonical',
    confidence: 1,
    importance,
    evidence: [],
    payload: {
      entity_id: entityId,
      attribute,
      value,
      value_text: valueText.slice(0, 500),
      valid_from: clock0,
      valid_to: null,
      ...(locked ? { locked: true } : {}),
    },
  });
  let n = 0;
  const rules = [
    ...(world.output.world_rules ?? []).map((r) => ({ ...r, prefix: 'world.rule' })),
    ...(power.output.system_rules ?? []).map((r) => ({ ...r, prefix: 'power.rule' })),
  ];
  if (worldTermId)
    for (const r of rules) {
      const statement = (r.statement ?? '').trim();
      if (!statement) continue;
      n++;
      const attr = `${r.prefix}.${slug(r.attribute ?? statement.split(/\s+/).slice(0, 4).join('_'))}_${slug(String(n))}`;
      seedFacts.push(
        fact(
          `rule-${n}`,
          worldTermId,
          attr,
          statement.slice(0, 120),
          statement,
          'core',
          r.locked ?? true,
        ),
      );
    }
  for (const c of characters) {
    const id = resolve(c.display_name);
    if (!id) continue;
    if (c.rank) {
      n++;
      seedFacts.push(
        fact(
          `rank-${n}`,
          id,
          'power.rank',
          c.rank,
          `${c.display_name ?? ''} is ${c.rank}`,
          'major',
        ),
      );
    }
    if (c.role) {
      n++;
      seedFacts.push(
        fact(
          `role-${n}`,
          id,
          'identity.role',
          c.role,
          `${c.display_name ?? ''}: ${c.role}`,
          'minor',
        ),
      );
    }
  }
  const relations: Record<string, unknown>[] = [];
  for (const c of characters) {
    const from = resolve(c.display_name);
    if (!from) continue;
    for (const r of c.registers ?? []) {
      const to = resolve(r.toward);
      if (!to || to === from) continue;
      n++;
      const level = (v: number | undefined) =>
        typeof v === 'number' ? Math.max(0, Math.min(5, Math.round(v))) : undefined;
      relations.push({
        local_id: `rel-${n}`,
        type: 'relationship_state',
        op: 'assert',
        frame: 'canonical',
        confidence: 1,
        importance: 'major',
        evidence: [],
        payload: {
          from_entity_id: from,
          to_entity_id: to,
          type: r.type && REL_TYPES.has(r.type) ? r.type : 'acquaintance',
          register: {
            ...(level(r.formality) !== undefined ? { formality: level(r.formality) } : {}),
            ...(level(r.deference) !== undefined ? { deference: level(r.deference) } : {}),
            ...(level(r.familiarity) !== undefined ? { familiarity: level(r.familiarity) } : {}),
            ...(level(r.directness) !== undefined ? { directness: level(r.directness) } : {}),
            ...(r.contractions && ['avoid', 'neutral', 'free'].includes(r.contractions)
              ? { contractions: r.contractions }
              : {}),
            ...(r.address_terms?.length ? { address_terms: dedupe(r.address_terms) } : {}),
          },
          valid_from: clock0,
          valid_to: null,
        },
      });
    }
  }
  const knowledge: Record<string, unknown>[] = secretHolders.map((s, i) => ({
    local_id: `k-${i + 1}`,
    type: 'knowledge_state',
    op: 'assert',
    frame: 'canonical',
    confidence: 1,
    importance: 'core',
    evidence: [],
    payload: {
      knower: { kind: 'character', entity_id: s.knowerId },
      proposition_id: `{{proposition.${s.localId}}}`,
      stance: 'knows',
      source: { kind: 'remembered', chapter_id: '{{chapter.1}}' },
      valid_from: clock0,
      valid_to: null,
    },
  }));

  // ---- Series Blueprint (seasons, arcs, endgame, promises) -----------------------------------------
  const draftBible: StoryBible = {
    version: spec.version,
    entities,
    propositions,
    promises: [],
    commits: [[...seedFacts, ...relations], knowledge].filter((c) => c.length > 0),
  };
  const blueprintStep = await runStep(ctx, 'blueprint', async () => {
    const call = await modelCall<Partial<SeriesBlueprint> & { promises?: RawPromise[] }>(ctx, {
      step: 'blueprint',
      family: 'story_architect',
      activityId: `blueprint:${concept.id}`,
      variables: {
        story_spec: specText,
        concept: conceptText,
        bible_summary: renderBibleSummary(draftBible),
        target_chapters: String(intake.target_chapters),
      },
      block,
    });
    const raw = call.output;
    const protagonistId =
      resolve(intake.main_character?.name) ??
      resolve(characters[0]?.display_name) ??
      entities[0]?.id;
    const seasons = normalizeSeasons(raw.seasons, intake.target_chapters, ctx.projectId);
    const promises = normalizePromises(
      raw.promises ?? [],
      ctx.projectId,
      resolve,
      intake.target_chapters,
    );
    const candidate: SeriesBlueprint = {
      project_id: ctx.projectId,
      version: spec.version,
      pinned: { spec_version: spec.version, bible_version: spec.version },
      story_promise: str(raw.story_promise) ?? concept.story_promise,
      reader_fantasy: str(raw.reader_fantasy) ?? concept.reader_fantasy,
      main_conflict: str(raw.main_conflict) ?? concept.main_conflict,
      ...(Array.isArray(raw.themes) ? { themes: raw.themes.filter(isString) } : {}),
      protagonist_arc: normalizeArc(
        raw.protagonist_arc,
        protagonistId ?? '',
        intake.target_chapters,
      ),
      ...(Array.isArray(raw.character_arcs)
        ? {
            character_arcs: raw.character_arcs
              .map((a) => {
                const id =
                  isUuidLike(a.entity_id) && entities.some((e) => e.id === a.entity_id)
                    ? a.entity_id
                    : resolve((a as { entity_name?: string }).entity_name ?? a.entity_id);
                return id ? normalizeArc(a, id, intake.target_chapters) : undefined;
              })
              .filter(isDefined),
          }
        : {}),
      ...(raw.progression_arc
        ? {
            progression_arc: {
              ...(str(raw.progression_arc.system_summary)
                ? { system_summary: str(raw.progression_arc.system_summary) }
                : {}),
              ...(Array.isArray(raw.progression_arc.milestones)
                ? {
                    milestones: raw.progression_arc.milestones
                      .map((m) => normalizeMilestone(m, intake.target_chapters))
                      .filter(isDefined),
                  }
                : {}),
              ...(typeof raw.progression_arc.cadence_chapters === 'number' &&
              raw.progression_arc.cadence_chapters >= 1
                ? { cadence_chapters: Math.round(raw.progression_arc.cadence_chapters) }
                : {}),
            },
          }
        : {}),
      ending: {
        type: endingType(raw.ending?.type, intake.ending_preference),
        ...(str(raw.ending?.summary) ? { summary: str(raw.ending?.summary) } : {}),
        final_state_assertions:
          Array.isArray(raw.ending?.final_state_assertions) &&
          raw.ending.final_state_assertions.filter(isString).length > 0
            ? raw.ending.final_state_assertions.filter(isString)
            : [concept.ending_direction],
      },
      endgame_requirements: (Array.isArray(raw.endgame_requirements)
        ? raw.endgame_requirements
        : []
      )
        .map((r, i) => ({
          id: str(r.id) ?? `EG-${i + 1}`,
          statement: str(r.statement) ?? '',
          kind: ['fact', 'knowledge', 'relationship', 'promise_paid', 'progression'].includes(
            r.kind,
          )
            ? r.kind
            : 'fact',
        }))
        .filter((r) => r.statement.length > 0),
      seasons,
      foreshadowing_register: promises.map((p) => p.id),
    } as SeriesBlueprint;
    const v = validatorFor<SeriesBlueprint>('series-blueprint.schema.json')(candidate);
    if (!v.ok)
      throw new WorkflowError(
        'ARC_PLAN_INVALID',
        `series blueprint does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
        { step: 'blueprint', recommendedActions: ['regenerate'] },
      );
    const ref = await saveArtifact(ctx, {
      step: 'blueprint',
      kind: 'series_blueprint',
      key: `v${spec.version}`,
      schema: 'series-blueprint.schema.json',
      payload: v.value,
    });
    return { blueprint: v.value, promises, artifactId: ref.artifact_id };
  });

  const bible: StoryBible = { ...draftBible, promises: blueprintStep.promises };
  const bibleRef = await runStep(ctx, 'bible_assembly', async () => {
    const ref = await saveArtifact(ctx, {
      step: 'bible_assembly',
      kind: 'full_bible',
      key: `v${spec.version}:${concept.id}`,
      payload: bible,
    });
    return { artifactId: ref.artifact_id };
  });
  if (blueprintStep.promises.length === 0)
    notes.push('the architect proposed no promises; arcs open their own');

  return {
    specVersion: spec.version,
    concept,
    bible,
    bibleArtifactId: bibleRef.artifactId,
    blueprint: blueprintStep.blueprint,
    blueprintArtifactId: blueprintStep.artifactId,
    cast: entities.filter((e) => e.type === 'character').length,
    locations: entities.filter((e) => e.type === 'location').length,
    organizations: entities.filter((e) => e.type === 'organization').length,
    propositions: propositions.length,
    promises: blueprintStep.promises.length,
    seasons: blueprintStep.blueprint.seasons.length,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Stage 3: arc plans per season (rolling horizon, ADR-0012)
// ---------------------------------------------------------------------------------------------------------

export interface ArcSchedule {
  readonly arcs: readonly {
    id: string;
    seasonId: string;
    from: number;
    to: number;
    ordinal: number;
  }[];
}

/** Which arc a chapter belongs to, from the blueprint's season windows. Each season is one major arc. */
export function scheduleFromBlueprint(projectId: string, blueprint: SeriesBlueprint): ArcSchedule {
  const arcs = blueprint.seasons.map((s) => ({
    id: planIds.arc(projectId, s.ordinal, 1),
    seasonId: s.id ?? planIds.season(projectId, s.ordinal),
    from: s.chapter_range_est.from,
    to: s.chapter_range_est.to,
    ordinal: s.ordinal,
  }));
  return { arcs };
}

export function arcForChapter(schedule: ArcSchedule, chapterNo: number) {
  return (
    schedule.arcs.find((a) => chapterNo >= a.from && chapterNo <= a.to) ??
    schedule.arcs[schedule.arcs.length - 1]
  );
}

/**
 * Plan one arc from the blueprint season and the bible. Checkpointed per arc id, so chapter k reuses the
 * arc chapter 1 planned. Unlike the fixture path, the brief comes from the blueprint, not from a hardcoded
 * string.
 */
export async function planArcFromBlueprint(
  ctx: WorkflowContext,
  input: {
    blueprint: SeriesBlueprint;
    bible: StoryBible;
    arc: ArcSchedule['arcs'][number];
    previousArcExit?: string | undefined;
  },
): Promise<{ arcPlan: ArcPlan; artifactId: string }> {
  const season = input.blueprint.seasons.find((s) => s.ordinal === input.arc.ordinal);
  return runStep(
    ctx,
    'arc_plan',
    async () => {
      const stored = await existingArtifact(ctx, {
        step: 'arc_plan',
        kind: 'arc_plan',
        key: input.arc.id,
      });
      if (stored) return { arcPlan: stored.payload as ArcPlan, artifactId: stored.artifact_id };
      const block = compileFor(ctx, 'planner_compact');
      const call = await modelCall<Partial<ArcPlan>>(ctx, {
        step: 'arc_plan',
        family: 'arc_planner',
        activityId: `arc_plan:${input.arc.id}`,
        variables: {
          blueprint: renderBlueprint(input.blueprint),
          season: season
            ? `Season ${season.ordinal} "${season.title}" (id ${input.arc.seasonId}), chapters ${season.chapter_range_est.from}–${season.chapter_range_est.to}: ${season.objective}${season.thesis ? ` Thesis: ${season.thesis}` : ''}`
            : `Season ${input.arc.ordinal} (id ${input.arc.seasonId})`,
          arc_brief: `Arc ${input.arc.ordinal} (id ${input.arc.id}) covers chapters ${input.arc.from}–${input.arc.to}. ${season?.entry_state ? `Entry state: ${season.entry_state}. ` : ''}${season?.exit_state ? `Exit state to reach: ${season.exit_state}.` : ''}${input.previousArcExit ? ` Previous arc ended: ${input.previousArcExit}` : ''} Beats must carry target_chapter_offset from 0 (chapter ${input.arc.from}) to ${input.arc.to - input.arc.from}. Participants and locations must be registry ids from the canon state below.`,
          canon_state: renderBibleSummary(input.bible),
          open_promises:
            input.bible.promises
              .map(
                (p) =>
                  `- [${p.id}] ${p.statement} (${p.type}, ${p.importance}${p.due_min_chapter !== undefined ? `, due ch.${p.due_min_chapter}–${p.due_max_chapter ?? '?'}` : ''})`,
              )
              .join('\n') || '(none yet)',
        },
        block,
      });
      const known = new Set(input.bible.entities.map((e) => e.id));
      const promiseIds = new Set(input.bible.promises.map((p) => p.id));
      const raw = call.output;
      const onlyKnown = (ids: unknown): string[] =>
        Array.isArray(ids) ? ids.filter((x): x is string => isString(x) && known.has(x)) : [];
      const onlyPromises = (ids: unknown): string[] =>
        Array.isArray(ids) ? ids.filter((x): x is string => isString(x) && promiseIds.has(x)) : [];
      const beats = (Array.isArray(raw.beats) ? raw.beats : []).map((b, i) => ({
        ...b,
        id: str(b.id) ?? `arc${input.arc.ordinal}.beat.${String(i + 1).padStart(2, '0')}`,
        target_chapter_offset: Math.max(
          0,
          Math.min(input.arc.to - input.arc.from, Math.round(b.target_chapter_offset || 0)),
        ),
        ...(b.participants ? { participants: onlyKnown(b.participants) } : {}),
        ...(b.promise_refs ? { promise_refs: onlyPromises(b.promise_refs) } : {}),
      }));
      const candidate = {
        ...raw,
        id: input.arc.id,
        project_id: ctx.projectId,
        season_id: input.arc.seasonId,
        kind: 'major',
        ordinal: input.arc.ordinal,
        version: 1,
        title: str(raw.title) ?? season?.title ?? `Arc ${input.arc.ordinal}`,
        objective: str(raw.objective) ?? season?.objective ?? '',
        conflict: str(raw.conflict) ?? input.blueprint.main_conflict,
        chapter_range_est: { from: input.arc.from, to: input.arc.to },
        beats,
        participants: onlyKnown(raw.participants),
        locations: onlyKnown(raw.locations),
        promises_opened: onlyPromises(raw.promises_opened),
        promises_advanced: onlyPromises(raw.promises_advanced),
        promises_paid: onlyPromises(raw.promises_paid),
        status: 'validated',
      };
      const v = validatorFor<ArcPlan>('arc-plan.schema.json')(candidate);
      if (!v.ok)
        throw new WorkflowError(
          'ARC_PLAN_INVALID',
          v.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
          { step: 'arc_plan', recommendedActions: ['regenerate'] },
        );
      const ref = await saveArtifact(ctx, {
        step: 'arc_plan',
        kind: 'arc_plan',
        key: input.arc.id,
        schema: 'arc-plan.schema.json',
        payload: v.value,
      });
      return { arcPlan: v.value, artifactId: ref.artifact_id };
    },
    input.arc.id,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Stored plan: what the chapter loop reads
// ---------------------------------------------------------------------------------------------------------

export interface StoredStoryPlan {
  readonly spec_version: number;
  readonly intake_artifact_id: string;
  readonly spec_artifact_id: string;
  readonly concept_id: string;
  readonly bible_artifact_id: string;
  readonly blueprint_artifact_id: string;
  readonly target_chapters: number;
}

export async function loadStoredPlan(
  pool: Pool,
  projectId: string,
): Promise<
  | {
      plan: StoredStoryPlan;
      intake: StoryIntake;
      bible: StoryBible;
      blueprint: SeriesBlueprint;
    }
  | undefined
> {
  const project = await getProject(pool, projectId);
  const plan = project.settings.story_plan as StoredStoryPlan | undefined;
  if (!plan) return undefined;
  const [intake, bible, blueprint] = await Promise.all([
    getArtifactById(pool, plan.intake_artifact_id),
    getArtifactById(pool, plan.bible_artifact_id),
    getArtifactById(pool, plan.blueprint_artifact_id),
  ]);
  if (!intake || !bible || !blueprint)
    throw new WorkflowError(
      'INTERNAL',
      `project ${projectId} story plan references missing artifacts`,
      {
        step: 'init',
      },
    );
  return {
    plan,
    intake: validateIntake(intake.payload),
    bible: bible.payload as StoryBible,
    blueprint: blueprint.payload as SeriesBlueprint,
  };
}

// ---------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------

interface RawPromise {
  id?: unknown;
  type?: unknown;
  statement?: unknown;
  importance?: unknown;
  due_min_chapter?: unknown;
  due_max_chapter?: unknown;
  related_entity_names?: unknown;
  related_entity_ids?: unknown;
}

const PROMISE_TYPES = new Set([
  'foreshadowing',
  'mystery',
  'chekhov',
  'relationship_beat',
  'character_goal',
  'world_question',
  'running_gag',
  'threat',
  'debt',
  'red_herring',
]);

function normalizePromises(
  raw: readonly RawPromise[],
  projectId: string,
  resolve: (name: string | undefined) => string | undefined,
  targetChapters: number,
): StoryBible['promises'][number][] {
  const out: StoryBible['promises'][number][] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    const statement = str(p.statement);
    if (!statement || seen.has(statement.toLowerCase())) continue;
    seen.add(statement.toLowerCase());
    const names = Array.isArray(p.related_entity_names)
      ? p.related_entity_names.filter(isString)
      : [];
    const min = clampChapter(p.due_min_chapter, targetChapters);
    const max = clampChapter(p.due_max_chapter, targetChapters);
    out.push({
      id: planIds.promise(projectId, statement),
      type: PROMISE_TYPES.has(String(p.type)) ? String(p.type) : 'foreshadowing',
      statement,
      importance: ['core', 'major', 'minor'].includes(String(p.importance))
        ? (p.importance as 'core' | 'major' | 'minor')
        : 'major',
      ...(min !== undefined ? { due_min_chapter: min } : {}),
      ...(max !== undefined ? { due_max_chapter: Math.max(max, min ?? max) } : {}),
      related_entity_ids: dedupe(names.map(resolve).filter(isString)),
    });
  }
  return out;
}

function normalizeSeasons(
  raw: unknown,
  targetChapters: number,
  projectId: string,
): SeriesBlueprint['seasons'] {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  type Season = SeriesBlueprint['seasons'][number];
  const seasons: Season[] = [];
  let cursor = 1;
  for (const [i, s] of list.entries()) {
    const ordinal = i + 1;
    const range = (s.chapter_range_est ?? {}) as { from?: unknown; to?: unknown };
    let from = clampChapter(range.from, targetChapters) ?? cursor;
    if (from < cursor) from = cursor;
    let to = clampChapter(range.to, targetChapters) ?? targetChapters;
    if (to < from) to = from;
    if (from > targetChapters) break;
    seasons.push({
      id: planIds.season(projectId, ordinal),
      ordinal,
      title: str(s.title) ?? `Season ${ordinal}`,
      objective: str(s.objective) ?? '',
      ...(str(s.thesis) ? { thesis: str(s.thesis) } : {}),
      ...(str(s.entry_state) ? { entry_state: str(s.entry_state) } : {}),
      ...(str(s.exit_state) ? { exit_state: str(s.exit_state) } : {}),
      chapter_range_est: { from, to },
    } as SeriesBlueprint['seasons'][number]);
    cursor = to + 1;
  }
  // Fill gaps so every chapter 1..N belongs to exactly one season, whatever the model returned.
  if (seasons.length === 0)
    seasons.push({
      id: planIds.season(projectId, 1),
      ordinal: 1,
      title: 'Season 1',
      objective: 'The complete story as one season.',
      chapter_range_est: { from: 1, to: targetChapters },
    });
  const last = seasons[seasons.length - 1];
  if (last && last.chapter_range_est.to < targetChapters)
    seasons[seasons.length - 1] = {
      ...last,
      chapter_range_est: { from: last.chapter_range_est.from, to: targetChapters },
    };
  const [first, ...rest] = seasons;
  if (!first) throw new Error('unreachable: seasons is non-empty');
  return [first, ...rest];
}

function normalizeArc(
  raw: unknown,
  entityId: string,
  targetChapters: number,
): SeriesBlueprint['protagonist_arc'] {
  const a = (raw ?? {}) as Record<string, unknown>;
  const points = (Array.isArray(a.turning_points) ? a.turning_points : [])
    .map((m) => normalizeMilestone(m, targetChapters))
    .filter(isDefined);
  const [first, ...rest] = points;
  const turning: SeriesBlueprint['protagonist_arc']['turning_points'] = first
    ? [first, ...rest]
    : [
        {
          description: 'The midpoint reversal that redefines the protagonist’s goal.',
          window: { from: Math.max(1, Math.floor(targetChapters / 2)), to: targetChapters },
          status: 'planned',
        },
      ];
  return {
    entity_id: entityId,
    start_state: str(a.start_state) ?? 'as introduced in chapter 1',
    end_state: str(a.end_state) ?? 'as resolved in the final chapter',
    turning_points: turning,
  };
}

type Milestone = Generated.SeriesBlueprintSchema.Milestone;

function normalizeMilestone(raw: unknown, targetChapters: number): Milestone | undefined {
  const m = (raw ?? {}) as Record<string, unknown>;
  const description = str(m.description);
  if (!description) return undefined;
  const w = (m.window ?? {}) as { from?: unknown; to?: unknown };
  const from = clampChapter(w.from ?? m.chapter_from, targetChapters) ?? 1;
  const to = Math.max(from, clampChapter(w.to ?? m.chapter_to, targetChapters) ?? from);
  const id = str(m.id);
  return {
    ...(id !== undefined ? { id } : {}),
    description,
    window: { from, to },
    status: 'planned',
  };
}

function endingType(
  raw: unknown,
  preference: StoryIntake['ending_preference'],
): 'happy' | 'bittersweet' | 'open' | 'tragic' {
  const allowed = ['happy', 'bittersweet', 'open', 'tragic'] as const;
  if (preference && preference !== 'unspecified') return preference;
  return allowed.includes(raw as (typeof allowed)[number])
    ? (raw as (typeof allowed)[number])
    : 'happy';
}

function clampChapter(v: unknown, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(max, Math.round(n)));
}

function sketch(c: NonNullable<StoryIntake['main_character']>): string {
  return [
    c.name,
    c.role ? `(${c.role})` : '',
    c.description ?? '',
    c.speech_notes ? `Speech: ${c.speech_notes}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isDefined<T>(v: T | undefined): v is T {
  return v !== undefined;
}
function isUuidLike(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
}
function dedupe(xs: readonly string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}
/** Fact attribute segment: the schema pattern allows only `[a-z_]`, so digits are spelled out. */
function slug(s: string): string {
  const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const out = s
    .toLowerCase()
    .replace(/[0-9]/g, (d) => `_${digits[Number(d)] ?? ''}_`)
    .replace(/[^a-z_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return out || 'rule';
}

export function renderSpec(spec: StorySpec): string {
  return spec.items
    .map(
      (i) =>
        `- [${i.id}] (${i.kind}, ${i.category}${i.scope.level !== 'series' ? `, ${i.scope.level}` : ''}) ${i.text_en ?? i.text}`,
    )
    .join('\n');
}

export function renderBibleSummary(b: StoryBible): string {
  return [
    ...b.entities.map(
      (e) =>
        `- [${e.id}] ${e.display_name} (${e.type})${e.short_forms?.length ? ` a.k.a. ${e.short_forms.join(', ')}` : ''}${e.description ? `: ${e.description}` : ''}`,
    ),
    ...b.propositions.map(
      (p) =>
        `- proposition ${p.local_id}: ${p.statement} [${p.truth}${p.secret ? ', secret' : ''}]`,
    ),
  ].join('\n');
}

function renderBlueprint(b: SeriesBlueprint): string {
  return [
    `Story promise: ${b.story_promise}`,
    `Reader fantasy: ${b.reader_fantasy}`,
    `Main conflict: ${b.main_conflict}`,
    `Ending (${b.ending.type}): ${b.ending.summary ?? ''} Final state: ${b.ending.final_state_assertions.join('; ')}`,
    `Endgame requirements: ${b.endgame_requirements.map((r) => `[${r.id}] ${r.statement}`).join('; ') || '(none)'}`,
    `Seasons:`,
    ...b.seasons.map(
      (s) =>
        `  ${s.ordinal}. ${s.title} (ch.${s.chapter_range_est.from}–${s.chapter_range_est.to}): ${s.objective}${s.exit_state ? ` → ${s.exit_state}` : ''}`,
    ),
    `Protagonist arc: ${b.protagonist_arc.start_state} → ${b.protagonist_arc.end_state}; turning points: ${b.protagonist_arc.turning_points.map((t) => `${t.description} (ch.${t.window.from}–${t.window.to})`).join('; ')}`,
  ].join('\n');
}
