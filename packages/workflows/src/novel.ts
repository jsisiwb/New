/**
 * NovelRun orchestration: the operator-facing lifecycle from intake to a finished manuscript.
 *
 *   startNovel(intake)          → run: intake → suggesting → awaiting_approval   (spec + concepts)
 *   approveConcept(conceptId)   → run: planning                                  (queued)
 *   advanceNovelRun(run)        → planning: full bible + blueprint, project story_plan pinned → producing
 *                               → producing: produce next chapter; accepted → next_chapter+1; done → completed
 *
 * Every model-driven stage is a checkpointed job (`plan:<project>` for the plan, `chapter:<project>:<n>`
 * for chapters), so `advanceNovelRun` is safe to call again after any crash: completed steps replay,
 * nothing re-spends. The run row records WHERE the novel is; the jobs record WHAT was produced.
 *
 * Quality gates and errors move the run to `needs_attention` or `failed` with a closed error code and an
 * operator-safe message. Auto-continue stops at `stop_after_chapter` when set, and never skips a chapter
 * that was not accepted (PREVIOUS_CHAPTER_NOT_ACCEPTED remains the chapter loop's own guard).
 */
import {
  emitNovelRunEvent,
  ensureNovelRun,
  getArtifactById,
  getNovelRun,
  getProject,
  insertConceptCandidates,
  listConceptCandidates,
  putArtifact,
  selectConcept,
  transitionNovelRun,
  updateJob,
  withTransaction,
  type NovelRunRow,
  type NovelRunLease,
  type Pool,
} from '@yeonjae/db';
import { requirePolicy, type PolicyRef } from '@yeonjae/domain';
import { type Gateway } from '@yeonjae/gateway';
import { produceChapter } from './chapter-production.js';
import { WorkflowError } from './errors.js';
import { ensureProjectIdentity } from './identity-from-intake.js';
import { validateIntake, type StoryIntake, type StorySpec } from './planning.js';
import {
  buildFullBible,
  loadStoredPlan,
  makePlanContext,
  planIds,
  suggestConcepts,
  type Concept,
  type StoredStoryPlan,
  type StoryPlanDeps,
} from './story-plan.js';
import { loadArtifact, type WorkflowContext } from './runtime.js';

export interface NovelDeps extends StoryPlanDeps {
  readonly pool: Pool;
  readonly gateway: Gateway;
}

export interface StartNovelInput {
  readonly projectId: string;
  readonly intake: unknown;
  readonly createdByUserId?: string | undefined;
  readonly conceptCount?: number | undefined;
}

export interface StartNovelResult {
  readonly run: NovelRunRow;
  readonly specVersion: number;
  readonly concepts: readonly Concept[];
}

/**
 * Stage 1: validate the intake, persist it, interpret the spec and produce concept suggestions. Ends with
 * the run in `awaiting_approval`. Idempotent per project: a second call with the same intake replays.
 */
export async function startNovel(
  deps: NovelDeps,
  input: StartNovelInput,
): Promise<StartNovelResult> {
  const intake = validateIntake(input.intake);
  const project = await getProject(deps.pool, input.projectId);
  const { artifact } = await putArtifact(deps.pool, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    step: 'intake',
    kind: 'story_intake',
    key: 'v1',
    schema: 'story-intake.schema.json',
    payload: intake,
  });
  const { run } = await ensureNovelRun(deps.pool, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    intakeArtifactId: artifact.id,
    targetChapters: intake.target_chapters,
    createdByUserId: input.createdByUserId,
  });
  // A project without a pinned Narrative Identity gets one composed from the intake (ADR-0027 layers:
  // the two contracts are always the global profiles; genre/setting/naming/terminology come from intake).
  await ensureProjectIdentity(deps.pool, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    intake,
    store: deps.profiles,
    languageLayer: pinnedLanguageLayer(project.production_policy_version),
  });
  const retryingPreApproval = run.status === 'failed' && run.approved_concept_id === null;
  if (!['intake', 'suggesting', 'awaiting_approval'].includes(run.status) && !retryingPreApproval)
    throw new WorkflowError('SELECTION_REQUEST_CHANGED', `this novel is already ${run.status}`, {
      step: 'start',
      data: { status: run.status },
    });
  await transitionNovelRun(deps.pool, {
    runId: run.id,
    to: 'suggesting',
    expectFrom: retryingPreApproval ? ['failed'] : ['intake'],
    patch: retryingPreApproval ? { lastError: null } : undefined,
  });
  let round;
  try {
    // Inside the failure handler: a context that cannot be built (an unknown pinned policy, a stale policy
    // hash) fails the run instead of leaving it `suggesting` with nothing running.
    const { ctx } = await makePlanContext(deps, project.id);
    round = await suggestConcepts(ctx, {
      intake,
      specVersion: run.spec_version,
      count: input.conceptCount,
    });
  } catch (err) {
    await failRun(deps.pool, run.id, err, 'suggesting');
    throw err;
  }
  // Concepts are also operator resources (0010) so the existing review screen and select route see them.
  const existing = await listConceptCandidates(deps.pool, {
    projectId: project.id,
    round: run.spec_version,
    limit: 50,
  });
  if (existing.length === 0)
    await insertConceptCandidates(deps.pool, {
      workspaceId: project.workspace_id,
      projectId: project.id,
      round: run.spec_version,
      candidates: round.concepts.map((c, i) => ({
        label: `${i + 1}. ${c.logline.slice(0, 70)}`,
        payload: c as unknown as Record<string, unknown>,
      })),
      derivedFromArtifactId: round.artifactId,
    });
  const already = run.status === 'awaiting_approval';
  const after = already
    ? { run: (await getNovelRun(deps.pool, project.id)) ?? run }
    : await transitionNovelRun(deps.pool, {
        runId: run.id,
        to: 'awaiting_approval',
        expectFrom: ['suggesting'],
        event: { kind: 'run.suggestions_ready', payload: { concepts: round.concepts.length } },
      });
  return { run: after.run, specVersion: round.specVersion, concepts: round.concepts };
}

/**
 * Stage 2 entry: the operator approves one concept. Records the selection (winner-only, atomic) and queues
 * the run for planning. `autoContinue=false` produces one chapter at a time, waiting for a resume each time.
 */
export async function approveConcept(
  pool: Pool,
  input: {
    projectId: string;
    conceptId: string;
    userId?: string | undefined;
    rationale?: string | undefined;
    autoContinue?: boolean | undefined;
    stopAfterChapter?: number | undefined;
  },
): Promise<NovelRunRow> {
  const run = await getNovelRun(pool, input.projectId);
  if (!run)
    throw new WorkflowError('WORKFLOW_NOT_FOUND', 'this project has no novel run', {
      step: 'approve',
    });
  if (run.status !== 'awaiting_approval')
    throw new WorkflowError(
      'SELECTION_REQUEST_CHANGED',
      `the run is ${run.status}, not awaiting approval`,
      {
        step: 'approve',
        data: { status: run.status },
      },
    );
  const candidates = await listConceptCandidates(pool, {
    projectId: input.projectId,
    round: run.spec_version,
    limit: 50,
  });
  const winner = candidates.find(
    (c) => c.id === input.conceptId || (c.payload as { id?: string }).id === input.conceptId,
  );
  if (!winner)
    throw new WorkflowError(
      'SELECTION_CONFLICT',
      'that concept is not one of this round’s candidates',
      {
        step: 'approve',
      },
    );
  if (winner.status !== 'selected')
    await selectConcept(pool, {
      projectId: input.projectId,
      round: run.spec_version,
      winnerConceptId: winner.id,
      rationale: input.rationale,
      selectedByUserId: input.userId,
    });
  const conceptPayloadId = (winner.payload as { id?: string }).id ?? winner.id;
  const r = await transitionNovelRun(pool, {
    runId: run.id,
    to: 'planning',
    expectFrom: ['awaiting_approval'],
    patch: {
      approvedConceptId: conceptPayloadId,
      approvedByUserId: input.userId,
      autoContinue: input.autoContinue ?? true,
      ...(input.stopAfterChapter !== undefined ? { stopAfterChapter: input.stopAfterChapter } : {}),
      lastError: null,
    },
    event: { kind: 'run.approved', payload: { concept_id: conceptPayloadId } },
  });
  return r.run;
}

export type AdvanceOutcome =
  | { kind: 'planned'; run: NovelRunRow }
  | { kind: 'chapter_accepted'; run: NovelRunRow; chapterNo: number; canonVersion: number }
  | { kind: 'completed'; run: NovelRunRow }
  | { kind: 'stopped'; run: NovelRunRow; reason: string }
  | { kind: 'idle'; run: NovelRunRow };

/**
 * Perform the next unit of work for a run: the plan, or one chapter. Returns what happened so a runner can
 * decide whether to call again immediately. Never loops itself — the caller owns the lease heartbeat.
 */
export async function advanceNovelRun(
  deps: NovelDeps,
  run: NovelRunRow,
  opts: {
    isCancelled?: (() => Promise<boolean>) | undefined;
    lease?: NovelRunLease | undefined;
  } = {},
): Promise<AdvanceOutcome> {
  // Do not start another durable stage after an operator pause/cancel or a lost run lease.
  if (opts.isCancelled && (await opts.isCancelled())) return { kind: 'idle', run };
  if (run.status === 'planning') {
    try {
      const planned = await planNovel(deps, run, opts.isCancelled);
      if (opts.isCancelled && (await opts.isCancelled())) {
        return { kind: 'idle', run: (await getNovelRun(deps.pool, run.project_id)) ?? run };
      }
      const r = await transitionNovelRun(deps.pool, {
        runId: run.id,
        to: 'producing',
        expectFrom: ['planning'],
        patch: { lastError: null },
        event: {
          kind: 'run.planned',
          payload: {
            cast: planned.cast,
            locations: planned.locations,
            organizations: planned.organizations,
            propositions: planned.propositions,
            promises: planned.promises,
            seasons: planned.seasons,
          },
        },
        lease: opts.lease,
      });
      return { kind: 'planned', run: r.run };
    } catch (err) {
      const updated = await failRun(deps.pool, run.id, err, 'planning', 'failed', {}, opts.lease);
      return { kind: 'stopped', run: updated, reason: 'planning_failed' };
    }
  }
  if (run.status !== 'producing') return { kind: 'idle', run };
  if (run.next_chapter > run.target_chapters) {
    const r = await transitionNovelRun(deps.pool, {
      runId: run.id,
      to: 'completed',
      expectFrom: ['producing'],
      event: { kind: 'run.completed', payload: { chapters: run.target_chapters } },
      lease: opts.lease,
    });
    return { kind: 'completed', run: r.run };
  }
  if (run.stop_after_chapter !== null && run.next_chapter > run.stop_after_chapter) {
    const r = await transitionNovelRun(deps.pool, {
      runId: run.id,
      to: 'paused',
      expectFrom: ['producing'],
      patch: { stopAfterChapter: null },
      event: { kind: 'run.batch_done', payload: { through_chapter: run.stop_after_chapter } },
      lease: opts.lease,
    });
    return { kind: 'stopped', run: r.run, reason: 'batch_done' };
  }
  const chapterNo = run.next_chapter;
  const stored = await loadStoredPlan(deps.pool, run.project_id);
  if (!stored) {
    const updated = await failRun(
      deps.pool,
      run.id,
      new WorkflowError(
        'INTERNAL',
        'the run is producing but the project has no pinned story plan',
        {
          step: 'produce',
        },
      ),
      'producing',
      'failed',
      {},
      opts.lease,
    );
    return { kind: 'stopped', run: updated, reason: 'plan_missing' };
  }
  await emitNovelRunEvent(deps.pool, {
    runId: run.id,
    kind: 'chapter.started',
    payload: { chapter_no: chapterNo },
    lease: opts.lease,
  });
  try {
    const result = await produceChapter(
      { pool: deps.pool, gateway: deps.gateway, registry: deps.registry, profiles: deps.profiles },
      {
        projectId: run.project_id,
        chapterNo,
        intake: stored.intake,
        bible: stored.bible,
        blueprint: stored.blueprint,
        ids: {
          arcId: planIds.arc(run.project_id, 1, 1),
          seasonId: planIds.season(run.project_id, 1),
          contractId: planIds.contract(run.project_id, chapterNo),
        },
        specVersion: stored.plan.spec_version,
        approvedBy: 'workflow:novel_run',
        ...(opts.isCancelled ? { cancellation: { isDurablyCancelled: opts.isCancelled } } : {}),
      },
    );
    if (!result.accepted) {
      const updated = await transitionNovelRun(deps.pool, {
        runId: run.id,
        to: 'needs_attention',
        expectFrom: ['producing'],
        patch: {
          lastError: {
            code: 'CHAPTER_NOT_ACCEPTED',
            message: `chapter ${chapterNo} ended ${result.status}`,
          },
        },
        event: {
          kind: 'chapter.attention',
          payload: { chapter_no: chapterNo, status: result.status },
        },
        lease: opts.lease,
      });
      return { kind: 'stopped', run: updated.run, reason: 'chapter_not_accepted' };
    }
    const next = chapterNo + 1;
    const done = next > run.target_chapters;
    const pauseHere = !run.auto_continue && !done;
    const r = await transitionNovelRun(deps.pool, {
      runId: run.id,
      to: done ? 'completed' : pauseHere ? 'paused' : 'producing',
      expectFrom: ['producing'],
      patch: { nextChapter: next, lastError: null },
      event: {
        kind: 'chapter.accepted',
        payload: {
          chapter_no: chapterNo,
          canon_version: result.accepted.canon_version,
          revision_rounds: result.revision?.rounds ?? 0,
        },
      },
      ...(done
        ? {
            additionalEvents: [
              { kind: 'run.completed', payload: { chapters: run.target_chapters } },
            ],
          }
        : {}),
      lease: opts.lease,
    });
    if (done) {
      return { kind: 'completed', run: r.run };
    }
    return {
      kind: 'chapter_accepted',
      run: r.run,
      chapterNo,
      canonVersion: result.accepted.canon_version,
    };
  } catch (err) {
    const code = err instanceof WorkflowError ? err.code : 'INTERNAL';
    const attention = code === 'APPROVAL_BLOCKED' || code === 'PATCH_REGRESSED';
    if (code === 'CANCELLED') {
      const r = await transitionNovelRun(deps.pool, {
        runId: run.id,
        to: 'paused',
        expectFrom: ['producing'],
        event: { kind: 'chapter.cancelled', payload: { chapter_no: chapterNo } },
        lease: opts.lease,
      });
      return { kind: 'stopped', run: r.run, reason: 'cancelled' };
    }
    const updated = await failRun(
      deps.pool,
      run.id,
      err,
      'producing',
      attention ? 'needs_attention' : 'failed',
      {
        chapter_no: chapterNo,
      },
      opts.lease,
    );
    return { kind: 'stopped', run: updated, reason: attention ? 'quality_gate' : 'chapter_failed' };
  }
}

/** Resume a paused / needs_attention / failed run: back onto the queue at its current next chapter. */
export async function resumeNovelRun(
  pool: Pool,
  input: {
    projectId: string;
    stopAfterChapter?: number | null | undefined;
    autoContinue?: boolean | undefined;
  },
): Promise<NovelRunRow> {
  const run = await getNovelRun(pool, input.projectId);
  if (!run)
    throw new WorkflowError('WORKFLOW_NOT_FOUND', 'this project has no novel run', {
      step: 'resume',
    });
  if (!['paused', 'needs_attention', 'failed', 'producing', 'planning'].includes(run.status))
    throw new WorkflowError('SELECTION_REQUEST_CHANGED', `a ${run.status} run cannot be resumed`, {
      step: 'resume',
      data: { status: run.status },
    });
  // A failed suggesting run has no approved concept and cannot safely be resumed into planning.
  // Requiring a fresh approval prevents the planner from running with incomplete context.
  if (!run.approved_concept_id)
    throw new WorkflowError(
      'SELECTION_REQUEST_CHANGED',
      'this run has no approved concept; return to suggestions and approve one before resuming',
      { step: 'resume', data: { status: run.status } },
    );
  const plan = (await getProject(pool, run.project_id)).settings.story_plan as
    StoredStoryPlan | undefined;
  return withTransaction(pool, async (client) => {
    // Clear the job-level pause intent in the same transaction that queues the novel run. A runner cannot
    // observe a resumed run with a stale paused job between these two writes.
    await client.query(
      `UPDATE jobs SET control = 'run', control_requested_at = NULL, control_requested_by = NULL,
              status = CASE WHEN status IN ('paused', 'paused_budget') THEN 'queued' ELSE status END,
              paused_at = NULL, updated_at = now()
         WHERE project_id = $1 AND kind IN ('chapter_production', 'story_plan')
           AND status IN ('paused', 'paused_budget', 'queued', 'running')`,
      [input.projectId],
    );
    const r = await transitionNovelRun(client, {
      runId: run.id,
      to: plan ? 'producing' : 'planning',
      patch: {
        lastError: null,
        ...(input.stopAfterChapter !== undefined
          ? { stopAfterChapter: input.stopAfterChapter }
          : {}),
        ...(input.autoContinue !== undefined ? { autoContinue: input.autoContinue } : {}),
      },
      event: { kind: 'run.resumed' },
    });
    return r.run;
  });
}

export async function pauseNovelRun(pool: Pool, projectId: string): Promise<NovelRunRow> {
  const run = await getNovelRun(pool, projectId);
  if (!run)
    throw new WorkflowError('WORKFLOW_NOT_FOUND', 'this project has no novel run', {
      step: 'pause',
    });
  if (!['planning', 'producing'].includes(run.status)) return run;
  // The running chapter job is asked to stop at its next checkpoint; the run itself rests as paused.
  await pool.query(
    `UPDATE jobs SET control = 'pause', control_requested_at = now(), updated_at = now()
      WHERE project_id = $1 AND status IN ('running', 'queued') AND kind IN ('chapter_production', 'story_plan')`,
    [projectId],
  );
  const r = await transitionNovelRun(pool, {
    runId: run.id,
    to: 'paused',
    event: { kind: 'run.pause_requested' },
  });
  return r.run;
}

export async function cancelNovelRun(pool: Pool, projectId: string): Promise<NovelRunRow> {
  const run = await getNovelRun(pool, projectId);
  if (!run)
    throw new WorkflowError('WORKFLOW_NOT_FOUND', 'this project has no novel run', {
      step: 'cancel',
    });
  if (['completed', 'cancelled'].includes(run.status)) return run;
  await pool.query(
    `UPDATE jobs SET control = 'cancel', control_requested_at = now(),
            status = CASE WHEN status = 'running' THEN 'cancelling' ELSE 'cancelled' END, updated_at = now()
      WHERE project_id = $1 AND status IN ('running', 'queued', 'paused', 'waiting_review')
        AND kind IN ('chapter_production', 'story_plan')`,
    [projectId],
  );
  const r = await transitionNovelRun(pool, {
    runId: run.id,
    to: 'cancelled',
    event: { kind: 'run.cancelled' },
  });
  return r.run;
}

// ---------------------------------------------------------------------------------------------------------

async function planNovel(deps: NovelDeps, run: NovelRunRow, isCancelled?: () => Promise<boolean>) {
  const project = await getProject(deps.pool, run.project_id);
  const existing = project.settings.story_plan as StoredStoryPlan | undefined;
  if (existing?.concept_id === run.approved_concept_id) {
    const stored = await loadStoredPlan(deps.pool, run.project_id);
    if (stored)
      return {
        cast: stored.bible.entities.filter((e) => e.type === 'character').length,
        locations: stored.bible.entities.filter((e) => e.type === 'location').length,
        organizations: stored.bible.entities.filter((e) => e.type === 'organization').length,
        propositions: stored.bible.propositions.length,
        promises: stored.bible.promises.length,
        seasons: stored.blueprint.seasons.length,
      };
  }
  if (!run.intake_artifact_id || !run.approved_concept_id)
    throw new WorkflowError(
      'INTERNAL',
      'run is planning without an intake or an approved concept',
      {
        step: 'plan',
      },
    );
  const intakeRow = await getArtifactById(deps.pool, run.intake_artifact_id);
  if (!intakeRow)
    throw new WorkflowError('INTERNAL', 'intake artifact is missing', { step: 'plan' });
  const intake = validateIntake(intakeRow.payload);
  const { ctx, mainTimelineId } = await makePlanContext(
    deps,
    run.project_id,
    isCancelled ? { isDurablyCancelled: isCancelled } : undefined,
  );
  await updateJob(deps.pool, ctx.job.id, { status: 'running', currentStep: 'plan' });
  const spec = await loadArtifactByKey(ctx, 'story_spec', 'story_spec', `v${run.spec_version}`);
  const concept = await loadConcept(ctx, run.spec_version, run.approved_concept_id);
  const planned = await buildFullBible(ctx, {
    intake,
    spec: spec.payload as StorySpec,
    concept,
    mainTimelineId,
  });
  const plan: StoredStoryPlan = {
    spec_version: run.spec_version,
    intake_artifact_id: run.intake_artifact_id,
    spec_artifact_id: spec.artifactId,
    concept_id: concept.id,
    bible_artifact_id: planned.bibleArtifactId,
    blueprint_artifact_id: planned.blueprintArtifactId,
    target_chapters: intake.target_chapters,
  };
  // The plan is pinned on the project so every chapter job — and every process — reads the same bible.
  await deps.pool.query(
    `UPDATE projects SET settings = settings || $2::jsonb, status = 'producing', updated_at = now() WHERE id = $1`,
    [run.project_id, JSON.stringify({ story_plan: plan })],
  );
  await updateJob(deps.pool, ctx.job.id, {
    status: 'completed',
    currentStep: null,
    finished: true,
    progress: { stage: 'planned', story_plan: plan },
  });
  return planned;
}

async function loadArtifactByKey(
  ctx: WorkflowContext,
  step: string,
  kind: string,
  key: string,
): Promise<{ payload: unknown; artifactId: string }> {
  const r = await ctx.pool.query<{ id: string }>(
    'SELECT id FROM workflow_artifacts WHERE project_id = $1 AND step = $2 AND kind = $3 AND key = $4',
    [ctx.projectId, step, kind, key],
  );
  const id = r.rows[0]?.id;
  if (!id)
    throw new WorkflowError('INTERNAL', `artifact ${step}/${kind}/${key} is missing`, {
      step: 'plan',
    });
  return { payload: await loadArtifact<unknown>(ctx, id), artifactId: id };
}

async function loadConcept(
  ctx: WorkflowContext,
  specVersion: number,
  conceptId: string,
): Promise<Concept> {
  const r = await ctx.pool.query<{ payload: Concept }>(
    `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'concept' AND payload->>'id' = $2
      ORDER BY created_at LIMIT 1`,
    [ctx.projectId, conceptId],
  );
  const found = r.rows[0]?.payload;
  if (found) return found;
  // The operator may have authored a concept through the resources API; accept it if it validates.
  const rows = await listConceptCandidates(ctx.pool, {
    projectId: ctx.projectId,
    round: specVersion,
    limit: 50,
  });
  const winner = rows.find(
    (c) => c.id === conceptId || (c.payload as { id?: string }).id === conceptId,
  );
  if (!winner)
    throw new WorkflowError('INTERNAL', `approved concept ${conceptId} is missing`, {
      step: 'plan',
    });
  return winner.payload as unknown as Concept;
}

async function failRun(
  pool: Pool,
  runId: string,
  err: unknown,
  stage: string,
  to: 'failed' | 'needs_attention' = 'failed',
  extra: Record<string, unknown> = {},
  lease?: NovelRunLease,
): Promise<NovelRunRow> {
  const wf = err instanceof WorkflowError ? err : undefined;
  const r = await transitionNovelRun(pool, {
    runId,
    to,
    patch: {
      lastError: {
        code: wf?.code ?? 'INTERNAL',
        message: wf ? wf.detail.slice(0, 500) : 'an unexpected error stopped the run',
        step: wf?.options.step ?? stage,
        recommended_actions: wf?.options.recommendedActions ?? ['retry_step'],
        ...extra,
      },
    },
    event: { kind: `run.${to}`, payload: { stage, code: wf?.code ?? 'INTERNAL', ...extra } },
    lease,
  });
  return r.run;
}

export { type StoryIntake };

/**
 * The language layer the project's pinned policy names (ADR-0073), if any. An unknown policy yields none
 * here; `makePlanContext` fails the run on it right after.
 */
function pinnedLanguageLayer(policyRef: string): string | undefined {
  try {
    return requirePolicy(policyRef as PolicyRef).identity?.language_layer;
  } catch {
    return undefined;
  }
}
