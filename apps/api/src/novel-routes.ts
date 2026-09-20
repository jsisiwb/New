/**
 * The "make my novel" surface: intake → suggestions → approval → autopilot production → status.
 *
 *   POST /v1/projects/:id/novel            intake document → spec + concept suggestions (run: awaiting_approval)
 *   GET  /v1/projects/:id/novel            run status, suggestions, plan summary, chapter progress
 *   GET  /v1/projects/:id/novel/events     the run's durable event log (progress the UI can trust)
 *   POST /v1/projects/:id/novel/approve    { concept_id, auto_continue?, stop_after_chapter? } → planning
 *   POST /v1/projects/:id/novel/pause | resume | cancel
 *
 * ROLE POLICY: reads are `viewer`; starting a run and approving a concept spend budget → `editor`;
 * cancelling discards paid work → `owner`.
 *
 * The suggestion stage runs INSIDE the request (a handful of R-class calls) because the operator is
 * waiting for exactly that answer; everything after approval is queued for the novel runner. When no
 * provider is configured for this API process the start route answers `NO_PROVIDER` (503) rather than
 * pretending; the run row is still created so the CLI or a configured process can pick it up.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getArtifactById,
  getNovelRun,
  listConceptCandidates,
  listNovelRunEvents,
  type Client,
  type NovelRunRow,
  type Pool,
} from '@yeonjae/db';
import {
  approveConcept,
  cancelNovelRun,
  pauseNovelRun,
  resumeNovelRun,
  startNovel,
  type NovelDeps,
  type StoredStoryPlan,
} from '@yeonjae/workflows';
import { requireRole, type WorkspaceScope } from './auth.js';
import { withIdempotency } from './idempotency.js';
import { ApiError } from './problem.js';
import { asObject, optionalString, requireInt, requireUuid } from './validate.js';

export interface NovelRouteDeps {
  readonly pool: Pool;
  readonly scoped: (req: FastifyRequest) => Promise<WorkspaceScope>;
  readonly inScope: <T>(scope: WorkspaceScope, fn: (c: Client) => Promise<T>) => Promise<T>;
  readonly projectOr404: (c: Client, projectId: string) => Promise<{ id: string; title: string }>;
  readonly audit: (
    c: Client,
    scope: WorkspaceScope,
    input: {
      action: string;
      targetKind?: string | undefined;
      targetId?: string | undefined;
      projectId?: string | undefined;
      requestId: string;
      detail?: Record<string, unknown> | undefined;
    },
  ) => Promise<void>;
  readonly headerOf: (req: FastifyRequest, name: string) => string | undefined;
  /**
   * Builds the model-facing dependencies for one project, or is absent when this process has no provider
   * configured. Absent means the start route refuses with NO_PROVIDER instead of guessing.
   */
  readonly novelDeps?:
    ((input: { workspaceId: string; projectId: string }) => NovelDeps) | undefined;
  /** Called after a run is queued so an in-process runner can wake immediately. */
  readonly onQueued?: (() => void) | undefined;
}

export function registerNovelRoutes(app: FastifyInstance, deps: NovelRouteDeps): void {
  const { pool, scoped, inScope, projectOr404, audit, headerOf } = deps;
  const projectIdOf = (req: FastifyRequest): string =>
    requireUuid((req.params as { projectId?: string }).projectId, 'params.projectId');

  app.post('/v1/projects/:projectId/novel', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const body = asObject(req.body);
    const intake = body.intake ?? body;
    const conceptCount =
      body.concept_count === undefined
        ? undefined
        : requireInt(body.concept_count as number, 'body.concept_count', { min: 2, max: 4 });
    await inScope(scope, async (c) => projectOr404(c, projectId));
    const make = deps.novelDeps;
    if (!make)
      throw new ApiError(
        'NO_PROVIDER',
        'This API process has no model provider configured (YEONJAE_PROVIDER_MODE). Set one and retry.',
      );
    const outcome = await inScope(scope, async (c) =>
      withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: `/v1/projects/${projectId}/novel`,
          body: req.body,
        },
        async () => {
          // The planning gateway runs against the pool (its job rows are project-scoped by the workflow
          // itself), the audit row is written in the request's scope.
          const result = await startNovel(make({ workspaceId: scope.workspaceId, projectId }), {
            projectId,
            intake,
            createdByUserId: scope.principal.user.id,
            conceptCount,
          });
          await audit(c, scope, {
            action: 'novel.start',
            targetKind: 'novel_run',
            targetId: result.run.id,
            projectId,
            requestId: req.id,
            detail: { concepts: result.concepts.length, spec_version: result.specVersion },
          });
          return {
            status: 201,
            body: {
              run: runView(result.run),
              spec_version: result.specVersion,
              suggestions: result.concepts.map(conceptView),
            },
          };
        },
      ),
    );
    return reply.status(outcome.status).send(outcome.body);
  });

  app.get('/v1/projects/:projectId/novel', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const run = await getNovelRun(c, projectId);
      if (!run) throw new ApiError('NOT_FOUND', 'This project has no novel run yet.');
      const candidates = await listConceptCandidates(c, {
        projectId,
        round: run.spec_version,
        limit: 50,
      });
      const project = await c.query<{ settings: { story_plan?: StoredStoryPlan } }>(
        'SELECT settings FROM projects WHERE id = $1',
        [projectId],
      );
      const plan = project.rows[0]?.settings.story_plan;
      const chapters = await c.query<{ number: number; status: string; title: string | null }>(
        'SELECT number, status, title FROM chapters WHERE project_id = $1 ORDER BY number',
        [projectId],
      );
      const spend = await c.query<{ cents: string }>(
        `SELECT coalesce(sum(cost_cents), 0)::text AS cents FROM llm_calls WHERE project_id = $1`,
        [projectId],
      );
      const bible = plan ? await getArtifactById(c, plan.bible_artifact_id) : undefined;
      const blueprint = plan ? await getArtifactById(c, plan.blueprint_artifact_id) : undefined;
      return {
        run: runView(run),
        suggestions: candidates.map((k) => ({
          candidate_id: k.id,
          status: k.status,
          label: k.label,
          ...conceptView(k.payload as ConceptLike),
        })),
        plan: plan
          ? {
              spec_version: plan.spec_version,
              concept_id: plan.concept_id,
              target_chapters: plan.target_chapters,
              bible: bible ? bibleSummary(bible.payload as BibleLike) : null,
              blueprint: blueprint ? blueprintSummary(blueprint.payload as BlueprintLike) : null,
            }
          : null,
        chapters: chapters.rows,
        accepted_chapters: chapters.rows.filter((ch) => ch.status === 'accepted').length,
        spend_cents: Number(spend.rows[0]?.cents ?? '0'),
      };
    });
  });

  app.get('/v1/projects/:projectId/novel/bible', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const project = await c.query<{ settings: { story_plan?: StoredStoryPlan } }>(
        'SELECT settings FROM projects WHERE id = $1',
        [projectId],
      );
      const plan = project.rows[0]?.settings.story_plan;
      if (!plan) throw new ApiError('NOT_FOUND', 'The complete story bible is not ready yet.');
      const bible = await getArtifactById(c, plan.bible_artifact_id);
      const blueprint = await getArtifactById(c, plan.blueprint_artifact_id);
      if (
        !bible ||
        !blueprint ||
        bible.project_id !== projectId ||
        blueprint.project_id !== projectId
      )
        throw new ApiError('NOT_FOUND', 'The story plan artifacts are unavailable.');
      return { bible: bible.payload, blueprint: blueprint.payload };
    });
  });

  app.get('/v1/projects/:projectId/novel/events', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const q = (req.query ?? {}) as { after?: string };
    const after = q.after ? requireInt(q.after, 'query.after', { min: 0, max: 1_000_000_000 }) : 0;
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const run = await getNovelRun(c, projectId);
      if (!run) throw new ApiError('NOT_FOUND', 'This project has no novel run yet.');
      const events = await listNovelRunEvents(c, run.id, after);
      return { run_id: run.id, items: events };
    });
  });

  app.post('/v1/projects/:projectId/novel/approve', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const body = asObject(req.body);
    const conceptId = requireUuid(body.concept_id as string | undefined, 'body.concept_id');
    const rationale = optionalString(body, 'rationale', { max: 2000 });
    const autoContinue = optionalBoolean(body, 'auto_continue') ?? true;
    const stopAfter =
      body.stop_after_chapter === undefined || body.stop_after_chapter === null
        ? undefined
        : requireInt(body.stop_after_chapter as number, 'body.stop_after_chapter', {
            min: 1,
            max: 5000,
          });
    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: `/v1/projects/${projectId}/novel/approve`,
          body: req.body,
        },
        async () => {
          const run = await approveConcept(pool, {
            projectId,
            conceptId,
            userId: scope.principal.user.id,
            rationale,
            autoContinue,
            stopAfterChapter: stopAfter,
          });
          await audit(c, scope, {
            action: 'novel.approve',
            targetKind: 'novel_run',
            targetId: run.id,
            projectId,
            requestId: req.id,
            detail: { concept_id: conceptId, auto_continue: autoContinue },
          });
          deps.onQueued?.();
          return { status: 202, body: { run: runView(run) } };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  app.post('/v1/projects/:projectId/novel/:runAction', async (req, reply) => {
    const action = (req.params as { runAction?: string }).runAction;
    if (action !== 'pause' && action !== 'resume' && action !== 'cancel')
      throw new ApiError('NOT_FOUND', 'No such route.');
    const scope = await scoped(req);
    requireRole(scope, action === 'cancel' ? 'owner' : 'editor');
    const projectId = projectIdOf(req);
    const body = asObject(req.body ?? {});
    const stopAfter =
      body.stop_after_chapter === undefined
        ? undefined
        : body.stop_after_chapter === null
          ? null
          : requireInt(body.stop_after_chapter as number, 'body.stop_after_chapter', {
              min: 1,
              max: 5000,
            });
    const autoContinue = optionalBoolean(body, 'auto_continue');
    const run = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      if (action === 'resume') {
        const existing = await getNovelRun(c, projectId);
        if (existing?.status === 'failed' && existing.approved_concept_id === null) {
          const make = deps.novelDeps;
          if (!make)
            throw new ApiError(
              'NO_PROVIDER',
              'This API process has no model provider configured (YEONJAE_PROVIDER_MODE). Set one and retry.',
            );
          if (!existing.intake_artifact_id)
            throw new ApiError('INTERNAL_ERROR', 'The failed novel run has no persisted intake.');
          const intake = await getArtifactById(c, existing.intake_artifact_id);
          if (!intake)
            throw new ApiError(
              'INTERNAL_ERROR',
              'The failed novel run intake could not be loaded.',
            );
          const recovered = await startNovel(make({ workspaceId: scope.workspaceId, projectId }), {
            projectId,
            intake: intake.payload,
            createdByUserId: scope.principal.user.id,
          });
          await audit(c, scope, {
            action: 'novel.resume_suggestions',
            targetKind: 'novel_run',
            targetId: recovered.run.id,
            projectId,
            requestId: req.id,
          });
          return recovered.run;
        }
      }
      const r =
        action === 'pause'
          ? await pauseNovelRun(pool, projectId)
          : action === 'cancel'
            ? await cancelNovelRun(pool, projectId)
            : await resumeNovelRun(pool, { projectId, stopAfterChapter: stopAfter, autoContinue });
      await audit(c, scope, {
        action: `novel.${action}`,
        targetKind: 'novel_run',
        targetId: r.id,
        projectId,
        requestId: req.id,
      });
      return r;
    });
    if (action === 'resume') deps.onQueued?.();
    return reply.status(202).send({ run: runView(run) });
  });
}

// ---------------------------------------------------------------------------------------------------------

interface ConceptLike {
  id?: string;
  angle?: string;
  logline?: string;
  story_promise?: string;
  reader_fantasy?: string;
  main_conflict?: string;
  protagonist_sketch?: string;
  chapter_one_hook?: string;
  ending_direction?: string;
  progression_curve?: string;
  differentiators?: string[];
  genre_fit_notes?: string[];
  risk_notes?: string[];
}
interface BibleLike {
  entities?: { type: string; display_name: string; description?: string }[];
  propositions?: unknown[];
  promises?: { statement: string; type: string; importance: string }[];
}
interface BlueprintLike {
  story_promise?: string;
  main_conflict?: string;
  ending?: { type?: string; summary?: string };
  seasons?: {
    ordinal: number;
    title: string;
    objective: string;
    chapter_range_est: { from: number; to: number };
  }[];
}

export function runView(run: NovelRunRow) {
  return {
    id: run.id,
    project_id: run.project_id,
    status: run.status,
    spec_version: run.spec_version,
    approved_concept_id: run.approved_concept_id,
    target_chapters: run.target_chapters,
    next_chapter: run.next_chapter,
    auto_continue: run.auto_continue,
    stop_after_chapter: run.stop_after_chapter,
    last_error: run.last_error,
    running:
      run.runner_id !== null && run.lease_expires_at !== null && run.lease_expires_at > new Date(),
    updated_at: run.updated_at,
  };
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean')
    throw new ApiError('VALIDATION_FAILED', `${key} must be a boolean.`, {
      errors: [{ path: `body.${key}`, message: 'must be a boolean' }],
    });
  return value;
}

function conceptView(c: ConceptLike) {
  return {
    id: c.id,
    angle: c.angle,
    logline: c.logline,
    story_promise: c.story_promise,
    reader_fantasy: c.reader_fantasy,
    main_conflict: c.main_conflict,
    protagonist_sketch: c.protagonist_sketch,
    chapter_one_hook: c.chapter_one_hook,
    ending_direction: c.ending_direction,
    progression_curve: c.progression_curve,
    differentiators: c.differentiators ?? [],
    genre_fit_notes: c.genre_fit_notes ?? [],
    risk_notes: c.risk_notes ?? [],
  };
}

function bibleSummary(b: BibleLike) {
  const entities = b.entities ?? [];
  const byType = (t: string) =>
    entities
      .filter((e) => e.type === t)
      .map((e) => ({ name: e.display_name, description: e.description ?? null }));
  return {
    characters: byType('character'),
    locations: byType('location'),
    organizations: byType('organization'),
    abilities: byType('ability'),
    propositions: (b.propositions ?? []).length,
    promises: (b.promises ?? []).map((p) => ({
      statement: p.statement,
      type: p.type,
      importance: p.importance,
    })),
  };
}

function blueprintSummary(b: BlueprintLike) {
  return {
    story_promise: b.story_promise ?? null,
    main_conflict: b.main_conflict ?? null,
    ending: b.ending ?? null,
    seasons: (b.seasons ?? []).map((s) => ({
      ordinal: s.ordinal,
      title: s.title,
      objective: s.objective,
      chapters: s.chapter_range_est,
    })),
  };
}
