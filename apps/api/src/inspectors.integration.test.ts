/**
 * Canon inspector, cost and budget reads (Checkpoint 7).
 *
 * These routes back the operator UI's inspector screens. They are reads, so the risks are different from
 * the mutating surface and are what this suite targets:
 *
 *  * ACCEPTED-ONLY EVIDENCE. Evidence spans quote manuscript text — that is what evidence is — so the
 *    evidence route is the one canon inspector that can surface prose. It must never return a span whose
 *    manuscript version is a working draft, a quarantined draft or a losing candidate, or the canon API
 *    becomes a side channel for reading unaccepted text.
 *  * THE MATERIAL/CONTEXTUAL SPLIT SURVIVES THE WIRE (ADR-0032). A contextual dependent is a review
 *    suggestion, not an invalidation; if the API flattened them an operator would regenerate needlessly.
 *  * COST DATA CANNOT LEAK PROSE. It is derived from the append-only `llm_calls` audit, which stores
 *    hashes, sizes and cents and never prompt or output bodies.
 *  * pagination is deterministic, filters are validated rather than silently ignored, and cross-workspace
 *    ids are indistinguishable from absent ones.
 *
 * The project is produced by the real Checkpoint 5 acceptance path over the frozen chapter-1 replay
 * fixture, so the canon being inspected is canon the system actually committed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  approveManuscriptVersion,
  createManuscriptVersion,
  createUser,
  createWorkspace,
  getManuscriptVersion,
  migrate,
  resetDatabase,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { RateLimiter } from './rate-limit.js';
import { CSRF_HEADER, WORKSPACE_HEADER } from './auth.js';
import { ensureChapterTwo, seedAcceptedChapterOne, type SeededProject } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

interface Actor {
  readonly cookie: string;
  readonly csrf: string;
  readonly userId: string;
}

run('API: canon inspectors, costs and budgets (Checkpoint 7)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let seeded: SeededProject;
  let viewer: Actor;
  let otherWorkspaceId: string;
  let otherProjectId: string;

  async function login(email: string, password: string): Promise<Actor> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode, res.body).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const body = res.json<{ csrf_token: string; user: { id: string } }>();
    return {
      userId: body.user.id,
      cookie: String(raw).split(';')[0] ?? '',
      csrf: body.csrf_token,
    };
  }

  function authed(actor: Actor): Record<string, string> {
    return {
      cookie: actor.cookie,
      [WORKSPACE_HEADER]: seeded.workspaceId,
      [CSRF_HEADER]: actor.csrf,
    };
  }

  async function get(url: string, actor: Actor = viewer) {
    return app.inject({ method: 'GET', url, headers: authed(actor) });
  }

  beforeAll(async () => {
    pool = await freshDatabase();
    app = buildApi({
      pool,
      secureCookies: false,
      // These suites authenticate many times from one identity, which legitimately exceeds the
      // production auth limit. The limiter is proved in its own unit and integration suites.
      rateLimiter: RateLimiter.disabled(),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    await migrate(pool);
    seeded = await seedAcceptedChapterOne(pool);

    const viewerUser = await createUser(pool, {
      email: 'viewer@example.com',
      displayName: 'Viewer',
      password: 'viewer-password-1',
    });
    await addMember(pool, {
      workspaceId: seeded.workspaceId,
      userId: viewerUser.id,
      role: 'viewer',
    });
    viewer = await login('viewer@example.com', 'viewer-password-1');

    otherWorkspaceId = await createWorkspace(pool, 'Other Tenant');
    const otherProject = await pool.query<{ id: string }>(
      `INSERT INTO projects (workspace_id, title) VALUES ($1, 'Other Tenant Project') RETURNING id`,
      [otherWorkspaceId],
    );
    otherProjectId = otherProject.rows[0]?.id ?? '';
  }, 300_000);

  // ---- authentication ------------------------------------------------------------------------------

  it('refuses every inspector route without authentication', async () => {
    const urls = [
      `/v1/projects/${seeded.projectId}/canon/facts`,
      `/v1/projects/${seeded.projectId}/canon/promises`,
      `/v1/projects/${seeded.projectId}/canon/dependencies`,
      `/v1/projects/${seeded.projectId}/canon/stale`,
      `/v1/projects/${seeded.projectId}/costs`,
      `/v1/projects/${seeded.projectId}/budgets`,
    ];
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(401);
      expect(res.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
    }
  });

  it('hides another workspace’s project behind a 404 on every inspector', async () => {
    for (const path of ['canon/facts', 'canon/promises', 'canon/dependencies', 'canon/stale']) {
      const res = await get(`/v1/projects/${otherProjectId}/${path}`);
      expect(res.statusCode, `${path}: ${res.body}`).toBe(404);
      expect(res.body).not.toContain(otherWorkspaceId);
    }
  });

  // ---- facts ---------------------------------------------------------------------------------------

  it('lists committed canon facts with deterministic cursor pagination', async () => {
    const all = await get(`/v1/projects/${seeded.projectId}/canon/facts?limit=100`);
    expect(all.statusCode, all.body).toBe(200);
    const total = all.json<{ items: { id: string }[] }>().items;
    expect(total.length).toBeGreaterThan(1);

    // One page at a time, following the cursor, must reproduce exactly the same ordered ids.
    const walked: string[] = [];
    let cursor: string | null = null;
    // Bounded generously above the fixture's fact count so an early break is a failure, not a silent pass.
    for (let i = 0; i < 500; i += 1) {
      const url = `/v1/projects/${seeded.projectId}/canon/facts?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await get(url);
      expect(page.statusCode, page.body).toBe(200);
      const body = page.json<{ items: { id: string }[]; next_cursor: string | null }>();
      walked.push(...body.items.map((r) => r.id));
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(total.map((r) => r.id));
  });

  it('filters facts by entity and attribute, and rejects a malformed filter', async () => {
    const all = await get(`/v1/projects/${seeded.projectId}/canon/facts?limit=100`);
    const first = all.json<{ items: { id: string; entity_id: string; attribute: string }[] }>()
      .items[0];
    expect(first).toBeDefined();

    const byEntity = await get(
      `/v1/projects/${seeded.projectId}/canon/facts?entity=${first?.entity_id ?? ''}&limit=100`,
    );
    expect(byEntity.statusCode, byEntity.body).toBe(200);
    const entityRows = byEntity.json<{ items: { entity_id: string }[] }>().items;
    expect(entityRows.length).toBeGreaterThan(0);
    expect(entityRows.every((r) => r.entity_id === first?.entity_id)).toBe(true);

    // A malformed filter is a 422 naming the field, not an empty page that looks like "no data".
    const bad = await get(`/v1/projects/${seeded.projectId}/canon/facts?entity=not-a-uuid`);
    expect(bad.statusCode, bad.body).toBe(422);
    expect(bad.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
  });

  // ---- evidence is accepted-only -------------------------------------------------------------------

  it('returns evidence only from ACCEPTED versions, excluding approved-but-not-accepted text', async () => {
    const facts = await pool.query<{ id: string }>(
      `SELECT f.id FROM facts f JOIN fact_evidence fe ON fe.fact_id = f.id
        WHERE f.project_id = $1 ORDER BY f.id LIMIT 1`,
      [seeded.projectId],
    );
    const factId = facts.rows[0]?.id;
    expect(factId, 'fixture acceptance should have produced evidence-backed facts').toBeDefined();

    const before = await get(`/v1/projects/${seeded.projectId}/canon/facts/${factId}/evidence`);
    expect(before.statusCode, before.body).toBe(200);
    const spans = before.json<{ items: { manuscript_version_id: string; quote: string }[] }>()
      .items;
    expect(spans.length).toBeGreaterThan(0);
    // Every span returned belongs to the accepted version.
    expect(spans.every((s) => s.manuscript_version_id === seeded.acceptedVersionId)).toBe(true);

    /**
     * Why there is no "plant an unaccepted span and watch it be filtered" case here.
     *
     * Attempting it is how the real guarantee became visible, and it is stronger than a route filter:
     *
     *  1. `evidence_span_guard` (migration 0001) refuses a span on a `working` version outright —
     *     "evidence may reference only immutable versions" — so a working draft cannot be cited at all.
     *  2. `canon_write_guard` refuses ANY write to `fact_evidence` from outside `canon.commit_delta`
     *     ("fact_evidence may only be written by canon.commit_delta"), so evidence cannot be linked to a
     *     fact by any path except an atomic canon commit, which only accepts approval-locked text and sets
     *     the version `accepted` in the same transaction.
     *
     * Both refusals are asserted below rather than narrated, so this stays a test and not a comment. The
     * route's accepted-only join is therefore defence in depth over a database that already refuses the
     * dangerous shapes — which is the right order for an invariant this load-bearing.
     */
    const chapterTwoId = await ensureChapterTwo(pool, seeded);
    const WORKING_TEXT = 'WORKING_ONLY_MARKER the tower had not yet fallen at all.';
    const working = await createManuscriptVersion(pool, {
      workspaceId: seeded.workspaceId,
      projectId: seeded.projectId,
      chapterId: chapterTwoId,
      origin: 'assembled',
      text: `${WORKING_TEXT}\n\nHe waited.`,
    });

    // (1) A span citing a working draft is refused by the database.
    await expect(
      pool.query(
        `INSERT INTO evidence_spans (workspace_id, manuscript_version_id, chapter_no, paragraph_id,
                                     start_cp, end_cp, quote, quote_hash)
         VALUES ($1, $2, 2, 'p1', 0, $3, $4, '')`,
        [seeded.workspaceId, working.id, WORKING_TEXT.length, WORKING_TEXT],
      ),
      // A raw pool query surfaces PostgreSQL's P0001 with the stable code in `hint`; only the typed `db`
      // helpers decode that into a `CanonDbError`. Asserting the hint names the real wire contract.
    ).rejects.toMatchObject({ code: 'P0001', hint: 'EVIDENCE_MISMATCH' });

    // (2) Even for a legal span on an APPROVED version, linking it to a fact outside a canon commit is
    // refused — so no unaccepted text can be attached to canon by any route or script.
    const APPROVED_ONLY = 'APPROVED_ONLY_MARKER the gate closed quietly behind them.';
    const approvedOnly = await createManuscriptVersion(pool, {
      workspaceId: seeded.workspaceId,
      projectId: seeded.projectId,
      chapterId: chapterTwoId,
      origin: 'candidate',
      text: `${APPROVED_ONLY}\n\nHe said nothing.`,
    });
    await approveManuscriptVersion(pool, approvedOnly.id, 'tester');
    expect((await getManuscriptVersion(pool, approvedOnly.id))?.status).toBe('approved');
    const span = await pool.query<{ id: string }>(
      `INSERT INTO evidence_spans (workspace_id, manuscript_version_id, chapter_no, paragraph_id,
                                   start_cp, end_cp, quote, quote_hash)
       VALUES ($1, $2, 2, 'p1', 0, $3, $4, '') RETURNING id`,
      [seeded.workspaceId, approvedOnly.id, APPROVED_ONLY.length, APPROVED_ONLY],
    );
    await expect(
      pool.query('INSERT INTO fact_evidence (fact_id, evidence_span_id) VALUES ($1, $2)', [
        factId,
        span.rows[0]?.id,
      ]),
    ).rejects.toMatchObject({ code: 'P0001', hint: 'CANON_WRITE_OUTSIDE_COMMIT' });

    // And the route still returns only accepted-version spans, unchanged by any of the above.
    const after = await get(`/v1/projects/${seeded.projectId}/canon/facts/${factId}/evidence`);
    expect(after.statusCode, after.body).toBe(200);
    expect(after.body).not.toContain('WORKING_ONLY_MARKER');
    expect(after.body).not.toContain('APPROVED_ONLY_MARKER');
    const afterSpans = after.json<{ items: { manuscript_version_id: string }[] }>().items;
    expect(afterSpans.every((s) => s.manuscript_version_id === seeded.acceptedVersionId)).toBe(
      true,
    );
    expect(afterSpans).toHaveLength(spans.length);
  });

  it('404s evidence for a fact that is not in this project', async () => {
    const res = await get(
      `/v1/projects/${seeded.projectId}/canon/facts/00000000-0000-7000-8000-00000000dead/evidence`,
    );
    expect(res.statusCode, res.body).toBe(404);
  });

  // ---- dependencies keep the material/contextual split ---------------------------------------------

  it('separates material dependents from contextual review suggestions', async () => {
    const all = await get(`/v1/projects/${seeded.projectId}/canon/dependencies?limit=100`);
    expect(all.statusCode, all.body).toBe(200);
    const items = all.json<{ items: { materiality: string }[] }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((r) => r.materiality === 'material' || r.materiality === 'contextual')).toBe(
      true,
    );

    const material = await get(
      `/v1/projects/${seeded.projectId}/canon/dependencies?materiality=material&limit=100`,
    );
    const materialRows = material.json<{ items: { materiality: string }[] }>().items;
    expect(materialRows.every((r) => r.materiality === 'material')).toBe(true);

    const bad = await get(
      `/v1/projects/${seeded.projectId}/canon/dependencies?materiality=somewhat`,
    );
    expect(bad.statusCode, bad.body).toBe(422);
  });

  it('reports stale artifacts and states that contextual dependents are only suggestions', async () => {
    const res = await get(`/v1/projects/${seeded.projectId}/canon/stale`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      stale_chapters: { number: number; status: string }[];
      stale_versions: { id: string; chapter_no: number }[];
      note: string;
    }>();
    // A freshly accepted fixture has nothing stale: staleness must be a consequence, never a default.
    expect(body.stale_chapters).toEqual([]);
    expect(body.stale_versions).toEqual([]);
    expect(body.note).toContain('contextual');

    // Mark chapter 1 stale the way a correction does, and it appears with its accepted version.
    await pool.query(`UPDATE chapters SET status = 'stale' WHERE project_id = $1 AND number = 1`, [
      seeded.projectId,
    ]);
    const after = await get(`/v1/projects/${seeded.projectId}/canon/stale`);
    const afterBody = after.json<{
      stale_chapters: { number: number }[];
      stale_versions: { id: string; chapter_no: number }[];
    }>();
    expect(afterBody.stale_chapters.map((r) => r.number)).toEqual([1]);
    expect(afterBody.stale_versions[0]?.id).toBe(seeded.acceptedVersionId);
  });

  // ---- promises ------------------------------------------------------------------------------------

  it('lists promises and validates the status filter', async () => {
    const res = await get(`/v1/projects/${seeded.projectId}/canon/promises?limit=100`);
    expect(res.statusCode, res.body).toBe(200);
    expect(Array.isArray(res.json<{ items: unknown[] }>().items)).toBe(true);

    const bad = await get(`/v1/projects/${seeded.projectId}/canon/promises?status=whenever`);
    expect(bad.statusCode, bad.body).toBe(422);
  });

  // ---- costs and budgets ---------------------------------------------------------------------------

  it('groups costs by role, model and chapter without leaking prompt or output text', async () => {
    for (const groupBy of ['role', 'model', 'chapter'] as const) {
      const res = await get(`/v1/projects/${seeded.projectId}/costs?group_by=${groupBy}`);
      expect(res.statusCode, `${groupBy}: ${res.body}`).toBe(200);
      const body = res.json<{
        group_by: string;
        total_cost_cents: number;
        items: { group_key: string | null; calls: number; cost_cents: number }[];
      }>();
      expect(body.group_by).toBe(groupBy);
      expect(typeof body.total_cost_cents).toBe('number');
      // The fixture replays real recorded calls, so there is something to group.
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((r) => typeof r.calls === 'number')).toBe(true);
    }

    // The audit stores hashes and sizes, never bodies — so no accepted prose can appear in a cost report.
    const accepted = await pool.query<{ text: string }>(
      'SELECT text FROM manuscript_versions WHERE id = $1',
      [seeded.acceptedVersionId],
    );
    const firstSentence = (accepted.rows[0]?.text ?? '').slice(0, 40);
    const res = await get(`/v1/projects/${seeded.projectId}/costs?group_by=role`);
    expect(firstSentence.length).toBeGreaterThan(10);
    expect(res.body).not.toContain(firstSentence);
  });

  it('rejects an unknown cost grouping', async () => {
    const res = await get(`/v1/projects/${seeded.projectId}/costs?group_by=phase_of_moon`);
    expect(res.statusCode, res.body).toBe(422);
  });

  it('reports spend against the PINNED production policy rather than a copied limit', async () => {
    const res = await get(`/v1/projects/${seeded.projectId}/budgets`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      project_id: string;
      quality_tier: string;
      spend_cents: number;
      production_policy_version: string;
    }>();
    expect(body.project_id).toBe(seeded.projectId);
    expect(typeof body.spend_cents).toBe('number');
    // ADR-0041: thresholds live in the pinned policy. The API reports WHICH policy applies rather than
    // restating its numbers, so the API can never become a second, drifting source for them.
    expect(body.production_policy_version).toBeTruthy();
  });
});
