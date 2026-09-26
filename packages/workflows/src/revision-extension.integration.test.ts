/**
 * ADR-0098: an operator may grant the chapter a needs_attention run stopped on more revision rounds, up to the pinned
 * policy's own round budget in all; the grant is kept in the project's settings and the run's event log. The revision
 * functions take the chapter's round limit, and the polish round may follow the last budgeted round.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requirePolicy } from '@yeonjae/domain';
import {
  createProject,
  createWorkspace,
  ensureNovelRun,
  getProject,
  listNovelRunEvents,
  putArtifact,
  transitionNovelRun,
  type ManuscriptVersionRow,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { WorkflowError } from './errors.js';
import { extendChapterRevision, grantedRounds } from './novel.js';
import { reviseVersion } from './revision.js';
import { type WorkflowContext } from './runtime.js';

const run = databaseUrl() ? describe : describe.skip;

describe('the revision round limit (ADR-0098)', () => {
  const ctx = {
    policy: requirePolicy('policy/standard@24'),
    pins: { productionPolicyVersion: 'policy/standard@24' },
  } as unknown as WorkflowContext;
  const input = (round: number, roundLimit?: number) => ({
    version: { id: 'v', text: '' } as ManuscriptVersionRow,
    chapterId: 'c',
    chapterNo: 1,
    issues: [],
    dimension: 'prose' as const,
    round,
    registerDigests: '',
    ...(roundLimit !== undefined ? { roundLimit } : {}),
  });
  const code = (p: Promise<unknown>) =>
    p.then(
      () => 'resolved',
      (e: unknown) => (e instanceof WorkflowError ? e.code : 'other'),
    );

  it('stops a round past the pinned budget, and past a granted limit', async () => {
    expect(await code(reviseVersion(ctx, input(6)))).toBe('REVISION_LIMIT');
    expect(await code(reviseVersion(ctx, input(8, 7)))).toBe('REVISION_LIMIT');
  });

  it('lets a round up to the chapter’s limit through the guard (the step itself needs a database)', async () => {
    // The polish round after a chapter first approvable in round 5: round 6 under the limit 5 + 1.
    expect(await code(reviseVersion(ctx, input(6, 6)))).not.toBe('REVISION_LIMIT');
  });
});

run('operator-granted revision rounds (ADR-0098)', () => {
  let pool: Pool;
  let projectId: string;
  let runId: string;

  beforeAll(async () => {
    pool = await freshDatabase();
    const workspaceId = await createWorkspace(pool, 'extend');
    ({ projectId } = await createProject(pool, {
      workspaceId,
      title: '연장',
      policyVersion: 'policy/standard@24',
    }));
    const { artifact } = await putArtifact(pool, {
      workspaceId,
      projectId,
      step: 'intake',
      kind: 'story_intake',
      key: 'intake',
      payload: { title_working: '연장' },
    });
    const { run: created } = await ensureNovelRun(pool, {
      workspaceId,
      projectId,
      intakeArtifactId: artifact.id,
      targetChapters: 3,
    });
    runId = created.id;
    await transitionNovelRun(pool, { runId, to: 'producing' });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('refuses a run that is not waiting for attention', async () => {
    await expect(extendChapterRevision(pool, { projectId, rounds: 1 })).rejects.toMatchObject({
      code: 'SELECTION_REQUEST_CHANGED',
    });
  });

  it('records grants up to the pinned policy’s round budget and no further', async () => {
    await transitionNovelRun(pool, {
      runId,
      to: 'needs_attention',
      patch: { lastError: { code: 'APPROVAL_BLOCKED', message: '1 blocking and 1 major' } },
    });
    expect(await extendChapterRevision(pool, { projectId, rounds: 2, reason: 'G14a' })).toEqual({
      chapter_no: 1,
      granted: 2,
      total: 2,
      budget: 5,
    });
    // Without --rounds the rest of the budget is granted.
    expect(await extendChapterRevision(pool, { projectId })).toMatchObject({
      granted: 3,
      total: 5,
    });
    await expect(extendChapterRevision(pool, { projectId, rounds: 1 })).rejects.toMatchObject({
      code: 'REVISION_LIMIT',
    });
    const settings = (await getProject(pool, projectId)).settings;
    expect(grantedRounds(settings, 1)).toBe(5);
    expect(grantedRounds(settings, 2)).toBe(0);
    const grants = (settings.revision_extensions as Record<string, { grants: unknown[] }>)['1'];
    expect(grants?.grants).toHaveLength(2);
    const events = (await listNovelRunEvents(pool, runId)).filter(
      (e) => e.kind === 'chapter.revision_extended',
    );
    expect(events.map((e) => e.payload)).toEqual([
      expect.objectContaining({ chapter_no: 1, rounds: 2, total: 2, budget: 5, reason: 'G14a' }),
      expect.objectContaining({ chapter_no: 1, rounds: 3, total: 5, budget: 5 }),
    ]);
  });
});
