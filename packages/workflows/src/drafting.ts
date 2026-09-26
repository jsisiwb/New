/**
 * Drafting steps: the scene_writer Context Pack (built by @yeonjae/context, persisted with its manifest and
 * hash), a validated Scene Plan, sequential scene drafts through the gateway (Guard + output-language check on
 * every call), and deterministic assembly into one immutable working manuscript version.
 */
import { createHash } from 'node:crypto';
import {
  buildPack,
  PgLexicalRetriever,
  renderScenePlanKo,
  type ContextPack,
  type FetchOptions,
} from '@yeonjae/context';
import {
  createManuscriptVersion,
  manuscriptVersionsOf,
  setChapterStatus,
  type ManuscriptVersionRow,
} from '@yeonjae/db';
import {
  asUuid,
  type Generated,
  recordNormalization,
  uuidFromKey,
  validatorFor,
} from '@yeonjae/domain';
import {
  codePointLength,
  lintKoreanWebnovel,
  measure,
  paragraphPerLine,
  pronounThreshold,
  segmentParagraphs,
  sliceCodePoints,
  talkShareOf,
  targetCount,
  thirdPersonDrift,
  toNfcText,
} from '@yeonjae/prose';
import { type Issue } from './evaluation.js';
import { WorkflowError } from './errors.js';
import { calibrateSceneTarget } from './length-calibration.js';
import { chooseFallbackLocation, normalizeScenePlans } from './plan-normalize.js';
import { normalizeSceneDraft } from './anchoring.js';
import {
  type ChapterContract,
  type StoryBible,
  type StorySpec,
  compileFor,
  scheduleOf,
} from './planning.js';
import {
  bind,
  loadArtifact,
  modelCall,
  runStep,
  saveArtifact,
  type WorkflowContext,
} from './runtime.js';
import { applyDialogueFloor, isSoloScene } from './dialogue-floor.js';
import {
  checkPlanConsistency,
  cutNote,
  ensureCutBeat,
  lineTargetNote,
  soloLineTargetNote,
  renderPlanFeedback,
  renderScenesForCritic,
  sceneLineTargets,
  stripTalkBans,
  structureTargets,
  dedupeRepeatedLines,
  parsePlanCriticIssues,
  type PlanCriticIssue,
  type PlanFinding,
} from './plan-prevention.js';
import { renderRevealSchedule } from './reveal-schedule.js';
import { claimForKoreanNote } from './ladder.js';

export type ScenePlan = Generated.ScenePlanSchema.ScenePlan;
export type SceneDraft = Generated.SceneDraftSchema.SceneDraftWriterOutputEnvelope;

export interface PackRef {
  readonly pack_id: string;
  readonly pack_hash: string;
  readonly template: string;
  readonly canon_version: number;
  readonly stored: boolean;
}

export function packRef(pack: ContextPack, stored: boolean): PackRef {
  return {
    pack_id: pack.id,
    pack_hash: pack.hash,
    template: pack.template.name,
    canon_version: pack.manifest.pinned.canon_version ?? 0,
    stored,
  };
}

/**
 * The persisted shape of a pack (data architecture §8: manifest + hashes in `context_packs`, rendered text in
 * the artifact store). A resumed run reads this instead of rebuilding, so canon moving on after acceptance
 * cannot change what the recorded calls were bound to.
 */
export interface StoredPack {
  readonly id: string;
  readonly hash: string;
  readonly template: string;
  readonly role: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly manifest: ContextPack['manifest'];
  readonly narrativeIdentityRef: ContextPack['narrativeIdentityRef'];
  readonly renderedSystem: string;
  readonly renderedUser: string;
  /**
   * Rendered sections by name (ADR-0060), so an evaluator can read one section instead of the variable it
   * shares with others. Absent on packs checkpointed before ADR-0060.
   */
  readonly sections?: readonly { readonly name: string; readonly text: string }[] | undefined;
}

export function storedPack(pack: ContextPack): StoredPack {
  return {
    id: pack.id,
    hash: pack.hash,
    template: pack.template.name,
    role: pack.manifest.role,
    variables: pack.variables,
    manifest: pack.manifest,
    narrativeIdentityRef: pack.narrativeIdentityRef,
    renderedSystem: pack.renderedSystem,
    renderedUser: pack.renderedUser,
    sections: pack.sections.map((s) => ({ name: s.name, text: s.text })),
  };
}

/**
 * The text of the named sections of a stored pack, in pack order; `undefined` when the pack predates
 * section storage, `''` when it has none of them.
 */
export function packSections(pack: StoredPack, names: readonly string[]): string | undefined {
  if (!pack.sections) return undefined;
  return pack.sections
    .filter((s) => names.includes(s.name))
    .map((s) => s.text)
    .join('\n\n');
}

export interface BuiltPack {
  readonly pack: ContextPack;
  readonly ref: PackRef;
  readonly stored: StoredPack;
}

/** Build (and persist) a role pack for the chapter. Packs are pure functions of pinned inputs, so rebuilding on resume is safe. */
export async function buildRolePack(
  ctx: WorkflowContext,
  input: {
    role: string;
    contract: ChapterContract;
    spec: StorySpec;
    chapterText?: { versionId: string } | undefined;
    lexical?: boolean | undefined;
    /** ADR-0092 (G9-1): the reveal schedule's dates for the canon lines (`reveal_schedule.canon_lines`). */
    secretDates?: FetchOptions['secretDates'];
  },
): Promise<BuiltPack> {
  try {
    const { pack, stored } = await buildPack(ctx.pool, {
      projectId: ctx.projectId,
      role: input.role,
      contract: input.contract,
      spec: input.spec,
      policy: ctx.policy,
      identity: ctx.identity,
      promptSetId: ctx.pins.promptSetId,
      chapterText: input.chapterText,
      jobId: ctx.job.id,
      lexical:
        input.lexical === false
          ? undefined
          : new PgLexicalRetriever(ctx.pool, ctx.identity.outputLanguage.language ?? 'en'),
      persist: true,
      ...(input.secretDates ? { secretDates: input.secretDates } : {}),
    });
    return { pack, ref: packRef(pack, stored), stored: storedPack(pack) };
  } catch (err) {
    const e = err as { code?: string; detail?: string; data?: Record<string, unknown> };
    if (e.code === 'PREVIOUS_CHAPTER_NOT_ACCEPTED')
      throw new WorkflowError('PREVIOUS_CHAPTER_NOT_ACCEPTED', e.detail ?? String(err), {
        data: e.data,
        recommendedActions: ['retry_step'],
        cause: err,
      });
    if (e.code === 'PROHIBITED_SOURCE')
      throw new WorkflowError('NOT_EXTRACTABLE', e.detail ?? String(err), {
        data: e.data,
        cause: err,
      });
    if (typeof e.code === 'string')
      throw new WorkflowError('PACK_FAILED', e.detail ?? String(err), {
        data: { context_error: e.code, ...(e.data ?? {}) },
        recommendedActions: ['revalidate_contract'],
        cause: err,
      });
    throw err;
  }
}

/**
 * Build a pack once per (chapter, role, label) and checkpoint its rendered form as an artifact. A resumed run
 * loads the checkpointed pack instead of rebuilding, so the calls it replays stay bound to the same bytes even
 * after canon has moved on (e.g. after this very chapter was accepted).
 */
export async function checkpointPack(
  ctx: WorkflowContext,
  input: {
    label: string;
    role: string;
    contract: ChapterContract;
    spec: StorySpec;
    chapterText?: { versionId: string } | undefined;
    lexical?: boolean | undefined;
    secretDates?: FetchOptions['secretDates'];
  },
): Promise<{ stored: StoredPack; ref: PackRef }> {
  const ch = input.contract.chapter_number;
  const r = await runStep(
    ctx,
    'pack',
    async () => {
      const built = await buildRolePack(ctx, input);
      const art = await saveArtifact(ctx, {
        step: 'pack',
        kind: 'context_pack',
        key: `${ch}:${input.label}`,
        payload: built.stored,
      });
      return { ref: built.ref, artifact_id: art.artifact_id };
    },
    `${ch}:${input.label}`,
  );
  const stored = await loadArtifact<StoredPack>(ctx, r.artifact_id);
  return { stored, ref: r.ref };
}

export function packCallInput(pack: StoredPack) {
  return {
    id: pack.id,
    hash: pack.hash,
    tokenEstimate: pack.manifest.token_counts.total,
    narrativeIdentityRef: pack.narrativeIdentityRef
      ? {
          ...pack.narrativeIdentityRef,
          identityVersionId: asUuid(pack.narrativeIdentityRef.identityVersionId),
        }
      : undefined,
    variables: pack.variables,
  };
}

async function withFallbackLocation(
  ctx: WorkflowContext,
  contract: ChapterContract,
): Promise<ChapterContract> {
  if (contract.locations.length > 0) return contract;
  const registered = await ctx.pool.query<{
    id: string;
    display_name: string;
    aliases: string[];
    short_forms: string[];
  }>(
    `SELECT id, display_name, aliases, short_forms FROM entities
      WHERE project_id = $1 AND type = 'location' AND status = 'active' ORDER BY created_at, id`,
    [ctx.projectId],
  );
  const fallback = chooseFallbackLocation(registered.rows, JSON.stringify(contract));
  if (!fallback) return contract;
  recordNormalization('contract_location_fallback');
  return { ...contract, locations: [fallback.id] };
}

export async function planScenes(
  ctx: WorkflowContext,
  input: {
    contract: ChapterContract;
    pack: StoredPack;
    /** ADR-0086: the bible, for the reveal schedule and the plan critic (absent: neither runs). */
    bible?: StoryBible | undefined;
    nameOf?: ((id: string) => string) | undefined;
  },
): Promise<{ scenes: ScenePlan[]; artifactId: string }> {
  const ch = input.contract.chapter_number;
  return runStep(
    ctx,
    'scene_plan',
    async () => {
      // Live defect A-1 (ADR-0074): a contract locked before the contract-time fallback existed may name
      // no location; the scene plan then grounds its scenes in the registered location the contract's text
      // mentions (else the first one) instead of failing every scene.
      const contract = await withFallbackLocation(ctx, input.contract);
      // ADR-0086 (U1, U8): the scene planner reads the reveal schedule and, on a repair, the plan's findings.
      const nameOf = input.nameOf ?? ((id: string) => id);
      const schedule = scheduleOf(ctx, input.bible);
      const scheduleText = schedule
        ? renderRevealSchedule(schedule, ch, 'planner', {
            nameOf,
            hintBudget: ctx.policy.planning?.reveal_schedule?.hint_budget,
          })
        : undefined;
      const critic = ctx.policy.planning?.plan_critic;
      const planVars =
        schedule || critic
          ? {
              reveal_schedule: scheduleText ?? '(설정에 기록된 비밀 없음)',
              plan_feedback: '(없음)',
            }
          : {};
      const planOnce = async (feedback: string | undefined, suffix: string) => {
        const call = await modelCall<{ scenes?: unknown }>(ctx, {
          step: 'scene_plan',
          family: 'scene_planner',
          activityId: `scene_plan:${ch}${suffix}`,
          variables: {
            ...planVars,
            ...(feedback !== undefined ? { plan_feedback: feedback } : {}),
            previous_chapter_tail:
              input.pack.variables.previous_text ??
              (ctx.identity.outputLanguage.language === 'ko'
                ? `(${ch}화에는 직전 회차가 없다. 연재를 연다.)`
                : `(Chapter ${ch} has no previous chapter; open the series.)`),
          },
          pack: packCallInput(input.pack),
          block: compileFor(ctx, 'planner_compact'),
        });
        const raw = Array.isArray(call.output.scenes) ? call.output.scenes : undefined;
        if (!raw)
          throw new WorkflowError('SCENE_PLAN_INVALID', 'scene planner returned no scenes array', {
            step: 'scene_plan',
            recommendedActions: ['regenerate'],
          });
        const validate = validatorFor<ScenePlan>('scene-plan.schema.json');
        const check = (candidates: readonly unknown[]) => {
          const scenes: ScenePlan[] = [];
          const issues: string[] = [];
          candidates.forEach((s, i) => {
            const v = validate(s);
            if (!v.ok)
              issues.push(
                `scene ${i + 1}: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
              );
            else scenes.push(v.value);
          });
          return { scenes, issues };
        };
        let { scenes, issues } = check(raw);
        const lengthsOff = () => {
          const total = scenes.reduce((a, s) => a + s.length_target.value, 0);
          const tol = contract.length_target.tolerance_ratio ?? 0.12;
          return Math.abs(total / contract.length_target.value - 1) > tol;
        };
        // A live plan with near-miss shapes or unsummed lengths is grounded in the contract; a plan that
        // already validates (recorded fixtures) keeps its exact bytes.
        if (raw.length > 0 && (issues.length > 0 || lengthsOff())) {
          const retry = check(normalizeScenePlans(raw, { contract }));
          if (retry.issues.length === 0) {
            ({ scenes, issues } = retry);
            recordNormalization('scene_plans');
          }
        }
        // ADR-0073: a project with a chosen point of view writes every scene in it.
        const projectPov = ctx.identity.preferences?.pov;
        if (projectPov && issues.length === 0)
          scenes = scenes.map((s) =>
            s.pov.person === projectPov ? s : { ...s, pov: { ...s.pov, person: projectPov } },
          );
        if (issues.length === 0) {
          // The contract's scene count is a plan, not a gate: 1–5 grounded scenes are accepted.
          if (scenes.length < 1 || scenes.length > 5)
            issues.push(`contract wants ${contract.scene_count} scenes, plan has ${scenes.length}`);
          scenes.forEach((s, i) => {
            if (s.scene_no !== i + 1) issues.push(`scene ${i + 1} is numbered ${s.scene_no}`);
            if (!contract.participants.some((p) => p.character_id === s.pov.character_id))
              issues.push(`scene ${s.scene_no} POV is not a contract participant`);
            for (const p of s.participants)
              if (!contract.participants.some((c) => c.character_id === p))
                issues.push(`scene ${s.scene_no} participant ${p} is not in the contract`);
            if (!contract.locations.includes(s.location_id))
              issues.push(`scene ${s.scene_no} location is not in the contract`);
          });
          const total = scenes.reduce((a, s) => a + s.length_target.value, 0);
          const target = contract.length_target.value;
          const tol = contract.length_target.tolerance_ratio ?? 0.12;
          if (Math.abs(total / target - 1) > tol)
            issues.push(
              `scene length targets sum to ${total}, chapter target is ${target} ${contract.length_target.unit} (±${tol * 100}%)`,
            );
        }
        return { scenes, issues };
      };
      const firstPlan = await planOnce(undefined, '');
      let scenes = firstPlan.scenes;
      const issues = firstPlan.issues;
      if (issues.length > 0)
        throw new WorkflowError('SCENE_PLAN_INVALID', issues.join('; '), {
          step: 'scene_plan',
          data: { issues },
          recommendedActions: ['regenerate'],
        });
      // ADR-0084 (U6): enough planned talk and someone to talk to, under a policy that opts in.
      const floor = ctx.policy.planning?.dialogue_floor;
      const planFindings: PlanFinding[] = [];
      const repairDeterministic = (planned: ScenePlan[]) => {
        let out = planned;
        const floored = floor ? applyDialogueFloor(out, contract, floor) : undefined;
        if (floored) {
          out = floored.scenes;
          for (const f of floored.findings)
            if (f.repaired)
              recordNormalization(f.rule === 'PLAN-DLG-01' ? 'dialogue_floor' : 'dialogue_partner');
        }
        // ADR-0086 (G5-2, G5-5): no scene line forbids talking; the final scene's last beat is the cut.
        if (floor?.strip_talk_bans) {
          const stripped = stripTalkBans(out);
          out = stripped.scenes;
          planFindings.push(...stripped.findings);
          if (stripped.findings.length) recordNormalization('plan_talk_ban');
        }
        if (ctx.policy.planning?.cut_design) {
          const cut = ensureCutBeat(contract, out);
          out = cut.scenes;
          planFindings.push(...cut.findings);
          if (cut.findings.length) recordNormalization('plan_cut_beat');
        }
        return { scenes: out, floored };
      };
      let repaired = repairDeterministic(scenes);
      scenes = repaired.scenes;
      const floored = repaired.floored;
      // ADR-0086 (U7, U8): the plan is checked before any drafting call; serious findings go back to the planner.
      let criticIssues: PlanCriticIssue[] = [];
      if (critic) {
        const deterministic = checkPlanConsistency(contract, scenes, {
          cutDesign: ctx.policy.planning?.cut_design,
          partnerRequired: floor?.partner_in_contract,
        });
        criticIssues = await runPlanCritic(ctx, {
          chapterNo: ch,
          contract,
          scenes,
          pack: input.pack,
          nameOf,
          scheduleText,
        });
        planFindings.push(...deterministic);
        let serious: { target: string; message: string; fix?: string }[] = [
          ...deterministic.filter((f) => f.severity !== 'minor' && !f.repaired),
          ...criticIssues
            .filter((i) => i.severity !== 'minor' && !i.target.includes('계약'))
            .map((i) => ({ target: i.target, message: i.claim, fix: i.fix })),
        ];
        for (let attempt = 1; attempt <= critic.max_repairs && serious.length > 0; attempt++) {
          const retry = await planOnce(renderPlanFeedback(serious), `:repair${String(attempt)}`);
          if (retry.issues.length > 0) break;
          repaired = repairDeterministic(retry.scenes);
          scenes = repaired.scenes;
          const again = checkPlanConsistency(contract, scenes, {
            cutDesign: ctx.policy.planning?.cut_design,
            partnerRequired: floor?.partner_in_contract,
          });
          planFindings.push({
            rule: 'PLAN-REPAIR',
            severity: 'minor',
            target: '장면 설계',
            message: `결함 ${String(serious.length)}개로 장면 설계를 다시 받았다(${String(attempt)}회차)`,
            repaired: true,
          });
          serious = again
            .filter((f) => f.severity !== 'minor' && !f.repaired)
            .map((f) => ({ target: f.target, message: f.message }));
          recordNormalization('plan_repair');
        }
      }
      const ref = await saveArtifact(ctx, {
        step: 'scene_plan',
        kind: 'scene_plan',
        key: `${ch}:v${contract.version}`,
        payload: {
          chapter_no: ch,
          contract_id: contract.id,
          scenes,
          ...(floored?.findings.length ? { dialogue_floor: floored.findings } : {}),
          ...(planFindings.length ? { plan_findings: planFindings } : {}),
          ...(criticIssues.length ? { plan_critic: criticIssues } : {}),
        },
      });
      return { scenes, artifactId: ref.artifact_id };
    },
    String(ch),
  );
}

/** ADR-0086 (U8): the pre-flight plan critic over the contract and scene plans; malformed items are dropped. */
async function runPlanCritic(
  ctx: WorkflowContext,
  input: {
    chapterNo: number;
    contract: ChapterContract;
    scenes: readonly ScenePlan[];
    pack: StoredPack;
    nameOf: (id: string) => string;
    scheduleText: string | undefined;
  },
): Promise<PlanCriticIssue[]> {
  const call = await modelCall<{ issues?: unknown }>(ctx, {
    step: 'scene_plan',
    family: 'plan_critic',
    activityId: `plan_critic:${String(input.chapterNo)}`,
    variables: {
      scene_plans: renderScenesForCritic(input.scenes, input.nameOf),
      reveal_schedule: input.scheduleText ?? '(설정에 기록된 비밀 없음)',
      structure_targets: structureTargets({
        chapterNo: input.chapterNo,
        lineTargets: ctx.policy.planning?.dialogue_floor?.line_targets,
        lengthTarget: input.contract.length_target.value,
        plannerVoice: ctx.identity.preferences?.operator_voice?.planner,
      }),
    },
    pack: packCallInput(input.pack),
  });
  return parsePlanCriticIssues(call.output.issues);
}

export interface SceneDraftRef {
  readonly scene_no: number;
  readonly artifact_id: string;
  readonly content_hash: string;
  readonly llm_call_id: string;
  readonly words: number;
  /**
   * 자: characters with spaces, without line breaks — the Korean platform unit (ADR-0059). Absent on
   * checkpoints written before ADR-0059.
   */
  readonly characters?: number;
  /**
   * ADR-0075 (K3): the length the writer was asked for under `length.scene_calibration`, in the plan's unit.
   * Absent when the policy does not calibrate (the writer was asked for the plan's target).
   */
  readonly requested_length?: number;
  /** The manuscript-language check's confidence, whatever the language. */
  readonly language_confidence: number | undefined;
  /** @deprecated Kept for checkpoints written before ADR-0059; read `language_confidence`. */
  readonly english_confidence: number | undefined;
}

/** Sequential drafting: scene k sees the verbatim text of scenes 1..k−1 (job-scoped, never a stored draft). */
export async function draftScenes(
  ctx: WorkflowContext,
  input: {
    contract: ChapterContract;
    pack: StoredPack;
    scenes: readonly ScenePlan[];
    /** Registry names; with them a Korean writer under `scene_plan_format: labelled` reads the plan as text. */
    nameOf?: ((id: string) => string) | undefined;
    /**
     * ADR-0084 (U1): the secrets the reader must not learn yet, as the knowledge-leak checker lists them;
     * appended to every scene plan the writer reads under `drafting.reader_secrets_in_plan`.
     */
    readerSecrets?: string | undefined;
    /** ADR-0086: the bible, for the reveal schedule the writer reads under `planning.reveal_schedule`. */
    bible?: StoryBible | undefined;
  },
): Promise<{ drafts: SceneDraftRef[]; texts: string[] }> {
  const ch = input.contract.chapter_number;
  // ADR-0068: labelled Korean text instead of the plan object, only where the pinned policy says so.
  const nameOf = input.nameOf;
  const ko = ctx.identity.outputLanguage.language === 'ko';
  const secretsNote = input.readerSecrets?.trim()
    ? ko
      ? `\n\n독자에게 아직 밝히지 않는 비밀 (서술, 속마음, 대사 어디에서도 말하거나 암시하지 않는다):\n${input.readerSecrets.trim()}`
      : `\n\nSecrets the reader must not learn yet (never state or hint them in narration, thought or dialogue):\n${input.readerSecrets.trim()}`
    : '';
  // ADR-0086 (U1): under a reveal schedule the writer reads what the reader knows, what it may only hint at, and
  // that the hero thinks with prior-life and source-work knowledge — the same schedule the checker reads.
  const schedule = scheduleOf(ctx, input.bible);
  const scheduleNote = schedule
    ? `\n\n[공개 일정]\n${
        renderRevealSchedule(schedule, ch, 'writer', {
          nameOf,
          hintBudget: ctx.policy.planning?.reveal_schedule?.hint_budget,
        }) ?? ''
      }`
    : undefined;
  // ADR-0086 (G5-2, G5-5): countable talk targets per scene and the cut as the last scene's end.
  const lineTargets = ctx.policy.planning?.dialogue_floor?.line_targets;
  // ADR-0110 (G7-4): a scene with no one to talk to gets no quoted-line quota.
  const soloScenes = ctx.policy.planning?.dialogue_floor?.solo_scenes === true;
  const chapterLines = lineTargets
    ? sceneLineTargets(
        {
          dialogue_density_target: input.contract.dialogue_density_target,
          length_target: input.contract.length_target,
        },
        lineTargets,
      )
    : undefined;
  const planNotes = (planned: ScenePlan) => {
    let note = '';
    if (lineTargets)
      note +=
        soloScenes && isSoloScene(planned)
          ? soloLineTargetNote(sceneLineTargets(planned, lineTargets))
          : lineTargetNote(
              sceneLineTargets(planned, lineTargets),
              planned.participants
                .filter((p) => p !== planned.pov.character_id)
                .map((p) => (nameOf ? nameOf(p) : p)),
              chapterLines,
            );
    if (ctx.policy.planning?.cut_design && planned.scene_no === input.scenes.length)
      note += cutNote(input.contract);
    return note;
  };
  const renderPlan = (scene: ScenePlan, planned: ScenePlan) =>
    (ctx.policy.planning?.scene_plan_format === 'labelled' && ko && nameOf
      ? renderScenePlanKo(scene, nameOf)
      : JSON.stringify(scene)) +
    (scheduleNote ?? secretsNote) +
    planNotes(planned);
  const texts: string[] = [];
  const drafts: SceneDraftRef[] = [];
  const calibration = ctx.policy.length.scene_calibration;
  const targets = input.scenes.map((s) => s.length_target.value);
  for (const [index, planned] of input.scenes.entries()) {
    // ADR-0075: only what the writer is asked for changes; the stored plan and the gate keep the target.
    const requested = calibration
      ? calibrateSceneTarget(
          targets,
          index,
          texts.map((t, i) =>
            targetCount(measure(toNfcText(t)), input.scenes[i]?.length_target.unit ?? 'words'),
          ),
          calibration,
        ).requested
      : undefined;
    const scene: ScenePlan =
      requested === undefined
        ? planned
        : { ...planned, length_target: { ...planned.length_target, value: requested } };
    const previous = texts.length
      ? texts.join('\n\n')
      : (input.pack.variables.previous_text ??
        (ctx.identity.outputLanguage.language === 'ko'
          ? `(${ch}화가 연재를 연다. 앞에 이어지는 원고가 없다.)`
          : `(Chapter ${ch} opens the series; nothing precedes it.)`));
    const ref = await runStep(
      ctx,
      'scene_draft',
      async () => {
        const variables = {
          scene_plan: renderPlan(scene, planned),
          scene_no: String(scene.scene_no),
          previous_text: previous,
          length_target_words: String(scene.length_target.value),
          // Where this scene sits in the episode curve (v4 writers close only the LAST scene on the 절단).
          scene_total: String(input.scenes.length),
          scene_role: sceneRole(
            scene.scene_no,
            input.scenes.length,
            ctx.identity.outputLanguage.language ?? 'en',
          ),
        };
        const writeScene = (vars: typeof variables, activityId: string) =>
          modelCall<SceneDraft | string>(ctx, {
            step: 'scene_draft',
            family: 'scene_writer',
            activityId,
            variables: vars,
            pack: packCallInput(input.pack),
          });
        let call = await writeScene(variables, `scene_draft:${ch}:${scene.scene_no}`);
        // A prose-only (text-mode) writer answers with the manuscript itself; the envelope is built here
        // deterministically. A recorded (or well-formed) JSON draft is taken verbatim; a live draft whose
        // offsets or paragraph table disagree with its own prose is normalized from the prose.
        // ADR-0081: under `drafting.paragraph_per_line` every line of a prose draft is its own paragraph.
        let prose = call.output;
        if (typeof prose === 'string' && ctx.policy.drafting?.paragraph_per_line) {
          const perLine = paragraphPerLine(prose);
          if (perLine !== prose.trim()) recordNormalization('paragraph_per_line');
          prose = perLine;
        }
        // ADR-0084 (U6): a scene with someone to talk to that came back far below the talk band is
        // re-drafted once with its measured share; the redraft is kept only when it talks more.
        const redraftBelow = ctx.policy.planning?.dialogue_floor?.scene_redraft_below;
        // ADR-0086 (G5-2): relative to the scene's own plan too — a scene planned at 45 % that returns 26 % redrafts.
        const redraftRatio = ctx.policy.planning?.dialogue_floor?.scene_redraft_ratio;
        const plannedShare = scene.dialogue_density_target;
        const redraftAt = Math.max(
          redraftBelow ?? 0,
          redraftRatio !== undefined && plannedShare !== undefined
            ? redraftRatio * plannedShare
            : 0,
        );
        if (
          (redraftBelow !== undefined || redraftRatio !== undefined) &&
          typeof prose === 'string' &&
          scene.participants.some((p) => p !== scene.pov.character_id)
        ) {
          const measured = sceneTalkShare(prose);
          if (measured < redraftAt) {
            const retry = await writeScene(
              {
                ...variables,
                scene_plan:
                  variables.scene_plan +
                  talkRedraftNote(measured, scene.dialogue_density_target ?? redraftAt, ko),
              },
              `scene_draft:${ch}:${scene.scene_no}:talk`,
            );
            let again = retry.output;
            if (typeof again === 'string' && ctx.policy.drafting?.paragraph_per_line)
              again = paragraphPerLine(again);
            if (typeof again === 'string' && sceneTalkShare(again) > measured) {
              prose = again;
              call = retry;
              recordNormalization('dialogue_redraft');
            }
          }
        }
        // ADR-0090 (G8-5): a first-person scene that came back narrated in the third person is re-drafted once
        // with its measure; the redraft is kept only when it no longer drifts.
        const povNames =
          ko && scene.pov.person === 'first'
            ? povNamesOf(input.bible, ctx, scene.pov.character_id)
            : [];
        if (
          ctx.policy.drafting?.pov_redraft === true &&
          typeof prose === 'string' &&
          povNames.length > 0
        ) {
          const drift = thirdPersonDrift(prose, povNames);
          if (drift.drifted) {
            const retry = await writeScene(
              {
                ...variables,
                scene_plan: variables.scene_plan + povRedraftNote(drift, povNames[0] ?? ''),
              },
              `scene_draft:${ch}:${scene.scene_no}:pov`,
            );
            let again = retry.output;
            if (typeof again === 'string' && ctx.policy.drafting.paragraph_per_line)
              again = paragraphPerLine(again);
            if (typeof again === 'string' && !thirdPersonDrift(again, povNames).drifted) {
              prose = again;
              call = retry;
              recordNormalization('pov_redraft');
            }
          }
        }
        // ADR-0097 (G14-1): a Korean scene at or above the language layer's pronoun warn line (the operator's p90)
        // is re-drafted once with its measure; the redraft is kept only when its rate is lower.
        const pronounLine = ko
          ? pronounThreshold(
              ctx.identity.outputLanguage.lint_thresholds,
              ctx.identity.preferences?.pov,
            )
          : undefined;
        if (
          ctx.policy.drafting?.pronoun_redraft === true &&
          typeof prose === 'string' &&
          pronounLine
        ) {
          const rateOf = (t: string) =>
            lintKoreanWebnovel(t, {
              thresholds: ctx.identity.outputLanguage.lint_thresholds,
              pov: ctx.identity.preferences?.pov,
            }).metrics.pronoun_per_1k;
          const measured = rateOf(prose);
          if (measured >= pronounLine.warn) {
            const retry = await writeScene(
              {
                ...variables,
                scene_plan: variables.scene_plan + pronounRedraftNote(measured, pronounLine.warn),
              },
              `scene_draft:${ch}:${scene.scene_no}:pronoun`,
            );
            let again = retry.output;
            if (typeof again === 'string' && ctx.policy.drafting.paragraph_per_line)
              again = paragraphPerLine(again);
            if (typeof again === 'string' && rateOf(again) < measured) {
              prose = again;
              call = retry;
              recordNormalization('pronoun_redraft');
            }
          }
        }
        const draft =
          typeof prose === 'string'
            ? validateSceneDraft(
                normalizeSceneDraft(
                  proseEnvelope(
                    prose,
                    scene.scene_no,
                    ctx.identity.outputLanguage.language ?? 'en',
                  ),
                ),
                scene.scene_no,
              )
            : validateOrNormalizeSceneDraft(prose, scene.scene_no);
        const ref = await saveArtifact(ctx, {
          step: 'scene_draft',
          kind: 'scene_draft',
          key: `${ch}:${scene.scene_no}`,
          schema: 'scene-draft.schema.json',
          payload: draft,
        });
        const out: SceneDraftRef = {
          scene_no: scene.scene_no,
          artifact_id: ref.artifact_id,
          content_hash: ref.content_hash,
          llm_call_id: call.llmCallId,
          words: toNfcText(draft.text).text.split(/\s+/).filter(Boolean).length,
          characters: measure(toNfcText(draft.text)).characters,
          ...(requested !== undefined ? { requested_length: requested } : {}),
          language_confidence: call.outputLanguageCheck?.performed
            ? call.outputLanguageCheck.englishConfidence
            : undefined,
          english_confidence: call.outputLanguageCheck?.performed
            ? call.outputLanguageCheck.englishConfidence
            : undefined,
        };
        return out;
      },
      `${ch}:${scene.scene_no}`,
    );
    const draft = await loadArtifact<SceneDraft>(ctx, ref.artifact_id);
    drafts.push(ref);
    texts.push(toNfcText(draft.text).text);
  }
  return { drafts, texts };
}

/**
 * The scene's place in the episode curve, in the manuscript language. A Korean webnovel episode opens on a
 * hook, builds, and closes ONLY at its end on the 절단; a middle scene that wraps itself up with a reflective
 * closing line is the Western/AI habit the tradition contract forbids.
 */
export function sceneRole(sceneNo: number, total: number, language: string): string {
  if (language !== 'ko') {
    if (total <= 1) return 'single scene: open on the hook, close on the chapter-ending hook';
    if (sceneNo === 1)
      return 'first scene: open on the hook; end mid-tension, pushing into the next scene';
    if (sceneNo === total)
      return 'last scene: build to the payoff, then close on the chapter-ending hook';
    return 'middle scene: escalate; end mid-tension, pushing into the next scene';
  }
  if (total <= 1)
    return '단독 장면 — 첫 세 문장 안에 훅을 걸고, 이번 화의 보상을 터뜨린 뒤 절단으로 끝낸다.';
  if (sceneNo === 1)
    return `첫 장면(1/${String(total)}) — 첫 세 문장 안에 훅을 건다. 장면을 정리하거나 교훈으로 닫지 말고, 다음 장면으로 밀어 넣는 긴장 속에서 끊는다.`;
  if (sceneNo === total)
    return `마지막 장면(${String(total)}/${String(total)}) — 이번 화의 보상(사이다·폭로·감정·성장·웃음)을 터뜨리고, 계약의 절단(hook)으로 끝낸다. 마지막 한두 줄은 한 줄 문단으로, 요약·관조·하루 마무리 금지.`;
  return `중간 장면(${String(sceneNo)}/${String(total)}) — 갈등을 한 칸 키운다. 장면을 정리하지 말고, 다음 장면으로 이어지는 긴장 속에서 끊는다.`;
}

const LEAD_CHATTER =
  /^(물론(이죠|입니다)?|네[,.!]|좋습니다|알겠습니다|다음은|아래는|요청하신|여기\s?있습니다|Sure|Here is|Here's)[^\n]*\n+/u;
const TRAIL_CHATTER =
  /\n+(필요하시면|원하시면|수정이 필요하|더 (길게|짧게)|다른 버전|이상입니다|Let me know)[^\n]*$/u;

/** Strip the assistant chatter a chat model wraps around prose (fences, preambles, sign-offs, labels). */
export function stripProseChatter(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n').trim();
  for (let i = 0; i < 2; i++) t = t.replace(LEAD_CHATTER, '').trim();
  t = t.replace(TRAIL_CHATTER, '').trim();
  // A fenced answer: keep what is inside the fence.
  t = t
    .replace(/^```[a-zA-Z]*\n/u, '')
    .replace(/\n```$/u, '')
    .trim();
  // Scene/chapter labels and horizontal rules at the edges are not manuscript.
  t = t
    // (Only unmistakable labels: a bare "3화. …" first line can be narration, so it stays.)
    .replace(
      /^(\[장면\s*\d+[^\n\]]*\]|장면\s*\d+\s*[:：]|【[^\n】]*】|제\s?\d+\s?화[^\n]*|#{1,6}\s[^\n]*|-{3,}|\*{3,})\n+/u,
      '',
    )
    .replace(/\n+(-{3,}|\*{3,}|〔끝〕|\(끝\)|끝\.?)$/u, '')
    .trim();
  return t;
}

/**
 * Korean manuscripts use “ ” for dialogue and ‘ ’ for inner speech (the writer's output contract), but a
 * live model switches to ASCII quotes between scenes and a reviser retypes them. Pair ASCII marks line by
 * line into the typographic ones; a line with an odd count is ambiguous and left as it is. Korean prose
 * has no apostrophes, and the replacement is one code point for one.
 */
export function koQuoteMarks(text: string): string {
  return text
    .split('\n')
    .map((line) => pairMarks(pairMarks(line, '"', '“', '”'), "'", '‘', '’'))
    .join('\n');
}

function pairMarks(line: string, mark: '"' | "'", open: string, close: string): string {
  const count = line.split(mark).length - 1;
  if (count === 0 || count % 2 !== 0) return line;
  let n = 0;
  return line.replaceAll(mark, () => (n++ % 2 === 0 ? open : close));
}

/**
 * Build the writer-output envelope from bare prose. A model that ignored text mode and answered with the
 * JSON envelope anyway is unwrapped rather than stored as JSON-looking manuscript.
 */
export function proseEnvelope(
  raw: string,
  sceneNo: number,
  language: string,
): {
  scene_no: number;
  language: 'ko' | 'en';
  text: string;
  paragraphs: never[];
  speaker_annotations: never[];
  claims: never[];
} {
  let text = stripProseChatter(raw);
  if (looksStructured(text)) {
    // A structured answer is either a complete envelope carrying the prose, or a fault (truncated or
    // malformed JSON). A fault fails closed: JSON-looking text must never be stored as manuscript.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const inner = (parsed as { text?: unknown } | undefined)?.text;
    if (typeof inner !== 'string')
      throw new WorkflowError(
        'SCENE_DRAFT_INVALID',
        'the prose writer returned malformed or truncated structured output instead of prose',
        { step: 'scene_draft', recommendedActions: ['regenerate'] },
      );
    text = stripProseChatter(inner);
  }
  if (text.trim().length === 0)
    throw new WorkflowError('SCENE_DRAFT_INVALID', 'the prose writer returned no manuscript text', {
      step: 'scene_draft',
      recommendedActions: ['regenerate'],
    });
  if (language === 'ko') text = koQuoteMarks(text);
  return {
    scene_no: sceneNo,
    language: language === 'ko' ? 'ko' : 'en',
    text,
    paragraphs: [],
    speaker_annotations: [],
    claims: [],
  };
}

/**
 * `{` always opens structured output. `[` does only when the text is JSON or its first line is not a closed
 * bracket label: a Korean scene may open on a status window (`[이안 하르트]`, `[생존 카운트: 72시간]`), and
 * the first live v4.1.0 scene did, while a truncated array (`[1, 2`) still fails closed.
 */
function looksStructured(text: string): boolean {
  if (text.startsWith('{')) return true;
  if (!text.startsWith('[')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return !/^\[[^\]\n]+\]/.test(text);
  }
}

export function validateSceneDraft(raw: unknown, expectedSceneNo: number): SceneDraft {
  return validateSceneDraftStrict(raw, expectedSceneNo);
}

export function validateOrNormalizeSceneDraft(raw: unknown, expectedSceneNo: number): SceneDraft {
  try {
    return validateSceneDraftStrict(raw, expectedSceneNo);
  } catch (err) {
    if (!(err instanceof WorkflowError) || typeof raw !== 'object' || raw === null) throw err;
    const normalized = normalizeSceneDraft({
      ...(raw as { text: string }),
      scene_no: expectedSceneNo,
    });
    const valid = validateSceneDraftStrict(normalized, expectedSceneNo);
    recordNormalization('scene_draft');
    return valid;
  }
}

function validateSceneDraftStrict(raw: unknown, expectedSceneNo: number): SceneDraft {
  const v = validatorFor<SceneDraft>('scene-draft.schema.json')(raw);
  if (!v.ok)
    throw new WorkflowError(
      'SCENE_DRAFT_INVALID',
      v.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
      { step: 'scene_draft', recommendedActions: ['regenerate'] },
    );
  const d = v.value;
  const issues: string[] = [];
  if (d.scene_no !== expectedSceneNo) issues.push(`scene_no ${d.scene_no} ≠ ${expectedSceneNo}`);
  const nfc = toNfcText(d.text);
  const len = codePointLength(nfc.text);
  if (nfc.text.trim().length === 0) issues.push('empty text');
  for (const p of d.paragraphs)
    if (p.start >= p.end || p.end > len)
      issues.push(
        `paragraph ${p.id} span ${p.start}–${p.end} is outside the text (${len} code points)`,
      );
  for (const s of d.speaker_annotations)
    if (s.utterance_start >= s.utterance_end || s.utterance_end > len)
      issues.push(`utterance ${s.utterance_start}–${s.utterance_end} is outside the text`);
  const ids = new Set(d.paragraphs.map((p: { id: string }) => p.id));
  for (const c of d.claims)
    if (!ids.has(c.paragraph_id)) issues.push(`claim cites unknown paragraph ${c.paragraph_id}`);
  if (/[#*_]{2}|^#{1,6}\s/m.test(nfc.text)) issues.push('markdown formatting inside prose');
  if (issues.length > 0)
    throw new WorkflowError('SCENE_DRAFT_INVALID', issues.join('; '), {
      step: 'scene_draft',
      data: { issues },
      recommendedActions: ['regenerate'],
    });
  return d;
}

/** Deterministic assembly: scenes joined by a blank line; one immutable working version per assembled text. */
export async function assembleChapter(
  ctx: WorkflowContext,
  input: {
    chapterId: string;
    chapterNo: number;
    texts: readonly string[];
    drafts: readonly SceneDraftRef[];
  },
): Promise<{ version: ManuscriptVersionRow; created: boolean }> {
  return runStep(
    ctx,
    'assemble',
    async () => {
      let text = toNfcText(input.texts.map((t) => t.trim()).join('\n\n')).text;
      // ADR-0088 (G6-3): a line the writer repeated word for word right after itself is a glitch, not a beat.
      if (ctx.policy.drafting?.dedupe_repeated_lines) {
        const deduped = dedupeRepeatedLines(text);
        if (deduped.removed > 0) {
          text = deduped.text;
          recordNormalization('repeated_line');
        }
      }
      const paragraphs = segmentParagraphs(toNfcText(text));
      if (paragraphs.length === 0)
        throw new WorkflowError('SCENE_DRAFT_INVALID', 'assembled chapter is empty', {
          step: 'assemble',
        });
      // Idempotent against a crash between insert and checkpoint: an assembled version with these bytes is reused.
      const existing = (await manuscriptVersionsOf(ctx.pool, input.chapterId)).find(
        (v) => v.origin === 'assembled' && v.content_hash === contentHashOf(text),
      );
      if (existing) {
        const row = await ctx.pool.query<ManuscriptVersionRow>(
          'SELECT * FROM manuscript_versions WHERE id = $1',
          [existing.id],
        );
        const version = row.rows[0];
        if (!version)
          throw new WorkflowError('INTERNAL', 'assembled version vanished', { step: 'assemble' });
        await bind(ctx, { [`version.${input.chapterNo}.round0`]: version.id });
        return { version, created: false };
      }
      await setChapterStatus(ctx.pool, input.chapterId, 'drafting');
      const version = await createManuscriptVersion(ctx.pool, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        chapterId: input.chapterId,
        origin: 'assembled',
        text,
        createdByJobId: ctx.job.id,
      });
      await setChapterStatus(ctx.pool, input.chapterId, 'drafted');
      await bind(ctx, { [`version.${input.chapterNo}.round0`]: version.id });
      await saveArtifact(ctx, {
        step: 'assemble',
        kind: 'assembly',
        key: `${input.chapterNo}:${version.id}`,
        payload: {
          manuscript_version_id: version.id,
          version_no: version.version_no,
          content_hash: version.content_hash,
          scenes: input.drafts,
          paragraphs: paragraphs.length,
        },
      });
      return { version, created: true };
    },
    String(input.chapterNo),
  );
}

export function contentHashOf(text: string): string {
  return `sha256:${createHash('sha256').update(toNfcText(text).text, 'utf8').digest('hex')}`;
}

/** Dialogue plus 속마음 as a share of a scene's characters (line breaks not counted), as the lint measures. */
export function sceneTalkShare(prose: string): number {
  return talkShareOf(prose, codePointLength(prose.replace(/\n/g, '')));
}

/** The note a scene redraft carries (ADR-0084): the measured share, the target, and what to change. */
/** The POV character's registry names (display name, short forms, aliases), by bible or bound canon id. */
export function povNamesOf(
  bible: StoryBible | undefined,
  ctx: Pick<WorkflowContext, 'bindings'>,
  characterId: string,
): string[] {
  const e = bible?.entities.find((x) => x.id === characterId || ctx.bindings[x.id] === characterId);
  if (!e) return [];
  return [e.display_name, ...(e.short_forms ?? []), ...(e.aliases ?? [])].filter(
    (n): n is string => typeof n === 'string' && n.trim() !== '',
  );
}

/** ADR-0090 (G8-5): the POV redraft instruction, with the measure that triggered it. */
export function povRedraftNote(
  drift: { firstPerson: number; named: number },
  name: string,
): string {
  return `\n\n시점 다시 쓰기: 이 장면은 1인칭이다. 서술자는 ${name} 자신이고 서술에서 자신을 ‘나’로 부른다. 직전 초고는 서술에서 ‘${name}’을 ${String(drift.named)}번 3인칭으로 불렀고 ‘나’는 ${String(drift.firstPerson)}번뿐이었다. 사건·비트·대사는 그대로 두고 서술만 1인칭으로 쓴다.`;
}

export function talkRedraftNote(measured: number, target: number, ko: boolean): string {
  const pct = (x: number) => String(Math.round(x * 100));
  return ko
    ? `\n\n다시 쓰기: 직전 초고는 대사와 속마음이 글자 수의 ${pct(measured)}%뿐이었다(목표 약 ${pct(target)}%). 같은 사건과 비트를 지키되, 무대에 있는 인물끼리 주고받는 대사로 장면을 밀고, 서술은 대사 사이의 한 줄 비트로 줄인다.`
    : `\n\nRewrite: the previous draft had only ${pct(measured)}% dialogue and thought (target about ${pct(target)}%). Keep the same events and beats; drive the scene with lines between the characters on stage and cut narration to one-line beats between them.`;
}

/** ADR-0097 (G14-1): the pronoun redraft instruction, with the measure that triggered it. */
export function pronounRedraftNote(ratePer1k: number, warn: number): string {
  return `\n\n대명사 다시 쓰기: 직전 초고는 ‘그/그녀’가 1,000자에 ${String(ratePer1k)}번이었다(운영자 원고의 경고선 ${String(warn)}). 서술의 ‘그는·그녀는·그녀의’를 인물의 이름이나 호칭으로 바꾸거나 주어를 생략한다. 사건·비트·대사는 그대로 둔다.`;
}

/**
 * ADR-0087 (STEP 3): the scene-rewrite rung of the escalation ladder. A finding kind that patches rarely repair
 * (the per-kind fix rates: pacing, exposition) is answered by drafting its scene again from the same scene plan,
 * with the findings and the scene's measured talk share, and the new scene replacing the old one in the current
 * version. The result is a revision of scope `scene` that the loop evaluates and regression-checks like a patch.
 */
export async function rewriteScene(
  ctx: WorkflowContext,
  input: {
    version: ManuscriptVersionRow;
    chapterId: string;
    chapterNo: number;
    round: number;
    contract: ChapterContract;
    pack: StoredPack;
    scene: ScenePlan;
    sceneTotal: number;
    /** The scene's code-point range in the current version. */
    range: { start: number; end: number };
    findings: readonly { id: string; claim: string; dimension: Issue['dimension'] }[];
    dimension: Issue['dimension'];
    nameOf?: ((id: string) => string) | undefined;
    /** ADR-0092 (G9-5): why the previous attempt on this parent was quarantined, for the writer's note. */
    rejected?: readonly string[] | undefined;
    /** ADR-0092 (G9-7): run the drafting pass's deterministic checks on the rewrite (`ladder.rewrite_checks`). */
    checks?: { readonly bible?: StoryBible | undefined } | undefined;
    /** ADR-0093 (G10-3): the scene is rewritten for the chapter's length — its target and its current length in 자. */
    lengthTarget?: { readonly target: number; readonly previous: number } | undefined;
  },
): Promise<{
  version: ManuscriptVersionRow;
  patch: Generated.PatchSchema.Patch;
  patchArtifactId: string;
  dimension: Issue['dimension'];
  issueIds: readonly string[];
}> {
  const ch = input.chapterNo;
  return runStep(
    ctx,
    'revise',
    async () => {
      const nfc = toNfcText(input.version.text);
      const before = sliceCodePoints(nfc, 0, input.range.start);
      const old = sliceCodePoints(nfc, input.range.start, input.range.end);
      const after = sliceCodePoints(nfc, input.range.end, codePointLength(nfc.text));
      const ko = ctx.identity.outputLanguage.language === 'ko';
      const nameOf = input.nameOf;
      const planText =
        ctx.policy.planning?.scene_plan_format === 'labelled' && ko && nameOf
          ? renderScenePlanKo(input.scene, nameOf)
          : JSON.stringify(input.scene);
      const lineTargets = ctx.policy.planning?.dialogue_floor?.line_targets;
      const measured = sceneTalkShare(old);
      const note = [
        '',
        '',
        '다시 쓰기: 이 장면의 앞선 원고는 아래 결함 때문에 통과하지 못했다. 같은 장면 설계로 장면 전체를 새로 쓴다.',
        ...input.findings.map((f) => `- ${ko ? claimForKoreanNote(f.claim) : f.claim}`),
        `앞선 원고의 대사·속마음 비중은 ${String(Math.round(measured * 100))}%였다.`,
        ...(input.rejected?.length
          ? [
              '앞선 수정안은 다음 이유로 기각됐다. 같은 방식으로 고치지 않는다.',
              ...input.rejected.map((r) => `- ${claimForKoreanNote(r)}`),
            ]
          : []),
        ...(input.lengthTarget
          ? [
              `이 장면의 분량 목표는 ${String(input.lengthTarget.target)}자 안팎이다. 앞선 원고는 ${String(input.lengthTarget.previous)}자였다. 장면 설계의 비트를 빠짐없이 지면에서 보여 주어 목표 분량을 채운다.`,
            ]
          : []),
      ].join('\n');
      const targetsNote = lineTargets
        ? ctx.policy.planning?.dialogue_floor?.solo_scenes === true && isSoloScene(input.scene)
          ? soloLineTargetNote(sceneLineTargets(input.scene, lineTargets))
          : lineTargetNote(
              sceneLineTargets(input.scene, lineTargets),
              input.scene.participants
                .filter((p) => p !== input.scene.pov.character_id)
                .map((p) => (nameOf ? nameOf(p) : p)),
              undefined,
            )
        : '';
      const cut =
        ctx.policy.planning?.cut_design && input.scene.scene_no === input.sceneTotal
          ? cutNote(input.contract)
          : '';
      const variables = {
        scene_plan: planText + targetsNote + cut + note,
        scene_no: String(input.scene.scene_no),
        previous_text:
          before.trim() ||
          (input.pack.variables.previous_text ??
            (ko
              ? `(${String(ch)}화가 연재를 연다. 앞에 이어지는 원고가 없다.)`
              : `(Chapter ${String(ch)} opens the series; nothing precedes it.)`)),
        length_target_words: String(input.scene.length_target.value),
        scene_total: String(input.sceneTotal),
        scene_role: sceneRole(input.scene.scene_no, input.sceneTotal, ko ? 'ko' : 'en'),
      };
      const write = async (vars: typeof variables, activityId: string) => {
        const c = await modelCall<SceneDraft | string>(ctx, {
          step: 'revise',
          family: 'scene_writer',
          activityId,
          variables: vars,
          pack: packCallInput(input.pack),
        });
        let text =
          typeof c.output === 'string'
            ? c.output
            : (((c.output as { text?: unknown }).text as string | undefined) ?? '');
        if (ctx.policy.drafting?.paragraph_per_line) text = paragraphPerLine(text);
        text = stripProseChatter(text).trim();
        // ADR-0092 (G9-7): the drafting pass's quote marks and repeated-line rule, before any judge reads it.
        if (input.checks && ko) text = koQuoteMarks(text);
        if (input.checks && ctx.policy.drafting?.dedupe_repeated_lines)
          text = dedupeRepeatedLines(text).text;
        return { call: c, text };
      };
      const activity = `scene_rewrite:${String(ch)}:${String(input.scene.scene_no)}:r${String(input.round)}`;
      let { call, text: prose } = await write(variables, activity);
      // ADR-0092 (G9-7): a first-person rewrite that drifted into the third person is re-drafted once with its
      // measure; the redraft is kept only when it no longer drifts.
      const povNames =
        input.checks && ko && input.scene.pov.person === 'first'
          ? povNamesOf(input.checks.bible, ctx, input.scene.pov.character_id)
          : [];
      if (povNames.length > 0 && prose) {
        const drift = thirdPersonDrift(prose, povNames);
        if (drift.drifted) {
          const retry = await write(
            {
              ...variables,
              scene_plan: variables.scene_plan + povRedraftNote(drift, povNames[0] ?? ''),
            },
            `${activity}:pov`,
          );
          if (retry.text && !thirdPersonDrift(retry.text, povNames).drifted) {
            call = retry.call;
            prose = retry.text;
            recordNormalization('pov_redraft');
          }
        }
      }
      if (!prose)
        throw new WorkflowError('SCENE_DRAFT_INVALID', 'the scene rewrite came back empty', {
          step: 'revise',
          recommendedActions: ['regenerate'],
        });
      const trailing = after.startsWith('\n') ? '' : after ? '\n\n' : '';
      const leading = before && !before.endsWith('\n') ? '\n\n' : '';
      const revisedText = toNfcText(`${before}${leading}${prose}${trailing}${after}`).text;
      await setChapterStatus(ctx.pool, input.chapterId, 'revising');
      const version = await createManuscriptVersion(ctx.pool, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        chapterId: input.chapterId,
        origin: 'revision',
        text: revisedText,
        parentVersionId: input.version.id,
        createdByJobId: ctx.job.id,
      });
      const patch: Generated.PatchSchema.Patch = {
        id: uuidFromKey(
          `${ctx.workflowId}:${input.version.id}:scene_rewrite:${String(input.round)}`,
        ),
        from_version_id: input.version.id,
        to_version_id: version.id,
        scope: 'scene',
        span: { start: input.range.start, end: input.range.end },
        new_text: prose,
        changed_claims: [],
        preserved_facts_ack: [],
        issue_ids: input.findings.map((f) => f.id),
        dimension: input.dimension,
        reviser_call_id: call.llmCallId,
      };
      const ref = await saveArtifact(ctx, {
        step: 'revise',
        kind: 'patch',
        key: `${input.version.id}:r${String(input.round)}`,
        schema: 'patch.schema.json',
        payload: patch,
      });
      recordNormalization('scene_rewrite');
      return {
        version,
        patch,
        patchArtifactId: ref.artifact_id,
        dimension: input.dimension,
        issueIds: input.findings.map((f) => f.id),
      };
    },
    `${input.version.id}:r${String(input.round)}:scene${String(input.scene.scene_no)}`,
  );
}

/**
 * The code-point ranges of the drafted scenes in the current version, found by each scene's first line (patches
 * replace whole lines, so a scene whose first line survived still starts there). A scene whose first line no
 * longer occurs has no range; the ladder then stays on the patch rung for it.
 */
export function sceneRangesIn(
  current: string,
  sceneTexts: readonly string[],
): ({ start: number; end: number } | undefined)[] {
  const text = toNfcText(current).text;
  // Scenes are searched in order from the previous scene's start, so two scenes that open on the same line
  // still get their own ranges.
  let cursor = 0;
  const starts = sceneTexts.map((t) => {
    const first = toNfcText(t)
      .text.split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim();
    if (!first) return undefined;
    const at = text.indexOf(first, cursor);
    if (at < 0) return undefined;
    cursor = at + first.length;
    return codePointLength(text.slice(0, at));
  });
  const total = codePointLength(text);
  return starts.map((s, i) => {
    if (s === undefined) return undefined;
    const next = starts.slice(i + 1).find((x): x is number => x !== undefined);
    const end = next ?? total;
    return end > s ? { start: s, end } : undefined;
  });
}
