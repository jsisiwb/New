/**
 * The novel surface over HTTP: authentication, the role matrix, NO_PROVIDER refusal, and the happy path
 * intake → suggestions → approve → (runner) → status with a simulated model.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createProject,
  createUser,
  createWorkspace,
  PgAuditStore,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { Gateway, MemoryBudget, MockProvider, type ProviderRequest } from '@yeonjae/gateway';
import { ArtifactLlmOutputStore, NovelRunner, type NovelDeps } from '@yeonjae/workflows';
import { IDENTITY_REF, IDENTITY_VERSION, REPLAY_ROUTING } from '@yeonjae/workflows/testkit';
import type { FastifyInstance } from 'fastify';
import { CSRF_HEADER, WORKSPACE_HEADER } from './auth.js';
import { RateLimiter } from './rate-limit.js';
import { buildApi } from './server.js';

const run = databaseUrl() ? describe : describe.skip;

interface Actor {
  readonly cookie: string;
  readonly csrf: string;
}

const INTAKE = {
  title_working: 'Salt Road',
  premise:
    'A courier who can taste lies is hired to carry a treaty across a desert where every oasis is owned by a different liar.',
  genre: { primary: 'modern-fantasy' },
  main_character: { name: 'Ha Ru-mi', description: 'Courier. Tastes lies as salt.' },
  target_chapters: 1,
  target_words_per_chapter: 600,
  ending_preference: 'open',
};

/** A minimal model: enough for the suggestion stage; the runner path is proved in @yeonjae/workflows. */
function script(req: ProviderRequest) {
  const role = req.trace?.role ?? '';
  if (role === 'requirement_interpreter')
    return {
      json: {
        items: [
          {
            id: 'REQ-001',
            kind: 'hard',
            category: 'premise',
            text: INTAKE.premise,
            language: 'en',
            provenance: 'user',
            confirmed_by_user: true,
            scope: { level: 'series' },
          },
        ],
      },
    };
  if (role === 'concept_generator') {
    const angle = /Angle seed for this candidate: (.+)/.exec(req.user)?.[1] ?? 'angle';
    return {
      json: {
        angle,
        logline: `Ru-mi carries the treaty (${angle.slice(0, 10)}).`,
        story_promise: 'Every lie has a taste.',
        reader_fantasy: 'Seeing through everyone.',
        main_conflict: 'The treaty itself is a lie.',
        chapter_one_hook: 'The first oasis tastes of salt.',
        ending_direction: 'She rewrites the treaty.',
        differentiators: ['taste as lie detection'],
        genre_fit_notes: ['modern fantasy with a road structure'],
        risk_notes: ['episodic sag'],
      },
    };
  }
  return { json: {} };
}

run('API: novel lifecycle routes', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let appNoProvider: FastifyInstance;
  let ws: string;
  let projectId: string;
  let editor: Actor;
  let viewer: Actor;
  let owner: Actor;
  let makeDeps: (input: { workspaceId: string; projectId: string }) => NovelDeps;
  const wakes: number[] = [];

  async function login(a: FastifyInstance, email: string, password: string): Promise<Actor> {
    const res = await a.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode, res.body).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return {
      cookie: String(raw).split(';')[0] ?? '',
      csrf: res.json<{ csrf_token: string }>().csrf_token,
    };
  }
  const authed = (actor: Actor): Record<string, string> => ({
    cookie: actor.cookie,
    [WORKSPACE_HEADER]: ws,
    [CSRF_HEADER]: actor.csrf,
  });

  beforeAll(async () => {
    pool = await freshDatabase();
    ws = await createWorkspace(pool, 'novel-api');
    projectId = (
      await createProject(pool, {
        workspaceId: ws,
        title: 'Salt Road',
        settings: {
          narrative_identity_ref: IDENTITY_REF,
          narrative_identity_version_id: IDENTITY_VERSION,
        },
      })
    ).projectId;
    const provider = new MockProvider(script);
    const routing = Object.fromEntries(
      Object.entries(REPLAY_ROUTING).map(([k, v]) => [
        k,
        v.map((r) => ({ ...r, provider: 'mock' })),
      ]),
    ) as typeof REPLAY_ROUTING;
    makeDeps = ({ workspaceId, projectId: p }) => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(1_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId: p },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId: p }),
        ),
        guardContext: { pinnedIdentityVersionId: IDENTITY_VERSION },
      }),
    });
    app = buildApi({
      pool,
      secureCookies: false,
      rateLimiter: RateLimiter.disabled(),
      novelDeps: makeDeps,
      onNovelQueued: () => {
        wakes.push(Date.now());
      },
    });
    appNoProvider = buildApi({ pool, secureCookies: false, rateLimiter: RateLimiter.disabled() });
    await app.ready();
    await appNoProvider.ready();
    for (const [email, name, role] of [
      ['owner@example.com', 'Owner', 'owner'],
      ['editor@example.com', 'Editor', 'editor'],
      ['viewer@example.com', 'Viewer', 'viewer'],
    ] as const) {
      const u = await createUser(pool, {
        email,
        displayName: name,
        password: `${name}-password-1`,
      });
      await addMember(pool, { workspaceId: ws, userId: u.id, role });
    }
    owner = await login(app, 'owner@example.com', 'Owner-password-1');
    editor = await login(app, 'editor@example.com', 'Editor-password-1');
    viewer = await login(app, 'viewer@example.com', 'Viewer-password-1');
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await appNoProvider.close();
    await pool.end();
  });

  it('requires authentication and the editor role to start a novel', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel`,
      payload: { intake: INTAKE },
    });
    expect(anon.statusCode).toBe(401);
    const asViewer = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel`,
      headers: authed(viewer),
      payload: { intake: INTAKE },
    });
    expect(asViewer.statusCode).toBe(403);
  });

  it('answers NO_PROVIDER when the process has no model configured, and 404 before a run exists', async () => {
    const viewerLogin = await login(appNoProvider, 'editor@example.com', 'Editor-password-1');
    const res = await appNoProvider.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel`,
      headers: {
        cookie: viewerLogin.cookie,
        [WORKSPACE_HEADER]: ws,
        [CSRF_HEADER]: viewerLogin.csrf,
      },
      payload: { intake: INTAKE },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ code: string }>().code).toBe('NO_PROVIDER');
    const status = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/novel`,
      headers: authed(viewer),
    });
    expect(status.statusCode).toBe(404);
  });

  it('rejects an invalid intake with the schema errors', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel`,
      headers: authed(editor),
      payload: { intake: { title_working: 'x', premise: 'too short', genre: { primary: 'nope' } } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('INTAKE_INVALID');
  });

  it('runs intake → suggestions → approve → status, then the runner completes the run', async () => {
    const started = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel`,
      headers: { ...authed(editor), 'idempotency-key': 'novel-start-1' },
      payload: { intake: INTAKE },
    });
    expect(started.statusCode, started.body).toBe(201);
    const body = started.json<{
      run: { status: string };
      suggestions: { id: string; logline: string }[];
    }>();
    expect(body.run.status).toBe('awaiting_approval');
    expect(body.suggestions.length).toBeGreaterThanOrEqual(2);

    // Idempotent replay of the same key returns the same body without new calls.
    const replay = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel`,
      headers: { ...authed(editor), 'idempotency-key': 'novel-start-1' },
      payload: { intake: INTAKE },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(started.json());

    const status = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/novel`,
      headers: authed(viewer),
    });
    expect(status.statusCode).toBe(200);
    const s = status.json<{
      run: { status: string };
      suggestions: { id: string; status: string }[];
      plan: null;
    }>();
    expect(s.run.status).toBe('awaiting_approval');
    expect(s.suggestions.every((c) => c.status === 'candidate')).toBe(true);
    expect(s.plan).toBeNull();

    // A viewer cannot approve; an editor can.
    const concept = body.suggestions[0]?.id ?? '';
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/approve`,
      headers: authed(viewer),
      payload: { concept_id: concept },
    });
    expect(denied.statusCode).toBe(403);
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/approve`,
      headers: authed(editor),
      payload: { concept_id: concept, auto_continue: false },
    });
    expect(approved.statusCode, approved.body).toBe(202);
    expect(approved.json<{ run: { status: string; auto_continue: boolean } }>().run).toMatchObject({
      status: 'planning',
      auto_continue: false,
    });

    // Approving twice is refused truthfully (the run is no longer awaiting approval).
    const again = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/approve`,
      headers: authed(editor),
      payload: { concept_id: concept },
    });
    expect(again.statusCode).toBe(409);

    // Cancel is owner-only.
    const cancelDenied = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/cancel`,
      headers: authed(editor),
    });
    expect(cancelDenied.statusCode).toBe(403);

    // Pause the queued run, observe it, resume it; the event log records both.
    const paused = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/pause`,
      headers: authed(editor),
    });
    expect(paused.statusCode).toBe(202);
    expect(paused.json<{ run: { status: string } }>().run.status).toBe('paused');
    const runner = new NovelRunner({ pool, makeDeps, runnerId: 'api-test' });
    expect(await runner.tick()).toBe(false);
    const resumed = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/resume`,
      headers: authed(editor),
    });
    expect(resumed.statusCode).toBe(202);
    expect(resumed.json<{ run: { status: string } }>().run.status).toBe('planning');
    // Approval and resume both nudge an in-process runner.
    expect(wakes.length).toBeGreaterThanOrEqual(2);
    const events = await app.inject({
      method: 'GET',
      url: `/v1/projects/${projectId}/novel/events`,
      headers: authed(viewer),
    });
    expect(events.statusCode).toBe(200);
    const kinds = events.json<{ items: { kind: string }[] }>().items.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'run.created',
        'run.suggestions_ready',
        'run.approved',
        'run.pause_requested',
        'run.resumed',
      ]),
    );

    // The owner cancels; the run rests as cancelled and is no longer claimable.
    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/projects/${projectId}/novel/cancel`,
      headers: authed(owner),
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancelled.json<{ run: { status: string } }>().run.status).toBe('cancelled');
    expect(await runner.tick()).toBe(false);
  }, 120_000);
});
