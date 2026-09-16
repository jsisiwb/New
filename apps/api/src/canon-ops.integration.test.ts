/**
 * The canon operator HTTP surface: correction, retcon, regeneration preview and rollback (Checkpoint 7).
 *
 * These tests exercise the ROUTES, against a project whose canon was produced by the real Checkpoint 5
 * acceptance path over the frozen chapter-1 replay fixture. The services underneath already have their own
 * suite (`packages/canon/src/correction.integration.test.ts`); what is proved here is everything the HTTP
 * layer is responsible for and could plausibly get wrong:
 *
 *  * authentication and role policy per verb — a dry run is a read, a correction is an edit, and a retcon
 *    or rollback is owner-only because it rewrites or retracts established history;
 *  * cross-workspace non-disclosure — another tenant's project id must 404, not 403, because 403 confirms
 *    the resource exists;
 *  * that a DRY RUN WRITES NOTHING: no canon commit, no idempotency record, and no audit row claiming a
 *    change occurred (`planned ≠ happened`);
 *  * that the optimistic `expected_canon_version` is REQUIRED when committing, so a stale operator report
 *    cannot be applied silently;
 *  * that policy refusals (missing justification, unconfirmed retcon, non-latest rollback) are distinct,
 *    actionable problem documents rather than generic failures;
 *  * that `Idempotency-Key` makes a retried commit produce one canon commit, and that the same key with a
 *    changed payload is refused;
 *  * that no SQL, stack trace, path or manuscript prose leaks into any error or response.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createUser,
  createWorkspace,
  getManuscriptVersion,
  migrate,
  resetDatabase,
  type Pool,
} from '@yeonjae/db';
import { codePointLength } from '@yeonjae/prose';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import type { FastifyInstance } from 'fastify';
import { buildApi } from './server.js';
import { CSRF_HEADER, WORKSPACE_HEADER } from './auth.js';
import { seedAcceptedChapterOne, type SeededProject } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

interface Actor {
  readonly cookie: string;
  readonly csrf: string;
  readonly userId: string;
}

run('API: canon operator surface — correction, retcon, preview, rollback (Checkpoint 7)', () => {
  let pool: Pool;
  let app: FastifyInstance;
  let seeded: SeededProject;
  let owner: Actor;
  let editor: Actor;
  let viewer: Actor;
  /** A project in a DIFFERENT workspace, for the non-disclosure tests. */
  let otherWorkspaceId: string;
  let otherProjectId: string;
  let factId: string;
  let entityId: string;
  let factAttribute: string;
  /** An evidence span over the accepted manuscript, addressed in Unicode code points (ADR-0030). */
  let evidenceSpan: Record<string, unknown>;
  let canonVersion: number;

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

  function authed(actor: Actor, workspaceId?: string): Record<string, string> {
    return {
      cookie: actor.cookie,
      [WORKSPACE_HEADER]: workspaceId ?? seeded.workspaceId,
      [CSRF_HEADER]: actor.csrf,
    };
  }

  /**
   * The corrected payload: a legal `supersede` value for the fixture fact.
   *
   * The attribute is kept IDENTICAL to the fact being superseded. Superseding is "the same claim, corrected
   * value" — changing the attribute too would be a different fact entirely, which the change-class rules
   * refuse. The validity fields are flat (`valid_from`/`valid_to`) because that is the fact payload's shape.
   */
  function correctedValue(): Record<string, unknown> {
    return {
      entity_id: entityId,
      attribute: factAttribute,
      value: 'CORRECTED',
      value_text: 'the corrected reading',
      valid_from: { chapter_no: 1, ordinal: 2, precision: 'exact' },
      valid_to: null,
    };
  }

  async function currentCanonVersion(): Promise<number> {
    const r = await pool.query<{ v: number }>(
      'SELECT canon_version AS v FROM projects WHERE id = $1',
      [seeded.projectId],
    );
    return r.rows[0]?.v ?? -1;
  }

  async function commitCount(): Promise<number> {
    const r = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM canon_commits WHERE project_id = $1',
      [seeded.projectId],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  async function auditCount(action: string): Promise<number> {
    const r = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM audit_log WHERE action = $1',
      [action],
    );
    return Number(r.rows[0]?.n ?? '0');
  }

  beforeAll(async () => {
    pool = await freshDatabase();
    app = buildApi({ pool, secureCookies: false });
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
    canonVersion = await currentCanonVersion();
    expect(canonVersion).toBeGreaterThan(0);

    // A fact the fixture's acceptance actually committed, plus its entity, so corrections operate on real
    // canon rather than a hand-planted row.
    const facts = await pool.query<{ id: string; entity_id: string; attribute: string }>(
      `SELECT id, entity_id, attribute FROM facts
        WHERE project_id = $1 AND retracted_at_version IS NULL ORDER BY id LIMIT 1`,
      [seeded.projectId],
    );
    factId = facts.rows[0]?.id ?? '';
    entityId = facts.rows[0]?.entity_id ?? '';
    factAttribute = facts.rows[0]?.attribute ?? '';
    expect(factId).not.toBe('');

    // A REAL evidence span, quoted verbatim out of the accepted manuscript and measured in code points.
    // Corrections to a fact require evidence (the change-class rules and the migration-0001 trigger both
    // insist), so a committing test must supply one that actually resolves — hand-written offsets would be
    // rejected by the trigger, which is the behaviour the dry-run/refusal tests rely on.
    const accepted = await getManuscriptVersion(pool, seeded.acceptedVersionId);
    const text = accepted?.text ?? '';
    expect(text.length).toBeGreaterThan(200);
    // A verbatim slice, NOT a re-joined word list: the evidence trigger compares the quote against the
    // exact NFC substring at those offsets, so any whitespace normalization would make it unresolvable.
    const at = text.indexOf(' ') + 1;
    const quote = text.slice(at, at + 40);
    expect(quote.length).toBe(40);
    const start = codePointLength(text.slice(0, at));
    evidenceSpan = {
      manuscript_version_id: seeded.acceptedVersionId,
      chapter_no: 1,
      paragraph_id: 'p1',
      quote,
      start,
      end: start + codePointLength(quote),
    };

    const ownerUser = await createUser(pool, {
      email: 'owner@example.com',
      displayName: 'Owner',
      password: 'owner-password-1',
    });
    const editorUser = await createUser(pool, {
      email: 'editor@example.com',
      displayName: 'Editor',
      password: 'editor-password-1',
    });
    const viewerUser = await createUser(pool, {
      email: 'viewer@example.com',
      displayName: 'Viewer',
      password: 'viewer-password-1',
    });
    await addMember(pool, { workspaceId: seeded.workspaceId, userId: ownerUser.id, role: 'owner' });
    await addMember(pool, {
      workspaceId: seeded.workspaceId,
      userId: editorUser.id,
      role: 'editor',
    });
    await addMember(pool, {
      workspaceId: seeded.workspaceId,
      userId: viewerUser.id,
      role: 'viewer',
    });
    owner = await login('owner@example.com', 'owner-password-1');
    editor = await login('editor@example.com', 'editor-password-1');
    viewer = await login('viewer@example.com', 'viewer-password-1');

    // A separate workspace nobody above belongs to.
    otherWorkspaceId = await createWorkspace(pool, 'Other Tenant');
    const otherProject = await pool.query<{ id: string }>(
      `INSERT INTO projects (workspace_id, title) VALUES ($1, 'Other Tenant Project') RETURNING id`,
      [otherWorkspaceId],
    );
    otherProjectId = otherProject.rows[0]?.id ?? '';
  }, 300_000);

  // ---- authentication and authorization -----------------------------------------------------------

  it('refuses every canon operator route without authentication', async () => {
    const calls = [
      { method: 'POST' as const, url: `/v1/projects/${seeded.projectId}/canon:correct` },
      { method: 'POST' as const, url: `/v1/projects/${seeded.projectId}/canon:retcon` },
      { method: 'POST' as const, url: `/v1/projects/${seeded.projectId}/canon:rollback` },
      {
        method: 'GET' as const,
        url: `/v1/projects/${seeded.projectId}/chapters/1/regeneration-preview`,
      },
    ];
    for (const call of calls) {
      const res = await app.inject({ ...call, payload: {} });
      expect(res.statusCode, `${call.url}: ${res.body}`).toBe(401);
      expect(res.json<{ code: string }>().code).toBe('UNAUTHENTICATED');
    }
  });

  it('lets a viewer dry-run but never commit', async () => {
    const dry = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(viewer),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'viewer inspects the consequences',
        dry_run: true,
      },
    });
    expect(dry.statusCode, dry.body).toBe(200);
    expect(dry.json<{ committed: boolean }>().committed).toBe(false);

    const commit = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(viewer),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'viewer tries to commit',
        expected_canon_version: canonVersion,
      },
    });
    expect(commit.statusCode, commit.body).toBe(403);
    expect(commit.json<{ code: string }>().code).toBe('FORBIDDEN');
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('requires owner for a retcon commit and for a rollback, editor is not enough', async () => {
    const retcon = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:retcon`,
      headers: authed(editor),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'editor attempts a retcon',
        expected_canon_version: canonVersion,
        confirmed: true,
      },
    });
    expect(retcon.statusCode, retcon.body).toBe(403);

    const rollback = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:rollback`,
      headers: authed(editor),
      payload: { expected_canon_version: canonVersion },
    });
    expect(rollback.statusCode, rollback.body).toBe(403);
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('hides another workspace’s project behind the same 404 as a nonexistent one', async () => {
    // The owner is authenticated and sends their OWN workspace header, but names a foreign project.
    const foreign = await app.inject({
      method: 'POST',
      url: `/v1/projects/${otherProjectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'cross-workspace attempt',
        dry_run: true,
      },
    });
    const absent = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.mainTimelineId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'nonexistent project',
        dry_run: true,
      },
    });
    // Identical status AND identical code: a distinguishable response would confirm the tenant exists.
    expect(foreign.statusCode).toBe(404);
    expect(absent.statusCode).toBe(404);
    expect(foreign.json<{ code: string }>().code).toBe(absent.json<{ code: string }>().code);
    // No part of the other tenant's identity is echoed back.
    expect(foreign.body).not.toContain(otherWorkspaceId);
  });

  it('refuses a member of another workspace who presents that workspace’s header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${otherProjectId}/canon:correct`,
      headers: authed(owner, otherWorkspaceId),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'not a member there',
        dry_run: true,
      },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json<{ code: string }>().code).toBe('NOT_A_MEMBER');
  });

  // ---- dry runs write nothing ----------------------------------------------------------------------

  it('dry-runs a correction with no canon change, no commit and no audited change', async () => {
    const beforeVersion = await currentCanonVersion();
    const beforeCommits = await commitCount();
    const beforeAudit = await auditCount('canon.correct');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'what would this affect?',
        dry_run: true,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      committed: boolean;
      commit_id: string | null;
      stale_marked: string[];
      review_suggested: string[];
      impact: { canon_version: number; material_count: number; contextual_count: number };
    }>();
    expect(body.committed).toBe(false);
    expect(body.commit_id).toBeNull();
    expect(body.stale_marked).toEqual([]);
    expect(body.review_suggested).toEqual([]);
    // The report names the version it was computed at — the value the client must echo back to commit.
    expect(body.impact.canon_version).toBe(beforeVersion);

    expect(await currentCanonVersion()).toBe(beforeVersion);
    expect(await commitCount()).toBe(beforeCommits);
    // A dry run is not a change, so nothing claims one happened.
    expect(await auditCount('canon.correct')).toBe(beforeAudit);
  });

  it('dry-runs a rollback and reports whether the latest commit is rollbackable', async () => {
    const before = await currentCanonVersion();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:rollback`,
      headers: authed(owner),
      payload: { dry_run: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ committed: boolean; rollbackable: boolean; reason: string | null }>();
    expect(body.committed).toBe(false);
    expect(typeof body.rollbackable).toBe('boolean');
    expect(await currentCanonVersion()).toBe(before);
    expect(await auditCount('canon.rollback')).toBe(0);
  });

  it('previews regeneration as a pure read that marks nothing stale', async () => {
    const staleBefore = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chapters WHERE project_id = $1 AND status = 'stale'`,
      [seeded.projectId],
    );
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${seeded.projectId}/chapters/1/regeneration-preview`,
      headers: authed(viewer),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ chapter_no: number; impact: { canon_version: number } }>();
    expect(body.chapter_no).toBe(1);
    expect(body.impact.canon_version).toBe(await currentCanonVersion());
    const staleAfter = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM chapters WHERE project_id = $1 AND status = 'stale'`,
      [seeded.projectId],
    );
    expect(staleAfter.rows[0]?.n).toBe(staleBefore.rows[0]?.n);
  });

  // ---- policy refusals are distinct and actionable -------------------------------------------------

  it('requires expected_canon_version when committing, rather than defaulting to current', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'no expected version supplied',
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json<{ code: string; errors?: { path: string }[] }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors?.some((e) => e.path === 'body.expected_canon_version')).toBe(true);
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('refuses a stale expected_canon_version with CANON_STALE and changes nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'operator acted on an old report',
        // Deliberately behind the truth: the report this consent refers to is out of date.
        expected_canon_version: canonVersion - 1,
      },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('CANON_STALE');
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('refuses a correction with a blank justification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: '   ',
        expected_canon_version: canonVersion,
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('refuses an unconfirmed retcon with a reason naming the confirmation requirement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:retcon`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'rewriting established history',
        expected_canon_version: canonVersion,
        // `confirmed` deliberately omitted.
      },
    });
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json<{ code: string; data?: { reason?: string } }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    // Distinguishable from an ordinary schema failure: the operator must act, not fix a field.
    expect(body.data?.reason).toBe('CONFIRMATION_REQUIRED');
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('rejects malformed bodies without reaching the service', async () => {
    const cases: readonly Record<string, unknown>[] = [
      { item_kind: 'not_a_kind', item_id: factId, new_value: {}, justification: 'x' },
      { item_kind: 'fact', item_id: 'not-a-uuid', new_value: {}, justification: 'x' },
      { item_kind: 'fact', item_id: factId, new_value: 'a string', justification: 'x' },
      { item_kind: 'fact', item_id: factId, new_value: {}, justification: 'x', evidence: 'nope' },
      {
        item_kind: 'fact',
        item_id: factId,
        new_value: {},
        justification: 'x',
        expected_canon_version: {},
      },
    ];
    for (const payload of cases) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${seeded.projectId}/canon:correct`,
        headers: authed(owner),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(res.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    }
    expect(await currentCanonVersion()).toBe(canonVersion);
  });

  it('never leaks SQL, stack traces, paths or manuscript prose in an error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        // A syntactically valid UUID that names no canon item: the failure comes from the service.
        item_id: '00000000-0000-7000-8000-00000000dead',
        new_value: correctedValue(),
        justification: 'nonexistent item',
        expected_canon_version: canonVersion,
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const raw = res.body;
    for (const forbidden of [
      'SELECT',
      'INSERT',
      'pg_',
      'at Object.',
      '/tmp/',
      'node_modules',
      'canon.commit_delta',
    ]) {
      expect(raw, `leaked ${forbidden}`).not.toContain(forbidden);
    }
  });

  // ---- idempotency and concurrency ----------------------------------------------------------------

  it('applies Idempotency-Key so a retried correction commits canon exactly once', async () => {
    const payload = {
      item_kind: 'fact',
      item_id: factId,
      new_value: correctedValue(),
      justification: 'retried by an impatient client',
      evidence: [evidenceSpan],
      expected_canon_version: canonVersion,
    };
    const headers = { ...authed(owner), 'idempotency-key': 'canon-correct-key-1' };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers,
      payload,
    });
    expect(first.statusCode, first.body).toBe(200);
    const afterFirst = await currentCanonVersion();
    expect(afterFirst).toBe(canonVersion + 1);

    // The retry replays the stored result. Critically it does NOT re-commit — and it must not fail the
    // optimistic check either, which a naive re-execution would now do since canon has moved.
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers,
      payload,
    });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json<{ commit_id: string }>().commit_id).toBe(
      first.json<{ commit_id: string }>().commit_id,
    );
    expect(await currentCanonVersion()).toBe(afterFirst);
    expect(await auditCount('canon.correct')).toBe(1);
  });

  it('refuses the same idempotency key with a different payload', async () => {
    const headers = { ...authed(owner), 'idempotency-key': 'canon-correct-key-2' };
    const first = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers,
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'first payload',
        evidence: [evidenceSpan],
        expected_canon_version: canonVersion,
      },
    });
    expect(first.statusCode, first.body).toBe(200);

    const changed = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers,
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'DIFFERENT payload under the same key',
        evidence: [evidenceSpan],
        expected_canon_version: canonVersion,
      },
    });
    // 409, not 422: the body is well-formed, and the conflict is with a prior request under the same key.
    expect(changed.statusCode, changed.body).toBe(409);
    expect(changed.json<{ code: string }>().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('commits at most one canon version when two identical corrections race', async () => {
    const payload = {
      item_kind: 'fact',
      item_id: factId,
      new_value: correctedValue(),
      justification: 'concurrent operators',
      evidence: [evidenceSpan],
      expected_canon_version: canonVersion,
    };
    const send = () =>
      app.inject({
        method: 'POST',
        url: `/v1/projects/${seeded.projectId}/canon:correct`,
        headers: authed(owner),
        payload,
      });

    const [a, b] = await Promise.all([send(), send()]);
    const codes = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    // One succeeds; the other must be refused rather than double-committing. The optimistic version check
    // is what decides, so the loser is a conflict — never a second commit.
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBeGreaterThanOrEqual(400);
    expect(await currentCanonVersion()).toBe(canonVersion + 1);
  });

  // ---- the committing paths, end to end -----------------------------------------------------------

  it('commits a correction, records an audit row and reports material vs contextual consequences', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:correct`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'the measurement was misread',
        evidence: [evidenceSpan],
        expected_canon_version: canonVersion,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      committed: boolean;
      canon_version: number;
      commit_id: string;
      stale_marked: string[];
      review_suggested: string[];
    }>();
    expect(body.committed).toBe(true);
    expect(body.canon_version).toBe(canonVersion + 1);
    expect(body.commit_id).toBeTruthy();
    // The two consequence classes stay separate in the response, so a UI cannot present a contextual
    // review suggestion as an invalidation.
    expect(Array.isArray(body.stale_marked)).toBe(true);
    expect(Array.isArray(body.review_suggested)).toBe(true);

    // The audit row attributes the change to the authenticated user, with safe metadata only.
    const audit = await pool.query<{
      actor_user_id: string;
      target_id: string;
      detail: Record<string, unknown>;
    }>(`SELECT actor_user_id, target_id, detail FROM audit_log WHERE action = 'canon.correct'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_user_id).toBe(owner.userId);
    expect(audit.rows[0]?.target_id).toBe(factId);
    // No corrected value, no prose: the log records that a change happened and how far it reached.
    expect(JSON.stringify(audit.rows[0]?.detail)).not.toContain('the corrected reading');
  });

  it('commits a confirmed retcon and preserves history rather than deleting it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:retcon`,
      headers: authed(owner),
      payload: {
        item_kind: 'fact',
        item_id: factId,
        new_value: correctedValue(),
        justification: 'the earlier chapter established this wrongly',
        evidence: [evidenceSpan],
        expected_canon_version: canonVersion,
        confirmed: true,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ committed: boolean }>().committed).toBe(true);

    // The retcon is recorded with its own source, so history shows WHAT KIND of change this was.
    const commit = await pool.query<{ source: string }>(
      'SELECT source FROM canon_commits WHERE project_id = $1 ORDER BY version DESC LIMIT 1',
      [seeded.projectId],
    );
    expect(commit.rows[0]?.source).toBe('retcon');
    // The superseded row still exists: superseding closes validity, it does not delete.
    const originalStillReadable = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM facts WHERE id = $1',
      [factId],
    );
    expect(Number(originalStillReadable.rows[0]?.n)).toBe(1);
    expect(await auditCount('canon.retcon')).toBe(1);
  });

  it('rolls back the latest commit only, and refuses to roll back a rollback', async () => {
    const before = await currentCanonVersion();
    const first = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:rollback`,
      headers: authed(owner),
      payload: { expected_canon_version: before },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ committed: boolean }>().committed).toBe(true);
    const afterFirst = await currentCanonVersion();
    expect(afterFirst).toBe(before + 1);

    // MVP policy is latest-only, and a rollback of a rollback is refused in SQL.
    const second = await app.inject({
      method: 'POST',
      url: `/v1/projects/${seeded.projectId}/canon:rollback`,
      headers: authed(owner),
      payload: { expected_canon_version: afterFirst },
    });
    expect(second.statusCode, second.body).toBe(409);
    expect(second.json<{ code: string }>().code).toBe('CONFLICT');
    expect(await currentCanonVersion()).toBe(afterFirst);
  });
});
