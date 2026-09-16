/**
 * Route registration for the operator-editable `/v1` resource families (Checkpoint 7, API plan §1).
 *
 * Kept separate from `server.ts` only for size: these routes follow exactly the same spine as the ones
 * already there — authenticate → verify membership → open an RLS-scoped connection → validate → call a
 * service → serialize a safe response — and they share its helpers rather than re-deriving them, which is
 * why those helpers arrive as `deps` instead of being reimplemented here.
 *
 * ROLE POLICY, stated once. Reads need `viewer`. Ordinary edits need `editor`. Three operations need
 * `owner`, and each for a reason rather than by uniform caution:
 *
 *  * pinning an identity or terminology version, because a pin is irreversible — migration 0010's trigger
 *    refuses to unpin or rewrite it afterwards;
 *  * locking a plan version, for the same reason;
 *  * approving a chapter, because approval is what lets content reach accepted canon.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  chapterByNumber,
  getManuscriptVersion,
  listChapterReviews,
  manuscriptVersionsOf,
  recordChapterReview,
  type Client,
  type Pool,
} from '@yeonjae/db';
import { requireRole, type WorkspaceScope } from './auth.js';
import { ApiError } from './problem.js';
import { withIdempotency } from './idempotency.js';
import {
  appendIdentityDocument,
  appendPlanDocument,
  appendRegisterProfile,
  appendStorySpecVersion,
  asProblem,
  assumptionDecision,
  assumptionsOf,
  conceptSelectionFor,
  conceptView,
  createDirection,
  decisionView,
  directionView,
  getConceptCandidate,
  getDirection,
  identityView,
  IDENTITY_KINDS,
  insertConceptCandidates,
  latestIdentityDocument,
  latestPlanDocument,
  latestRegisterProfile,
  listAssumptionDecisions,
  listConceptCandidates,
  listDirections,
  listIdentityDocuments,
  listPlanDocuments,
  listRegisterProfiles,
  lockPlanDocument,
  parseAssumptionAction,
  pinIdentityDocument,
  pinnedIdentityDocument,
  PLAN_KINDS,
  planKeyFor,
  planView,
  readCurrentSpec,
  recordAssumptionDecision,
  registerProfileView,
  requireExpectedVersion,
  requirePayload,
  selectConcept,
  setDirectionStatus,
  storySpecVersion,
  storySpecView,
  validateStorySpec,
} from './resources.js';
import {
  asObject,
  optionalString,
  parsePage,
  requireEnum,
  requireInt,
  requireString,
  requireUuid,
} from './validate.js';

/** Helpers owned by `server.ts`; passed in so both route sets share one implementation of each. */
export interface ResourceRouteDeps {
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
  readonly pageOf: <T>(
    rows: readonly T[],
    limit: number,
    keyOf: (row: T) => string,
  ) => { items: readonly T[]; next_cursor: string | null };
  readonly headerOf: (req: FastifyRequest, name: string) => string | undefined;
}

export function registerResourceRoutes(app: FastifyInstance, deps: ResourceRouteDeps): void {
  const { pool, scoped, inScope, projectOr404, audit, pageOf, headerOf } = deps;

  const projectIdOf = (req: FastifyRequest): string =>
    requireUuid((req.params as { projectId?: string }).projectId, 'params.projectId');

  // ---- story specification ---------------------------------------------------------------------------

  app.get('/v1/projects/:projectId/spec', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const current = await readCurrentSpec(c, projectId);
      if (!current) throw new ApiError('NOT_FOUND', 'This project has no story specification yet.');
      const items = (current.payload as { items?: unknown }).items;
      return {
        project_id: projectId,
        version: current.version,
        source: current.source,
        payload: current.payload,
        // Grouped counts, which is what the review screens key off; the full items are in the payload.
        counts: {
          total: Array.isArray(items) ? items.length : 0,
          assumptions: assumptionsOf(current.payload).length,
        },
      };
    });
  });

  app.get('/v1/projects/:projectId/spec/versions/:version', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const version = requireInt((req.params as { version?: string }).version, 'params.version', {
      min: 1,
      max: 1_000_000,
    });
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const row = await storySpecVersion(c, { projectId, version });
      if (!row) throw new ApiError('NOT_FOUND', 'That story specification version does not exist.');
      return storySpecView(row);
    });
  });

  /**
   * Write the next Story Spec version.
   *
   * The payload is validated against `schemas/story-spec.schema.json` — the SAME validator the production
   * loop uses on its own generated spec — before it is written, so an operator cannot author a document
   * downstream planning would be unable to read.
   */
  app.put('/v1/projects/:projectId/spec', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const body = asObject(req.body);
    const expectedVersion = requireExpectedVersion(body);
    const payload = requirePayload(body);

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'PUT',
          route: '/v1/projects/:projectId/spec',
          body: req.body,
        },
        async () => {
          const validated = validateStorySpec(payload, {
            projectId,
            version: expectedVersion + 1,
          });
          const row = await appendStorySpecVersion(c, {
            workspaceId: scope.workspaceId,
            projectId,
            expectedVersion,
            payload: validated,
            source: 'operator',
            createdByUserId: scope.principal.user.id,
          }).catch(asProblem);
          await audit(c, scope, {
            action: 'spec.update',
            targetKind: 'story_spec',
            targetId: row.id,
            projectId,
            requestId: req.id,
            detail: { version: row.version },
          });
          return { status: 201, body: storySpecView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  // ---- assumption review -----------------------------------------------------------------------------

  app.get('/v1/projects/:projectId/spec/assumptions', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const current = await readCurrentSpec(c, projectId);
      if (!current) throw new ApiError('NOT_FOUND', 'This project has no story specification yet.');
      const decisions = await listAssumptionDecisions(c, {
        projectId,
        specVersion: current.version,
      });
      const byId = new Map(decisions.map((d) => [d.requirement_id, d]));
      return {
        spec_version: current.version,
        items: assumptionsOf(current.payload).map((assumption) => {
          const decided = byId.get(assumption.id);
          return {
            ...assumption,
            // Review status is derived from the persisted decision, never from anything the client sent.
            review_status: decided ? decided.decision : 'pending',
            decision: decided ? decisionView(decided) : null,
          };
        }),
      };
    });
  });

  app.get('/v1/projects/:projectId/spec/assumptions/:requirementId', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const requirementId = requirementIdOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const current = await readCurrentSpec(c, projectId);
      if (!current) throw new ApiError('NOT_FOUND', 'This project has no story specification yet.');
      const assumption = assumptionsOf(current.payload).find((a) => a.id === requirementId);
      if (!assumption) throw new ApiError('NOT_FOUND', 'That assumption does not exist.');
      const decided = await assumptionDecision(c, {
        projectId,
        specVersion: current.version,
        requirementId,
      });
      return {
        spec_version: current.version,
        ...assumption,
        review_status: decided ? decided.decision : 'pending',
        decision: decided ? decisionView(decided) : null,
      };
    });
  });

  /**
   * Record a review decision about one assumption.
   *
   * This records the DECISION. It deliberately does not rewrite the spec item, because promotion of an
   * assumption is a spec edit with its own version and its own concurrency check — silently mutating the
   * spec version that downstream planning already read is exactly the "silent assumption promotion" this
   * checkpoint forbids. The response therefore names the follow-up explicitly.
   */
  app.post(
    '/v1/projects/:projectId/spec/assumptions/:requirementId/decision',
    async (req, reply) => {
      const scope = await scoped(req);
      requireRole(scope, 'editor');
      const projectId = projectIdOf(req);
      const requirementId = requirementIdOf(req);
      const action = parseAssumptionAction(req.body);

      const outcome = await inScope(scope, async (c) => {
        await projectOr404(c, projectId);
        const current = await readCurrentSpec(c, projectId);
        if (!current)
          throw new ApiError('NOT_FOUND', 'This project has no story specification yet.');
        if (!assumptionsOf(current.payload).some((a) => a.id === requirementId))
          throw new ApiError('NOT_FOUND', 'That assumption does not exist.');
        return withIdempotency(
          c,
          {
            workspaceId: scope.workspaceId,
            key: headerOf(req, 'idempotency-key'),
            method: 'POST',
            route: '/v1/projects/:projectId/spec/assumptions/:requirementId/decision',
            body: req.body,
          },
          async () => {
            const row = await recordAssumptionDecision(c, {
              workspaceId: scope.workspaceId,
              projectId,
              specVersion: current.version,
              requirementId,
              decision: action.decision,
              editedText: action.editedText,
              rationale: action.rationale,
              promotedKind: action.promotedKind,
              decidedByUserId: scope.principal.user.id,
            }).catch(asProblem);
            await audit(c, scope, {
              action: `spec.assumption.${action.decision}`,
              targetKind: 'requirement',
              targetId: requirementId,
              projectId,
              requestId: req.id,
              detail: { spec_version: current.version, decision: action.decision },
            });
            return {
              status: 201,
              body: {
                ...decisionView(row),
                // Truthful about what did NOT happen: the spec is unchanged until it is explicitly rewritten.
                spec_updated: false,
                next_step:
                  'PUT /v1/projects/{projectId}/spec with the promoted item to apply this decision',
              },
            };
          },
        );
      });
      return reply.status(outcome.status).send(outcome.body);
    },
  );

  // ---- directions ------------------------------------------------------------------------------------

  app.get('/v1/projects/:projectId/directions', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const page = parsePage(req.query as Record<string, unknown>);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const rows = await listDirections(c, {
        projectId,
        limit: page.limit + 1,
        after: page.after,
      });
      const mapped = pageOf(rows, page.limit, (r) => r.id);
      return { items: mapped.items.map(directionView), next_cursor: mapped.next_cursor };
    });
  });

  app.post('/v1/projects/:projectId/directions', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const body = asObject(req.body);
    // A direction is an operator INSTRUCTION, not manuscript prose, so it is not held to English (ADR-0026
    // constrains what the system writes, not what an operator asks for). It is still NFC-normalized.
    const text = requireString(body, 'text', { max: 4_000 });
    const language = optionalString(body, 'language', { max: 16 }) ?? 'en';
    const scopeLevel = requireEnum(
      body.scope_level,
      ['series', 'season', 'arc', 'chapter_range'] as const,
      'body.scope_level',
    );
    const chapterFrom =
      body.chapter_from === undefined
        ? undefined
        : requireInt(body.chapter_from as number, 'body.chapter_from', { min: 1, max: 10_000 });
    const chapterTo =
      body.chapter_to === undefined
        ? undefined
        : requireInt(body.chapter_to as number, 'body.chapter_to', { min: 1, max: 10_000 });
    if (chapterFrom !== undefined && chapterTo !== undefined && chapterTo < chapterFrom)
      throw new ApiError('VALIDATION_FAILED', 'The chapter range is inverted.', {
        errors: [{ path: 'body.chapter_to', message: 'must be >= body.chapter_from' }],
      });

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: '/v1/projects/:projectId/directions',
          body: req.body,
        },
        async () => {
          const row = await createDirection(c, {
            workspaceId: scope.workspaceId,
            projectId,
            text,
            language,
            scopeLevel,
            chapterFrom,
            chapterTo,
            createdByUserId: scope.principal.user.id,
          });
          await audit(c, scope, {
            action: 'direction.create',
            targetKind: 'direction',
            targetId: row.id,
            projectId,
            requestId: req.id,
            detail: { scope_level: scopeLevel },
          });
          return { status: 201, body: directionView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  app.get('/v1/projects/:projectId/directions/:directionId', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const directionId = requireUuid(
      (req.params as { directionId?: string }).directionId,
      'params.directionId',
    );
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const row = await getDirection(c, { projectId, directionId });
      if (!row) throw new ApiError('NOT_FOUND', 'That direction does not exist.');
      return directionView(row);
    });
  });

  app.patch('/v1/projects/:projectId/directions/:directionId', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const directionId = requireUuid(
      (req.params as { directionId?: string }).directionId,
      'params.directionId',
    );
    const status = requireEnum(
      asObject(req.body).status,
      ['active', 'applied', 'withdrawn'] as const,
      'body.status',
    );
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const row = await setDirectionStatus(c, { projectId, directionId, status });
      if (!row) throw new ApiError('NOT_FOUND', 'That direction does not exist.');
      await audit(c, scope, {
        action: 'direction.update',
        targetKind: 'direction',
        targetId: directionId,
        projectId,
        requestId: req.id,
        detail: { status },
      });
      return directionView(row);
    });
  });

  // ---- concepts --------------------------------------------------------------------------------------

  app.get('/v1/projects/:projectId/concepts', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const query = req.query as Record<string, unknown>;
    const page = parsePage(query);
    const round =
      query.round === undefined
        ? undefined
        : requireInt(query.round as string, 'query.round', { min: 1, max: 10_000 });
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const rows = await listConceptCandidates(c, {
        projectId,
        round,
        limit: page.limit + 1,
        after: page.after,
      });
      const mapped = pageOf(rows, page.limit, (r) => r.id);
      const selection =
        round === undefined ? undefined : await conceptSelectionFor(c, { projectId, round });
      return {
        items: mapped.items.map(conceptView),
        next_cursor: mapped.next_cursor,
        selection: selection
          ? {
              round: selection.round,
              winner_concept_id: selection.winner_concept_id,
              loser_concept_ids: selection.loser_concept_ids,
              rationale: selection.rationale,
              created_at: selection.created_at,
            }
          : null,
      };
    });
  });

  app.get('/v1/projects/:projectId/concepts/:conceptId', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const conceptId = requireUuid(
      (req.params as { conceptId?: string }).conceptId,
      'params.conceptId',
    );
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const row = await getConceptCandidate(c, { projectId, conceptId });
      if (!row) throw new ApiError('NOT_FOUND', 'That concept does not exist.');
      return conceptView(row);
    });
  });

  /**
   * Record a round of concept candidates.
   *
   * Generation itself is a workflow concern and runs through the gateway's replay/mock providers; this route
   * persists the candidates of a round so they can be compared and one can be selected. It never calls a
   * live provider — there is no provider call on this path at all.
   */
  app.post('/v1/projects/:projectId/concepts', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const body = asObject(req.body);
    const round = requireInt(body.round as number, 'body.round', { min: 1, max: 10_000 });
    const raw = body.candidates;
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12)
      throw new ApiError('VALIDATION_FAILED', 'A round needs between 2 and 12 candidates.', {
        errors: [{ path: 'body.candidates', message: 'must be an array of 2 to 12 candidates' }],
      });
    const candidates = raw.map((entry, i) => {
      const item = asObject(entry, `body.candidates[${i}]`);
      return {
        label: requireString(item, 'label', { max: 80 }),
        payload: requirePayload(item),
      };
    });

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: '/v1/projects/:projectId/concepts',
          body: req.body,
        },
        async () => {
          const rows = await insertConceptCandidates(c, {
            workspaceId: scope.workspaceId,
            projectId,
            round,
            candidates,
          }).catch(asProblem);
          await audit(c, scope, {
            action: 'concept.generate',
            targetKind: 'concept_round',
            targetId: String(round),
            projectId,
            requestId: req.id,
            detail: { round, candidates: rows.length, provider: 'none' },
          });
          return { status: 201, body: { round, items: rows.map(conceptView) } };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  /**
   * Select the winning concept of a round.
   *
   * The whole decision — selection row, winner promotion, every loser's terminal status — commits in one
   * transaction inside `selectConcept`. This route adds authorization, idempotency and an audit record; it
   * must not, and does not, perform any part of the transition itself.
   */
  app.post('/v1/projects/:projectId/concepts/:conceptId/select', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const conceptId = requireUuid(
      (req.params as { conceptId?: string }).conceptId,
      'params.conceptId',
    );
    const rationale = optionalString(asObject(req.body ?? {}), 'rationale', { max: 2_000 });

    const concept = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const row = await getConceptCandidate(c, { projectId, conceptId });
      if (!row) throw new ApiError('NOT_FOUND', 'That concept does not exist.');
      return row;
    });

    const outcome = await inScope(scope, async (c) =>
      withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: '/v1/projects/:projectId/concepts/:conceptId/select',
          body: req.body ?? {},
        },
        async () => {
          const result = await selectConcept(pool, {
            projectId,
            round: concept.round,
            winnerConceptId: conceptId,
            rationale,
            selectedByUserId: scope.principal.user.id,
          }).catch(asProblem);
          await audit(c, scope, {
            action: 'concept.select',
            targetKind: 'concept',
            targetId: conceptId,
            projectId,
            requestId: req.id,
            detail: {
              round: concept.round,
              losers: result.selection.loser_concept_ids.length,
            },
          });
          return {
            status: 200,
            body: {
              round: result.selection.round,
              winner: conceptView(result.winner),
              loser_concept_ids: result.selection.loser_concept_ids,
              rationale: result.selection.rationale,
            },
          };
        },
      ),
    );
    return reply.status(outcome.status).send(outcome.body);
  });

  // ---- register profiles -----------------------------------------------------------------------------

  app.get('/v1/projects/:projectId/bible/register-profiles', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const page = parsePage(req.query as Record<string, unknown>);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const rows = await listRegisterProfiles(c, {
        projectId,
        limit: page.limit + 1,
        after: page.after,
      });
      const mapped = pageOf(rows, page.limit, (r) => r.entity_id);
      return { items: mapped.items.map(registerProfileView), next_cursor: mapped.next_cursor };
    });
  });

  app.get('/v1/projects/:projectId/bible/register-profiles/:entityId', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const entityId = requireUuid((req.params as { entityId?: string }).entityId, 'params.entityId');
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      await entityOr404(c, projectId, entityId);
      const row = await latestRegisterProfile(c, { projectId, entityId });
      if (!row) throw new ApiError('NOT_FOUND', 'That register profile does not exist yet.');
      return registerProfileView(row);
    });
  });

  app.put('/v1/projects/:projectId/bible/register-profiles/:entityId', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const entityId = requireUuid((req.params as { entityId?: string }).entityId, 'params.entityId');
    const body = asObject(req.body);
    const expectedVersion = requireExpectedVersion(body);
    const payload = requirePayload(body);

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      // The entity is resolved in scope first, so a register profile can never be attached to another
      // workspace's entity id.
      await entityOr404(c, projectId, entityId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'PUT',
          route: '/v1/projects/:projectId/bible/register-profiles/:entityId',
          body: req.body,
        },
        async () => {
          const row = await appendRegisterProfile(c, {
            workspaceId: scope.workspaceId,
            projectId,
            entityId,
            expectedVersion,
            payload,
            createdByUserId: scope.principal.user.id,
          }).catch(asProblem);
          await audit(c, scope, {
            action: 'register_profile.update',
            targetKind: 'entity',
            targetId: entityId,
            projectId,
            requestId: req.id,
            detail: { version: row.version },
          });
          return { status: 201, body: registerProfileView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  // ---- narrative identity, naming registry, terminology policy ----------------------------------------

  app.get('/v1/projects/:projectId/identity/:kind', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, IDENTITY_KINDS, 'params.kind');
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const current = await latestIdentityDocument(c, { projectId, kind });
      const pinned = await pinnedIdentityDocument(c, { projectId, kind });
      if (!current) throw new ApiError('NOT_FOUND', `No ${kind} document exists yet.`);
      return {
        current: identityView(current),
        // The pinned version is reported separately from the newest one, because they are different
        // questions: production reads the pinned one, an editor works on the newest one.
        pinned: pinned ? identityView(pinned) : null,
        versions: (await listIdentityDocuments(c, { projectId, kind })).map((row) => ({
          version: row.version,
          pinned: row.pinned,
          created_at: row.created_at,
        })),
      };
    });
  });

  app.put('/v1/projects/:projectId/identity/:kind', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, IDENTITY_KINDS, 'params.kind');
    const body = asObject(req.body);
    const expectedVersion = requireExpectedVersion(body);
    const payload = requirePayload(body);

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'PUT',
          route: '/v1/projects/:projectId/identity/:kind',
          body: { kind, ...(req.body as Record<string, unknown>) },
        },
        async () => {
          const row = await appendIdentityDocument(c, {
            workspaceId: scope.workspaceId,
            projectId,
            kind,
            expectedVersion,
            payload,
            createdByUserId: scope.principal.user.id,
          }).catch(asProblem);
          await audit(c, scope, {
            action: `identity.${kind}.update`,
            targetKind: kind,
            targetId: row.id,
            projectId,
            requestId: req.id,
            detail: { version: row.version },
          });
          return { status: 201, body: identityView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  /**
   * Pin a version. Owner-only, because it is irreversible: after this the database refuses to rewrite or
   * unpin the row through any caller.
   */
  app.post('/v1/projects/:projectId/identity/:kind/pin', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'owner');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, IDENTITY_KINDS, 'params.kind');
    const version = requireInt(asObject(req.body).version as number, 'body.version', {
      min: 1,
      max: 1_000_000,
    });

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: '/v1/projects/:projectId/identity/:kind/pin',
          body: { kind, ...(req.body as Record<string, unknown>) },
        },
        async () => {
          const row = await pinIdentityDocument(c, { projectId, kind, version }).catch(asProblem);
          if (!row) throw new ApiError('NOT_FOUND', 'That version does not exist.');
          await audit(c, scope, {
            action: `identity.${kind}.pin`,
            targetKind: kind,
            targetId: row.id,
            projectId,
            requestId: req.id,
            detail: { version },
          });
          return { status: 200, body: identityView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  // ---- planning --------------------------------------------------------------------------------------

  app.get('/v1/projects/:projectId/plans/:kind', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, PLAN_KINDS, 'params.kind');
    const page = parsePage(req.query as Record<string, unknown>);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const rows = await listPlanDocuments(c, {
        projectId,
        kind,
        limit: page.limit + 1,
        after: page.after,
      });
      const mapped = pageOf(rows, page.limit, (r) => r.plan_key);
      return { kind, items: mapped.items.map(planView), next_cursor: mapped.next_cursor };
    });
  });

  app.get('/v1/projects/:projectId/plans/:kind/:planKey', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, PLAN_KINDS, 'params.kind');
    const planKey = planKeyFor(kind, (req.params as { planKey?: string }).planKey);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const row = await latestPlanDocument(c, { projectId, kind, planKey });
      if (!row) throw new ApiError('NOT_FOUND', 'That plan does not exist.');
      return planView(row);
    });
  });

  app.put('/v1/projects/:projectId/plans/:kind/:planKey', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'editor');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, PLAN_KINDS, 'params.kind');
    const planKey = planKeyFor(kind, (req.params as { planKey?: string }).planKey);
    const body = asObject(req.body);
    const expectedVersion = requireExpectedVersion(body);
    const payload = requirePayload(body);

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'PUT',
          route: '/v1/projects/:projectId/plans/:kind/:planKey',
          body: { kind, plan_key: planKey, ...(req.body as Record<string, unknown>) },
        },
        async () => {
          const row = await appendPlanDocument(c, {
            workspaceId: scope.workspaceId,
            projectId,
            kind,
            planKey,
            expectedVersion,
            payload,
            source: 'operator',
            createdByUserId: scope.principal.user.id,
          }).catch(asProblem);
          await audit(c, scope, {
            action: `plan.${kind}.update`,
            targetKind: kind,
            targetId: row.id,
            projectId,
            requestId: req.id,
            detail: { plan_key: planKey, version: row.version },
          });
          return { status: 201, body: planView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  /** Lock a plan version. Owner-only and irreversible, for the same reason pinning is. */
  app.post('/v1/projects/:projectId/plans/:kind/:planKey/lock', async (req, reply) => {
    const scope = await scoped(req);
    requireRole(scope, 'owner');
    const projectId = projectIdOf(req);
    const kind = requireEnum((req.params as { kind?: string }).kind, PLAN_KINDS, 'params.kind');
    const planKey = planKeyFor(kind, (req.params as { planKey?: string }).planKey);
    const version = requireInt(asObject(req.body).version as number, 'body.version', {
      min: 1,
      max: 1_000_000,
    });

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: '/v1/projects/:projectId/plans/:kind/:planKey/lock',
          body: { kind, plan_key: planKey, ...(req.body as Record<string, unknown>) },
        },
        async () => {
          const row = await lockPlanDocument(c, { projectId, kind, planKey, version }).catch(
            asProblem,
          );
          if (!row) throw new ApiError('NOT_FOUND', 'That plan version does not exist.');
          await audit(c, scope, {
            action: `plan.${kind}.lock`,
            targetKind: kind,
            targetId: row.id,
            projectId,
            requestId: req.id,
            detail: { plan_key: planKey, version },
          });
          return { status: 200, body: planView(row) };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  // ---- chapter review: request changes / reject / approve ---------------------------------------------

  app.get('/v1/projects/:projectId/chapters/:number/reviews', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const chapterNo = chapterNumberOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const rows = await listChapterReviews(c, { projectId, chapterNo });
      return {
        chapter_no: chapterNo,
        items: rows.map((row) => ({
          id: row.id,
          decision: row.decision,
          manuscript_version_id: row.manuscript_version_id,
          note: row.note,
          language: row.language,
          created_at: row.created_at,
        })),
      };
    });
  });

  /**
   * Record a review decision on a specific manuscript version.
   *
   * WHAT THIS DOES NOT DO, deliberately: it does not accept canon. Acceptance is the Checkpoint 2–6 path —
   * evaluation, selection, atomic canon commit — and an approval recorded here is the operator SIGNAL that
   * feeds it, not a shortcut around it. A route that flipped a chapter to accepted would bypass evidence
   * verification, winner-only propagation and the atomic commit all at once.
   *
   * `approve` is owner-only because it is the signal that lets content reach accepted canon.
   */
  app.post('/v1/projects/:projectId/chapters/:number/reviews', async (req, reply) => {
    const scope = await scoped(req);
    const projectId = projectIdOf(req);
    const chapterNo = chapterNumberOf(req);
    const body = asObject(req.body);
    const decision = requireEnum(
      body.decision,
      ['request_changes', 'reject', 'approve'] as const,
      'body.decision',
    );
    requireRole(scope, decision === 'approve' ? 'owner' : 'editor');
    const manuscriptVersionId = requireUuid(
      body.manuscript_version_id as string,
      'body.manuscript_version_id',
    );
    const note =
      decision === 'approve'
        ? optionalString(body, 'note', { max: 4_000 })
        : requireString(body, 'note', { max: 4_000 });
    const language = optionalString(body, 'language', { max: 16 }) ?? 'en';

    const outcome = await inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const chapter = await chapterByNumber(c, projectId, chapterNo);
      if (!chapter) throw new ApiError('NOT_FOUND', `Chapter ${chapterNo} does not exist.`);
      // The version must belong to THIS chapter: a version id from another chapter (or another workspace,
      // which RLS has already hidden) must not become the subject of a review here.
      const versions = await manuscriptVersionsOf(c, chapter.id);
      if (!versions.some((v) => v.id === manuscriptVersionId))
        throw new ApiError('NOT_FOUND', 'That manuscript version does not belong to this chapter.');
      return withIdempotency(
        c,
        {
          workspaceId: scope.workspaceId,
          key: headerOf(req, 'idempotency-key'),
          method: 'POST',
          route: '/v1/projects/:projectId/chapters/:number/reviews',
          body: req.body,
        },
        async () => {
          const row = await recordChapterReview(c, {
            workspaceId: scope.workspaceId,
            projectId,
            chapterId: chapter.id,
            chapterNo,
            manuscriptVersionId,
            decision,
            note,
            language,
            decidedByUserId: scope.principal.user.id,
          });
          await audit(c, scope, {
            action: `chapter.${decision}`,
            targetKind: 'manuscript_version',
            targetId: manuscriptVersionId,
            projectId,
            requestId: req.id,
            // Safe metadata only: the decision and which version, never the manuscript prose itself.
            detail: { chapter_no: chapterNo, decision },
          });
          return {
            status: 201,
            body: {
              id: row.id,
              chapter_no: chapterNo,
              decision: row.decision,
              manuscript_version_id: row.manuscript_version_id,
              note: row.note,
              created_at: row.created_at,
              // Truthful about the boundary: this is the operator's signal, not an acceptance.
              canon_accepted: false,
            },
          };
        },
      );
    });
    return reply.status(outcome.status).send(outcome.body);
  });

  // ---- candidates and scorecards ----------------------------------------------------------------------

  /**
   * The candidates of a chapter with their lifecycle state and the recorded selection.
   *
   * `is_accepted` comes from the chapter's `accepted_version_id` and nothing else, so a losing, rejected or
   * quarantined draft cannot be presented as the accepted one no matter what a client asks for.
   */
  app.get('/v1/projects/:projectId/chapters/:number/candidates', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const chapterNo = chapterNumberOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const chapter = await chapterByNumber(c, projectId, chapterNo);
      if (!chapter) throw new ApiError('NOT_FOUND', `Chapter ${chapterNo} does not exist.`);
      const versions = await manuscriptVersionsOf(c, chapter.id);
      const selection = await c.query<{
        status: string;
        winner_manuscript_version_id: string | null;
        loser_version_ids: string[];
        selection_required: boolean;
      }>(
        `SELECT status, winner_manuscript_version_id, loser_version_ids, selection_required
           FROM candidate_selections WHERE project_id = $1 AND chapter_no = $2`,
        [projectId, chapterNo],
      );
      const decided = selection.rows[0];
      const losers = new Set(decided?.loser_version_ids ?? []);
      return {
        chapter_no: chapterNo,
        accepted_version_id: chapter.accepted_version_id,
        selection: decided
          ? {
              status: decided.status,
              winner_manuscript_version_id: decided.winner_manuscript_version_id,
              selection_required: decided.selection_required,
            }
          : null,
        items: versions.map((v) => ({
          id: v.id,
          version_no: v.version_no,
          status: v.status,
          origin: v.origin,
          content_hash: v.content_hash,
          is_accepted: v.id === chapter.accepted_version_id,
          is_winner: decided?.winner_manuscript_version_id === v.id,
          is_loser: losers.has(v.id),
        })),
      };
    });
  });

  /**
   * The evaluator scorecards of a chapter.
   *
   * Scorecards are read out of `workflow_artifacts`, which is where evaluation wrote them. Prompt text,
   * provider payloads and raw model output are NOT part of a scorecard artifact and are not joined in here:
   * an operator needs the dimensions, scores and issues, not the call that produced them.
   */
  app.get('/v1/projects/:projectId/chapters/:number/scorecards', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const chapterNo = chapterNumberOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const chapter = await chapterByNumber(c, projectId, chapterNo);
      if (!chapter) throw new ApiError('NOT_FOUND', `Chapter ${chapterNo} does not exist.`);
      const rows = await c.query<{ id: string; key: string; payload: unknown; created_at: Date }>(
        `SELECT id, key, payload, created_at FROM workflow_artifacts
          WHERE project_id = $1 AND kind = 'scorecard'
          ORDER BY created_at, id`,
        [projectId],
      );
      return {
        chapter_no: chapterNo,
        items: rows.rows.map((row) => ({
          artifact_id: row.id,
          key: row.key,
          scorecard: row.payload,
          created_at: row.created_at,
        })),
      };
    });
  });

  /**
   * The chapter trace: job, artifacts, evaluation, approval, extraction and canon commit in one read.
   *
   * REDACTION IS THE POINT OF THE SHAPE. The trace names artifacts by id, kind and step; it does not inline
   * `llm_output` payloads, prompt text or provider responses, and it never joins the prompt registry. An
   * operator debugging a chapter needs to know which steps ran, what they produced and what was committed —
   * not the credentials or prompts that produced them.
   */
  app.get('/v1/projects/:projectId/chapters/:number/trace', async (req) => {
    const scope = await scoped(req);
    requireRole(scope, 'viewer');
    const projectId = projectIdOf(req);
    const chapterNo = chapterNumberOf(req);
    return inScope(scope, async (c) => {
      await projectOr404(c, projectId);
      const chapter = await chapterByNumber(c, projectId, chapterNo);
      if (!chapter) throw new ApiError('NOT_FOUND', `Chapter ${chapterNo} does not exist.`);

      const job = await c.query<{
        id: string;
        status: string;
        control: string;
        current_step: string | null;
        spend_cents: string;
        created_at: Date;
        finished_at: Date | null;
      }>(
        `SELECT id, status, control, current_step, spend_cents::text AS spend_cents, created_at, finished_at
           FROM jobs
          WHERE project_id = $1 AND target_kind = 'chapter' AND target_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [projectId, chapter.id],
      );
      const jobRow = job.rows[0];

      const steps = jobRow
        ? (
            await c.query<{ step: string; status: string; attempt: number; started_at: Date }>(
              `SELECT step, status, attempt, started_at FROM job_steps
                WHERE job_id = $1 ORDER BY started_at, step`,
              [jobRow.id],
            )
          ).rows
        : [];

      // Artifact METADATA only — never the payload, which for `llm_output` is raw model text.
      const artifacts = await c.query<{
        id: string;
        step: string;
        kind: string;
        key: string;
        content_hash: string;
        created_at: Date;
      }>(
        `SELECT id, step, kind, key, content_hash, created_at FROM workflow_artifacts
          WHERE project_id = $1 AND kind <> 'llm_output'
          ORDER BY created_at, id
          LIMIT 500`,
        [projectId],
      );

      const versions = await manuscriptVersionsOf(c, chapter.id);
      const reviews = await listChapterReviews(c, { projectId, chapterNo });
      const commits = await c.query<{
        version: number;
        source: string;
        created_at: Date;
        manuscript_version_id: string | null;
      }>(
        `SELECT version, source, created_at, manuscript_version_id FROM canon_commits
          WHERE project_id = $1 ORDER BY version`,
        [projectId],
      );
      const acceptedCommit = commits.rows.find(
        (row) => row.manuscript_version_id === chapter.accepted_version_id,
      );

      return {
        chapter_no: chapterNo,
        chapter_status: chapter.status,
        accepted_version_id: chapter.accepted_version_id,
        job: jobRow
          ? {
              id: jobRow.id,
              status: jobRow.status,
              control: jobRow.control,
              current_step: jobRow.current_step,
              spend_cents: Number(jobRow.spend_cents),
              created_at: jobRow.created_at,
              finished_at: jobRow.finished_at,
            }
          : null,
        steps,
        artifacts: artifacts.rows,
        versions: versions.map((v) => ({
          id: v.id,
          version_no: v.version_no,
          status: v.status,
          origin: v.origin,
          is_accepted: v.id === chapter.accepted_version_id,
        })),
        reviews: reviews.map((row) => ({
          decision: row.decision,
          manuscript_version_id: row.manuscript_version_id,
          created_at: row.created_at,
        })),
        canon_commit: acceptedCommit
          ? {
              version: acceptedCommit.version,
              source: acceptedCommit.source,
              created_at: acceptedCommit.created_at,
            }
          : null,
      };
    });
  });

  // ---- local helpers ----------------------------------------------------------------------------------

  function requirementIdOf(req: FastifyRequest): string {
    const raw = (req.params as { requirementId?: string }).requirementId ?? '';
    if (!/^REQ-[0-9]{3,5}$/.test(raw))
      throw new ApiError('VALIDATION_FAILED', '"params.requirementId" is not a requirement id.', {
        errors: [{ path: 'params.requirementId', message: 'must match REQ-000' }],
      });
    return raw;
  }

  function chapterNumberOf(req: FastifyRequest): number {
    return requireInt((req.params as { number?: string }).number, 'params.number', {
      min: 1,
      max: 10_000,
    });
  }

  /** Resolve an entity inside the RLS scope; a foreign or unknown id is the same 404. */
  async function entityOr404(c: Client, projectId: string, entityId: string): Promise<void> {
    const r = await c.query('SELECT 1 FROM entities WHERE project_id = $1 AND id = $2', [
      projectId,
      entityId,
    ]);
    if (r.rowCount === 0) throw new ApiError('NOT_FOUND', 'That entity does not exist.');
  }
}

export { getManuscriptVersion };
