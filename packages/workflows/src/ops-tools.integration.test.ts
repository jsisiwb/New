/**
 * Operator tools against a real (simulated-model) run: the pack inspector rebuilds packs from stored
 * contracts without creating jobs or calling a model, the story state and the cost projection read the run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, createWorkspace, getNovelRun, PgAuditStore, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { Gateway, MemoryBudget, MockProvider } from '@yeonjae/gateway';
import { simulatedModelScript as script } from './simulated-model.js';
import { approveConcept, resumeNovelRun, startNovel } from './novel.js';
import { NovelRunner } from './novel-runner.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { REPLAY_ROUTING } from './testkit.js';
import { callRows, inspectPack, projectCost, storyState } from './ops-tools.js';

const run = databaseUrl() ? describe : describe.skip;

// Intake configuration only (genre, premise, constraints); no manuscript prose.
const INTAKE = {
  title_working: 'Ash Ledger',
  premise:
    'A disgraced guild accountant proves the gate-defence ledgers are forged by climbing the ranks.',
  premise_language: 'en',
  genre: { primary: 'hunter-gate', secondary: ['academy'] },
  main_character: { name: 'Seo Ji-an', role: 'protagonist', description: '29. Former accountant.' },
  supporting_characters: [
    { name: 'Moon Hae-rin', role: 'antagonist', description: '35, treasurer.' },
  ],
  forbidden_developments: [],
  tone: { pace: 'fast' },
  ending_preference: 'bittersweet',
  target_chapters: 2,
  target_words_per_chapter: 600,
  spelling_locale: 'en-US',
  content_restrictions: [],
  operating_mode: 'autopilot',
};

const routing = {
  ...REPLAY_ROUTING,
  R: REPLAY_ROUTING.R.map((r) => ({ ...r, provider: 'mock' })),
  P: REPLAY_ROUTING.P.map((r) => ({ ...r, provider: 'mock' })),
  M: REPLAY_ROUTING.M.map((r) => ({ ...r, provider: 'mock' })),
  C: REPLAY_ROUTING.C.map((r) => ({ ...r, provider: 'mock' })),
};

run('operator tools on a simulated run (ADR-0079)', () => {
  let pool: Pool;
  let projectId: string;

  beforeAll(async () => {
    pool = await freshDatabase();
    const workspaceId = await createWorkspace(pool, 'ops-tools');
    ({ projectId } = await createProject(pool, {
      workspaceId,
      title: 'Ash Ledger',
      operatingMode: 'autopilot',
    }));
    const provider = new MockProvider(script);
    const makeDeps = () => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
        ),
      }),
    });
    const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
    await approveConcept(pool, {
      projectId,
      conceptId: started.concepts[0]?.id ?? '',
      autoContinue: true,
    });
    const runner = new NovelRunner({ pool, makeDeps, runnerId: 'ops-runner', leaseSeconds: 30 });
    while (await runner.tick()) {
      const r = await getNovelRun(pool, projectId);
      if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
    }
  }, 300_000);

  afterAll(async () => {
    await pool.end();
  });

  it('inspects the writer and checker packs of chapter 2 against the pinned budget', async () => {
    const count = async (table: 'jobs' | 'llm_calls') =>
      Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n);
    const jobs = () => count('jobs');
    const calls = () => count('llm_calls');
    const before = [await jobs(), await calls()];
    const writer = await inspectPack(pool, { projectId, chapterNo: 2, role: 'scene_writer' });
    expect(writer.template).toBe('pack.scene_writer');
    expect(writer.sections.map((s) => s.name)).toContain('previous_chapter');
    expect(writer.overflow).toBeUndefined();
    expect(writer.assembled?.total).toBeLessThanOrEqual(writer.budget ?? 0);
    const checker = await inspectPack(pool, {
      projectId,
      chapterNo: 2,
      role: 'continuity_checker',
    });
    expect(checker.sections.map((s) => s.name)).toEqual(
      expect.arrayContaining(['chapter_text', 'contract']),
    );
    // A budget below the critical sections reports the overflow instead of throwing.
    const tight = await inspectPack(pool, {
      projectId,
      chapterNo: 2,
      role: 'continuity_checker',
      budget: 500,
    });
    expect(tight.overflow).toMatch(/OVERFLOW/);
    // Read-only: no job row, no model call.
    expect([await jobs(), await calls()]).toEqual(before);
    await expect(
      inspectPack(pool, { projectId, chapterNo: 9, role: 'scene_writer' }),
    ).rejects.toThrow(/no chapter job/);
  });

  it('reports the story state and projects the cost from the audit', async () => {
    const state = await storyState(pool, projectId);
    expect(state).toMatchObject({ run_status: 'completed', accepted_chapters: 2 });
    expect(state.last_accepted?.chapter_no).toBe(2);
    const rows = await callRows(pool, projectId);
    expect(rows.map((r) => r.chapter_no)).toEqual([null, 1, 2]);
    const p = projectCost(rows, 200);
    expect(p.chapters_observed).toBe(2);
    expect(p.projected.calls).toBe(Math.round((rows[0]?.calls ?? 0) + p.per_chapter.calls * 200));
  });
});
