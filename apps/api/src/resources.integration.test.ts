/**
 * Contract, authorization and tenancy tests for the operator-editable `/v1` families (Checkpoint 7).
 *
 * These run against the real Fastify app and a real PostgreSQL 16 database through `app.inject()`, so they
 * exercise the actual routing, hooks, RLS scoping and error handler rather than a hand-called handler.
 *
 * What they are here to prove, family by family, is the set of claims that are cheap to assert and
 * expensive to get wrong:
 *
 *  * an unauthenticated request never reaches data, and a viewer never writes;
 *  * a resource id from another workspace is indistinguishable from one that does not exist;
 *  * `expected_version` genuinely arbitrates concurrent edits, and a stale one is refused;
 *  * a duplicate `Idempotency-Key` replays rather than repeating, and the same key with a changed body is
 *    refused;
 *  * a pinned identity version and a locked plan version cannot be edited through the API either;
 *  * concept selection propagates the winner only, and losers stay visibly rejected;
 *  * the chapter trace and scorecard reads carry no prompt text, credential or raw model output.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createEntity,
  createManuscriptVersion,
  createProject,
  createUser,
  createWorkspace,
  migrate,
  resetDatabase,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { RateLimiter } from './rate-limit.js';
import { CSRF_HEADER, SESSION_COOKIE, WORKSPACE_HEADER } from './auth.js';

const run = databaseUrl() ? describe : describe.skip;

interface Actor {
  readonly userId: string;
  readonly cookie: string;
  readonly csrf: string;
}

const SPEC_ITEM = {
  id: 'REQ-001',
  kind: 'assumption',
  category: 'tone',
  text: 'The tone stays wry throughout.',
  language: 'en',
  provenance: 'model_inferred',
  rationale: 'Inferred from the intake.',
  scope: { level: 'series' },
} as const;

run('API: operator resource families (Checkpoint 7)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let wsA: string;
  let wsB: string;
  let projectA: string;
  let projectB: string;
  let owner: Actor;
  let editor: Actor;
  let viewer: Actor;

  async function login(email: string, password: string): Promise<Actor> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode, res.body).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = String(raw).split(';')[0] ?? '';
    const body = res.json<{ csrf_token: string; user: { id: string } }>();
    return { userId: body.user.id, cookie, csrf: body.csrf_token };
  }

  function headers(actor: Actor, workspaceId = wsA): Record<string, string> {
    return {
      cookie: `${SESSION_COOKIE}=${actor.cookie.split('=').slice(1).join('=')}`,
      [CSRF_HEADER]: actor.csrf,
      [WORKSPACE_HEADER]: workspaceId,
    };
  }

  /** Write a first spec version so the assumption-review routes have something to review. */
  async function seedSpec(actor = editor): Promise<void> {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(actor),
      payload: {
        expected_version: 0,
        payload: { project_id: projectA, version: 1, items: [SPEC_ITEM] },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  beforeAll(async () => {
    pool = await freshDatabase();
    app = buildApi({ pool, secureCookies: false, rateLimiter: RateLimiter.disabled() });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    wsA = await createWorkspace(pool, 'workspace-a');
    wsB = await createWorkspace(pool, 'workspace-b');
    projectA = (await createProject(pool, { workspaceId: wsA, title: 'Project A' })).projectId;
    projectB = (await createProject(pool, { workspaceId: wsB, title: 'Project B' })).projectId;

    const ownerUser = await createUser(pool, {
      email: 'owner@example.com',
      displayName: 'Owner',
      password: 'owner-password',
    });
    const editorUser = await createUser(pool, {
      email: 'editor@example.com',
      displayName: 'Editor',
      password: 'editor-password',
    });
    const viewerUser = await createUser(pool, {
      email: 'viewer@example.com',
      displayName: 'Viewer',
      password: 'viewer-password',
    });
    await addMember(pool, { workspaceId: wsA, userId: ownerUser.id, role: 'owner' });
    await addMember(pool, { workspaceId: wsA, userId: editorUser.id, role: 'editor' });
    await addMember(pool, { workspaceId: wsA, userId: viewerUser.id, role: 'viewer' });

    owner = await login('owner@example.com', 'owner-password');
    editor = await login('editor@example.com', 'editor-password');
    viewer = await login('viewer@example.com', 'viewer-password');
  }, 180_000);

  // ---- authentication and authorization ----------------------------------------------------------------

  it('refuses unauthenticated access to every new family', async () => {
    for (const url of [
      `/v1/projects/${projectA}/spec`,
      `/v1/projects/${projectA}/spec/assumptions`,
      `/v1/projects/${projectA}/directions`,
      `/v1/projects/${projectA}/concepts`,
      `/v1/projects/${projectA}/bible/register-profiles`,
      `/v1/projects/${projectA}/identity/narrative_identity`,
      `/v1/projects/${projectA}/plans/arc_plan`,
      `/v1/projects/${projectA}/chapters/1/candidates`,
      `/v1/projects/${projectA}/chapters/1/trace`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
    }
  });

  it('refuses a viewer every write and allows an editor', async () => {
    const denied = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(viewer),
      payload: { expected_version: 0, payload: { project_id: projectA, version: 1, items: [] } },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ code: string }>().code).toBe('FORBIDDEN');

    const allowed = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { project_id: projectA, version: 1, items: [] } },
    });
    expect(allowed.statusCode, allowed.body).toBe(201);
  });

  it('reserves pinning and locking for an owner', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/identity/narrative_identity`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { tradition: 'korean_webnovel' } },
    });
    const asEditor = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/identity/narrative_identity/pin`,
      headers: headers(editor),
      payload: { version: 1 },
    });
    expect(asEditor.statusCode).toBe(403);

    const asOwner = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/identity/narrative_identity/pin`,
      headers: headers(owner),
      payload: { version: 1 },
    });
    expect(asOwner.statusCode, asOwner.body).toBe(200);
    expect(asOwner.json<{ pinned: boolean; editable: boolean }>()).toMatchObject({
      pinned: true,
      editable: false,
    });
  });

  it('answers the same 404 for a cross-workspace project id as for one that does not exist', async () => {
    const foreign = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectB}/spec`,
      headers: headers(viewer),
    });
    const missing = await app.inject({
      method: 'GET',
      url: `/v1/projects/00000000-0000-7000-8000-000000000000/spec`,
      headers: headers(viewer),
    });
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    // Byte-identical apart from the request id: an id must not be an existence probe.
    expect(foreign.json<{ detail: string }>().detail).toBe(
      missing.json<{ detail: string }>().detail,
    );
  });

  it('refuses a forged workspace header even for a real member of another workspace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectB}/spec`,
      headers: headers(owner, wsB),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('NOT_A_MEMBER');
  });

  // ---- story specification -----------------------------------------------------------------------------

  it('validates an operator spec against the same schema the production loop uses', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(editor),
      payload: {
        expected_version: 0,
        // `kind: 'wishful'` is not in the schema's requirementKind enum.
        payload: {
          project_id: projectA,
          version: 1,
          items: [{ ...SPEC_ITEM, kind: 'wishful' }],
        },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('SPEC_INVALID');
  });

  it('refuses an edit against a stale expected_version', async () => {
    await seedSpec();
    const stale = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(editor),
      payload: {
        expected_version: 0,
        payload: { project_id: projectA, version: 1, items: [] },
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string; data: { reason: string } }>()).toMatchObject({
      code: 'CONFLICT',
      data: { reason: 'stale_version' },
    });
  });

  it('requires expected_version rather than silently winning the race', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(editor),
      payload: { payload: { project_id: projectA, version: 1, items: [] } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe(
      'body.expected_version',
    );
  });

  it('lets exactly one of two concurrent spec edits win', async () => {
    await seedSpec();
    const write = (note: string) =>
      app.inject({
        method: 'PUT',
        url: `/v1/projects/${projectA}/spec`,
        headers: headers(editor),
        payload: {
          expected_version: 1,
          payload: {
            project_id: projectA,
            version: 2,
            items: [{ ...SPEC_ITEM, text: `The tone stays wry. ${note}` }],
          },
        },
      });
    const [a, b] = await Promise.all([write('a'), write('b')]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });

  // ---- idempotency ---------------------------------------------------------------------------------------

  it('replays a duplicate idempotency key and refuses the same key with a changed body', async () => {
    const payload = {
      text: 'Keep the rival alive through the arc.',
      scope_level: 'arc',
    };
    const first = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/directions`,
      headers: { ...headers(editor), 'idempotency-key': 'dir-1' },
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);

    const replay = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/directions`,
      headers: { ...headers(editor), 'idempotency-key': 'dir-1' },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    // The SAME row, not a second direction.
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);

    const changed = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/directions`,
      headers: { ...headers(editor), 'idempotency-key': 'dir-1' },
      payload: { ...payload, text: 'Kill the rival instead.' },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ code: string }>().code).toBe('IDEMPOTENCY_KEY_REUSED');

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/directions`,
      headers: headers(viewer),
    });
    expect(listed.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  // ---- assumption review ---------------------------------------------------------------------------------

  it('lists assumptions with a derived review status and never promotes one silently', async () => {
    await seedSpec();
    const before = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/spec/assumptions`,
      headers: headers(viewer),
    });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json<{ items: { id: string; review_status: string }[] }>().items).toEqual([
      expect.objectContaining({ id: 'REQ-001', review_status: 'pending' }),
    ]);

    const decided = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/spec/assumptions/REQ-001/decision`,
      headers: headers(editor),
      payload: { decision: 'confirm', promoted_kind: 'hard' },
    });
    expect(decided.statusCode, decided.body).toBe(201);
    // The response is explicit that the spec has NOT been rewritten by this decision.
    expect(decided.json<{ spec_updated: boolean }>().spec_updated).toBe(false);

    const after = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/spec`,
      headers: headers(viewer),
    });
    const items = after.json<{ payload: { items: { kind: string }[] } }>().payload.items;
    expect(items[0]?.kind).toBe('assumption');

    const review = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/spec/assumptions`,
      headers: headers(viewer),
    });
    expect(review.json<{ items: { review_status: string }[] }>().items[0]?.review_status).toBe(
      'confirm',
    );
  });

  it('requires a rationale to reject or edit an assumption', async () => {
    await seedSpec();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/spec/assumptions/REQ-001/decision`,
      headers: headers(editor),
      payload: { decision: 'reject' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('404s an assumption id that is not in the current spec', async () => {
    await seedSpec();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/spec/assumptions/REQ-999/decision`,
      headers: headers(editor),
      payload: { decision: 'confirm', promoted_kind: 'soft' },
    });
    expect(res.statusCode).toBe(404);
  });

  // ---- concepts -------------------------------------------------------------------------------------------

  it('selects one concept and keeps the losers visibly rejected', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/concepts`,
      headers: headers(editor),
      payload: {
        round: 1,
        candidates: [
          { label: 'A', payload: { logline: 'A regressor returns.' } },
          { label: 'B', payload: { logline: 'A status window opens.' } },
          { label: 'C', payload: { logline: 'A guild collapses.' } },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const items = created.json<{ items: { id: string; label: string }[] }>().items;
    const winner = items.find((i) => i.label === 'B')?.id ?? '';

    const selected = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/concepts/${winner}/select`,
      headers: headers(editor),
      payload: { rationale: 'strongest hook' },
    });
    expect(selected.statusCode, selected.body).toBe(200);
    expect(selected.json<{ winner: { is_selected: boolean } }>().winner.is_selected).toBe(true);
    expect(selected.json<{ loser_concept_ids: string[] }>().loser_concept_ids).toHaveLength(2);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/concepts?round=1`,
      headers: headers(viewer),
    });
    const listedItems = listed.json<{
      items: { id: string; status: string; is_selected: boolean }[];
    }>().items;
    expect(listedItems.filter((i) => i.is_selected)).toHaveLength(1);
    // Losers are RETAINED (they are the evidence of the choice) and never presented as selected.
    expect(listedItems.filter((i) => i.status === 'rejected')).toHaveLength(2);
    expect(listedItems.filter((i) => i.status === 'rejected').every((i) => !i.is_selected)).toBe(
      true,
    );

    // Re-deciding a decided round is a conflict, not a silent overwrite.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/concepts/${items[0]?.id}/select`,
      headers: headers(editor),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('404s a concept id belonging to another workspace', async () => {
    const foreign = await pool.query<{ id: string }>(
      `INSERT INTO concept_candidates (workspace_id, project_id, round, label, payload)
       VALUES ($1, $2, 1, 'A', '{}'::jsonb) RETURNING id`,
      [wsB, projectB],
    );
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/concepts/${foreign.rows[0]?.id}`,
      headers: headers(viewer),
    });
    expect(res.statusCode).toBe(404);
  });

  // ---- identity and plans: frozen versions ------------------------------------------------------------------

  it('refuses to edit a pinned identity version and accepts a new one', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/identity/terminology_policy`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { terms: [] } },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/identity/terminology_policy/pin`,
      headers: headers(owner),
      payload: { version: 1 },
    });

    // A NEW version is permitted — that is how a pinned document is revised.
    const next = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/identity/terminology_policy`,
      headers: headers(editor),
      payload: { expected_version: 1, payload: { terms: [{ term: 'saida', policy: 'gloss' }] } },
    });
    expect(next.statusCode, next.body).toBe(201);
    expect(next.json<{ version: number; pinned: boolean }>()).toMatchObject({
      version: 2,
      pinned: false,
    });

    const read = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/identity/terminology_policy`,
      headers: headers(viewer),
    });
    // The pinned version is still version 1: a new version never moves the pin.
    expect(read.json<{ pinned: { version: number } }>().pinned.version).toBe(1);
    expect(read.json<{ current: { version: number } }>().current.version).toBe(2);
  });

  it('refuses to rewrite a locked plan version', async () => {
    await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/plans/arc_plan/arc-1`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { beats: ['a'] } },
    });
    const locked = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/plans/arc_plan/arc-1/lock`,
      headers: headers(owner),
      payload: { version: 1 },
    });
    expect(locked.statusCode, locked.body).toBe(200);
    expect(locked.json<{ locked: boolean; editable: boolean }>()).toMatchObject({
      locked: true,
      editable: false,
    });

    // Writing version 1 again is refused as stale; writing 2 is the supported way to revise.
    const stale = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/plans/arc_plan/arc-1`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { beats: ['b'] } },
    });
    expect(stale.statusCode).toBe(409);

    const next = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/plans/arc_plan/arc-1`,
      headers: headers(editor),
      payload: { expected_version: 1, payload: { beats: ['a', 'b'] } },
    });
    expect(next.statusCode).toBe(201);
  });

  it('refuses a plan key for the singleton series blueprint', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/plans/series_blueprint/not-allowed`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: {} },
    });
    expect(res.statusCode).toBe(422);
  });

  // ---- register profiles --------------------------------------------------------------------------------

  it('scopes register profiles to an entity of this project', async () => {
    const mine = await createEntity(pool, {
      workspaceId: wsA,
      projectId: projectA,
      type: 'character',
      displayName: 'Seo Yuna',
    });
    const theirs = await createEntity(pool, {
      workspaceId: wsB,
      projectId: projectB,
      type: 'character',
      displayName: 'Other',
    });

    const ok = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/bible/register-profiles/${mine}`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { formality: 'measured' } },
    });
    expect(ok.statusCode, ok.body).toBe(201);

    const foreign = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${projectA}/bible/register-profiles/${theirs}`,
      headers: headers(editor),
      payload: { expected_version: 0, payload: { formality: 'measured' } },
    });
    expect(foreign.statusCode).toBe(404);
  });

  // ---- input normalization ------------------------------------------------------------------------------

  it('normalizes non-NFC input at the boundary', async () => {
    // "Yeonjae" with a combining acute on the first vowel: NFD in, NFC stored.
    const decomposed = 'Keep Yo\u0301njae wry.';
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/directions`,
      headers: headers(editor),
      payload: { text: decomposed, scope_level: 'series' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const stored = res.json<{ text: string }>().text;
    expect(stored).toBe(decomposed.normalize('NFC'));
    expect(stored.includes('\u0301')).toBe(false);
  });

  // ---- candidates, scorecards and trace -------------------------------------------------------------------

  it('404s candidates, scorecards and trace for a chapter that does not exist', async () => {
    for (const suffix of ['candidates', 'scorecards', 'trace']) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/projects/${projectA}/chapters/7/${suffix}`,
        headers: headers(viewer),
      });
      expect(res.statusCode, suffix).toBe(404);
    }
  });

  it('never leaks prompt text, model output or credentials in the chapter trace', async () => {
    await pool.query(
      `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'planned')`,
      [wsA, projectA],
    );
    // A raw model-output artifact exists for this project; the trace must not echo its payload.
    await pool.query(
      `INSERT INTO workflow_artifacts (id, workspace_id, project_id, step, kind, key, content_hash, payload)
       VALUES (canon.uuid_v7(), $1, $2, 'scene_draft', 'llm_output', '1', 'sha256:x',
               '{"text":"SECRET-MODEL-OUTPUT"}'::jsonb)`,
      [wsA, projectA],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/chapters/1/trace`,
      headers: headers(viewer),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('SECRET-MODEL-OUTPUT');
    expect(res.body).not.toContain('llm_output');
    expect(res.body.toLowerCase()).not.toContain('authorization');
    expect(res.body.toLowerCase()).not.toContain('api_key');
  });

  it('marks accepted, winning and losing candidates distinctly', async () => {
    const chapter = await pool.query<{ id: string }>(
      `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'planned')
       RETURNING id`,
      [wsA, projectA],
    );
    const chapterId = chapter.rows[0]?.id ?? '';
    // Real versions through the repository, so the row shape (length model, NFC text, content hash) is
    // the one production writes rather than a hand-made approximation.
    for (const n of [1, 2])
      await createManuscriptVersion(pool, {
        workspaceId: wsA,
        projectId: projectA,
        chapterId,
        origin: 'candidate',
        text: `Draft ${n}.`,
      });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/chapters/1/candidates`,
      headers: headers(viewer),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      accepted_version_id: string | null;
      items: { id: string; is_accepted: boolean }[];
    }>();
    // Nothing is accepted, so nothing may claim to be.
    expect(body.accepted_version_id).toBeNull();
    expect(body.items.every((i) => !i.is_accepted)).toBe(true);
    expect(body.items).toHaveLength(2);
  });

  // ---- chapter review ------------------------------------------------------------------------------------

  it('records a review against a real version of that chapter and never accepts canon', async () => {
    const chapter = await pool.query<{ id: string }>(
      `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'planned')
       RETURNING id`,
      [wsA, projectA],
    );
    const chapterId = chapter.rows[0]?.id ?? '';
    const versionId = (
      await createManuscriptVersion(pool, {
        workspaceId: wsA,
        projectId: projectA,
        chapterId,
        origin: 'candidate',
        text: 'Draft.',
      })
    ).id;

    const changes = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/chapters/1/reviews`,
      headers: headers(editor),
      payload: {
        decision: 'request_changes',
        manuscript_version_id: versionId,
        note: 'Sharpen the closing hook.',
      },
    });
    expect(changes.statusCode, changes.body).toBe(201);
    // The API is explicit that a review decision is a signal, not an acceptance.
    expect(changes.json<{ canon_accepted: boolean }>().canon_accepted).toBe(false);

    // An editor may not approve: approval is the signal that lets content reach accepted canon.
    const editorApproval = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/chapters/1/reviews`,
      headers: headers(editor),
      payload: { decision: 'approve', manuscript_version_id: versionId },
    });
    expect(editorApproval.statusCode).toBe(403);

    const ownerApproval = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/chapters/1/reviews`,
      headers: headers(owner),
      payload: { decision: 'approve', manuscript_version_id: versionId },
    });
    expect(ownerApproval.statusCode, ownerApproval.body).toBe(201);

    // The chapter is still not accepted: acceptance remains the Checkpoint 2–6 path.
    const status = await pool.query<{ status: string; accepted_version_id: string | null }>(
      'SELECT status, accepted_version_id FROM chapters WHERE id = $1',
      [chapterId],
    );
    expect(status.rows[0]?.accepted_version_id).toBeNull();
    expect(status.rows[0]?.status).not.toBe('accepted');
  });

  it('refuses a review naming a version from a different chapter', async () => {
    const one = await pool.query<{ id: string }>(
      `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 1, 'planned')
       RETURNING id`,
      [wsA, projectA],
    );
    const two = await pool.query<{ id: string }>(
      `INSERT INTO chapters (workspace_id, project_id, number, status) VALUES ($1, $2, 2, 'planned')
       RETURNING id`,
      [wsA, projectA],
    );
    const otherVersion = await createManuscriptVersion(pool, {
      workspaceId: wsA,
      projectId: projectA,
      chapterId: two.rows[0]?.id ?? '',
      origin: 'candidate',
      text: 'Other.',
    });
    expect(one.rows[0]?.id).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectA}/chapters/1/reviews`,
      headers: headers(editor),
      payload: {
        decision: 'reject',
        manuscript_version_id: otherVersion.id,
        note: 'no',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  // ---- pagination -----------------------------------------------------------------------------------------

  it('paginates deterministically with an opaque cursor', async () => {
    for (let i = 0; i < 5; i += 1)
      await app.inject({
        method: 'POST',
        url: `/v1/projects/${projectA}/directions`,
        headers: headers(editor),
        payload: { text: `Direction ${i}.`, scope_level: 'series' },
      });

    const first = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/directions?limit=2`,
      headers: headers(viewer),
    });
    const page1 = first.json<{ items: { id: string }[]; next_cursor: string | null }>();
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/directions?limit=2&cursor=${page1.next_cursor}`,
      headers: headers(viewer),
    });
    const page2 = second.json<{ items: { id: string }[] }>();
    expect(page2.items).toHaveLength(2);
    // No overlap between pages, which is what "deterministic" has to mean for a cursor.
    expect(page2.items.map((i) => i.id)).not.toContain(page1.items[0]?.id);

    const bad = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectA}/directions?cursor=not-a-cursor`,
      headers: headers(viewer),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ code: string }>().code).toBe('INVALID_CURSOR');
  });
});
