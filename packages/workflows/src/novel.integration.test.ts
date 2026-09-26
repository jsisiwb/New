/**
 * End-to-end proof of the product loop with a SIMULATED live model: intake → spec + concept suggestions
 * → approval → full bible + blueprint → chapters produced back to back by the queue runner.
 *
 * The provider is a `MockProvider` script that answers BY ROLE, reading the registry ids it is given from
 * the prompt exactly as a real model would (copying entity ids from the canon state, quoting the chapter
 * text for evidence). It exercises the assembly, anchoring and normalization code paths a live provider
 * needs and the fixtures never touch — with no credentials and no spend.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimNovelRun,
  createProject,
  createWorkspace,
  getNovelRun,
  getProject,
  listNovelRunEvents,
  PgAuditStore,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { Gateway, MemoryBudget, MockProvider } from '@yeonjae/gateway';
import { segmentParagraphs, sliceCodePoints, toNfcText } from '@yeonjae/prose';
import { simulatedModelScript as script } from './simulated-model.js';
import { advanceNovelRun, approveConcept, resumeNovelRun, startNovel } from './novel.js';
import { NovelRunner } from './novel-runner.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { REPLAY_ROUTING } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const INTAKE = {
  title_working: 'Ash Ledger',
  premise:
    'A disgraced guild accountant discovers the ledgers that fund the city’s gate defence are forged, and the only way to prove it is to climb the ranks herself.',
  premise_language: 'en',
  genre: { primary: 'hunter-gate', secondary: ['academy'] },
  main_character: {
    name: 'Seo Ji-an',
    role: 'protagonist',
    description: '29. Former guild accountant, meticulous, dry humour.',
  },
  supporting_characters: [
    { name: 'Baek Tae-ho', role: 'mentor', description: '48, retired B-rank scout.' },
    { name: 'Moon Hae-rin', role: 'antagonist', description: '35, guild treasurer.' },
  ],
  forbidden_developments: ['Ji-an revealing the forged ledgers before ch.3'],
  tone: { pace: 'fast' },
  ending_preference: 'bittersweet',
  target_chapters: 2,
  target_words_per_chapter: 600,
  spelling_locale: 'en-US',
  content_restrictions: ['No sexual content'],
  operating_mode: 'autopilot',
};

const routing = {
  ...REPLAY_ROUTING,
  R: REPLAY_ROUTING.R.map((r) => ({ ...r, provider: 'mock' })),
  P: REPLAY_ROUTING.P.map((r) => ({ ...r, provider: 'mock' })),
  M: REPLAY_ROUTING.M.map((r) => ({ ...r, provider: 'mock' })),
  C: REPLAY_ROUTING.C.map((r) => ({ ...r, provider: 'mock' })),
};

run('novel run: intake → suggestions → approval → bible → chapters (simulated live model)', () => {
  let pool: Pool;
  let workspaceId: string;
  let projectId: string;
  let provider: MockProvider;

  beforeAll(async () => {
    pool = await freshDatabase();
    workspaceId = await createWorkspace(pool, 'novel-e2e');
    // Deliberately NO pinned identity: the run must compose one from the intake (ADR-0051 §identity).
    ({ projectId } = await createProject(pool, {
      workspaceId,
      title: 'Ash Ledger',
      operatingMode: 'autopilot',
    }));
    provider = new MockProvider(script);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

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
      minEnglishConfidence: 0.99,
    }),
  });

  it('suggests concepts from the intake and waits for approval', async () => {
    const result = await startNovel(makeDeps(), { projectId, intake: INTAKE });
    // The project now pins an intake-derived composed identity with the hunter-gate + academy overlays.
    const project = await getProject(pool, projectId);
    expect(project.settings.narrative_identity_ref).toBe(`project/${projectId}@1`);
    const doc = await pool.query<{
      payload: { lineage: { genres: string[] }; naming: { style: string } };
      pinned: boolean;
    }>(
      `SELECT payload, pinned FROM identity_documents WHERE project_id = $1 AND kind = 'narrative_identity'`,
      [projectId],
    );
    expect(doc.rows[0]?.pinned).toBe(true);
    expect(doc.rows[0]?.payload.lineage.genres).toEqual(['genre/hunter-gate@1', 'genre/academy@1']);
    expect(doc.rows[0]?.payload.naming.style).toBe('korean_romanized');
    expect(result.run.status).toBe('awaiting_approval');
    expect(result.concepts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.concepts.map((c) => c.id)).size).toBe(result.concepts.length);
    for (const c of result.concepts) expect(c.project_id).toBe(projectId);
    // Idempotent: calling again replays every model call and changes nothing.
    const callsBefore = provider.callCount;
    const again = await startNovel(makeDeps(), { projectId, intake: INTAKE });
    expect(again.concepts.map((c) => c.id)).toEqual(result.concepts.map((c) => c.id));
    expect(provider.callCount).toBe(callsBefore);
  }, 120_000);

  it('does not resume a failed suggestion run into planning without approval', async () => {
    const other = await createProject(pool, {
      workspaceId,
      title: 'Unapproved recovery',
      operatingMode: 'autopilot',
    });
    await pool.query(
      `INSERT INTO novel_runs (workspace_id, project_id, status, target_chapters)
       VALUES ($1, $2, 'failed', 2)`,
      [workspaceId, other.projectId],
    );
    await expect(resumeNovelRun(pool, { projectId: other.projectId })).rejects.toMatchObject({
      code: 'SELECTION_REQUEST_CHANGED',
    });
    const run = await getNovelRun(pool, other.projectId);
    expect(run?.status).toBe('failed');
  });

  it('fails the run instead of leaving it suggesting when the plan context cannot be built', async () => {
    // Phase A (12-live-run-ws1-7.md §3.3): a restart that crashed loading its pinned policy left the run
    // `suggesting` with nothing running. An unknown pinned policy reproduces the same crash point.
    const { projectId: broken } = await createProject(pool, {
      workspaceId,
      title: 'Broken pin',
      operatingMode: 'autopilot',
      policyVersion: 'policy/standard@99',
    });
    const deps = {
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId: broken },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId: broken }),
        ),
      }),
    };
    await expect(startNovel(deps, { projectId: broken, intake: INTAKE })).rejects.toThrow(
      /policy\/standard@99/,
    );
    const run = await getNovelRun(pool, broken);
    expect(run?.status).toBe('failed');
    expect(run?.last_error).not.toBeNull();
  });

  it('approval queues planning; the runner builds the full bible, then writes every chapter', async () => {
    const before = await getNovelRun(pool, projectId);
    const concept = (await startNovel(makeDeps(), { projectId, intake: INTAKE })).concepts[1];
    expect(concept).toBeDefined();
    const approved = await approveConcept(pool, {
      projectId,
      conceptId: concept?.id ?? '',
      autoContinue: false,
    });
    expect(approved.status).toBe('planning');
    expect(approved.approved_concept_id).toBe(concept?.id);
    expect(before?.status).toBe('awaiting_approval');

    const runner = new NovelRunner({ pool, makeDeps, runnerId: 'test-runner', leaseSeconds: 30 });
    expect(await runner.tick()).toBe(true);
    const paused = await getNovelRun(pool, projectId);
    expect(paused?.status).toBe('paused');
    expect(paused?.next_chapter).toBe(2);
    const resumed = await resumeNovelRun(pool, { projectId, autoContinue: true });
    expect(resumed.status).toBe('producing');
    expect(await runner.tick()).toBe(true);
    const after = await getNovelRun(pool, projectId);
    expect(after?.status).toBe('completed');
    expect(after?.next_chapter).toBe(3);
    // Nothing left to claim.
    expect(await runner.tick()).toBe(false);

    // The bible is COMPLETE: cast, world, organization, propositions, promises, blueprint.
    const project = await getProject(pool, projectId);
    const plan = project.settings.story_plan as {
      bible_artifact_id: string;
      blueprint_artifact_id: string;
    };
    expect(plan.bible_artifact_id).toBeTruthy();
    const bible = await pool.query<{
      payload: {
        entities: { type: string }[];
        propositions: unknown[];
        promises: unknown[];
        commits: unknown[][];
      };
    }>('SELECT payload FROM workflow_artifacts WHERE id = $1', [plan.bible_artifact_id]);
    const b = bible.rows[0]?.payload;
    expect(b?.entities.filter((e) => e.type === 'character')).toHaveLength(3);
    expect(b?.entities.filter((e) => e.type === 'location')).toHaveLength(2);
    expect(b?.entities.filter((e) => e.type === 'organization')).toHaveLength(1);
    expect(b?.entities.filter((e) => e.type === 'ability')).toHaveLength(1);
    expect(b?.propositions.length).toBeGreaterThanOrEqual(3);
    expect(b?.promises).toHaveLength(1);
    expect((b?.commits[0]?.length ?? 0) > 0).toBe(true);

    // Both chapters accepted; canon advanced once per chapter after the bible commits.
    const chapters = await pool.query<{ number: number; status: string }>(
      'SELECT number, status FROM chapters WHERE project_id = $1 ORDER BY number',
      [projectId],
    );
    expect(chapters.rows).toEqual([
      { number: 1, status: 'accepted' },
      { number: 2, status: 'accepted' },
    ]);
    const commits = await pool.query<{ source: string }>(
      'SELECT source FROM canon_commits WHERE project_id = $1 ORDER BY version',
      [projectId],
    );
    expect(commits.rows.filter((c) => c.source === 'chapter_acceptance')).toHaveLength(2);
    expect(commits.rows.filter((c) => c.source === 'bible').length).toBeGreaterThanOrEqual(1);

    // Evidence anchoring did its job: the extracted event cites the real span of its quote.
    const ev = await pool.query<{ quote: string; start: number; end: number; text: string }>(
      `SELECT es.quote, es.start_cp AS start, es.end_cp AS end, mv.text
         FROM evidence_spans es JOIN manuscript_versions mv ON mv.id = es.manuscript_version_id
        WHERE mv.project_id = $1`,
      [projectId],
    );
    expect(ev.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of ev.rows) {
      expect(row.quote).toBe('The gate rota listed eleven hunters.');
      expect(row.start).toBeGreaterThan(5);
      expect(sliceCodePoints(toNfcText(row.text), row.start, row.end)).toBe(row.quote);
    }

    // The run's event log tells the whole story in order.
    const events = await listNovelRunEvents(pool, after?.id ?? '');
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'run.created',
        'run.suggestions_ready',
        'run.approved',
        'run.planned',
        'chapter.started',
        'chapter.accepted',
        'run.completed',
      ]),
    );
    expect(kinds.filter((k) => k === 'chapter.accepted')).toHaveLength(2);

    // Scene drafts were normalized from prose: paragraph tables match the text, not the model's guess.
    const drafts = await pool.query<{
      payload: { text: string; paragraphs: { start: number; end: number }[] };
    }>(`SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_draft'`, [
      projectId,
    ]);
    expect(drafts.rows.length).toBe(4);
    for (const d of drafts.rows) {
      const segs = segmentParagraphs(toNfcText(d.payload.text));
      expect(d.payload.paragraphs.length).toBe(segs.length);
    }
  }, 300_000);
});

run(
  'a runner that loses its lease stops without writing, and a project-scoped runner claims only its project (ADR-0091)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    let otherId: string;
    const provider = new MockProvider((req) => script(req));

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-lease');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: 'Ash Ledger',
        operatingMode: 'autopilot',
      }));
      ({ projectId: otherId } = await createProject(pool, {
        workspaceId,
        title: 'Other Ledger',
        operatingMode: 'autopilot',
      }));
    }, 120_000);

    afterAll(async () => {
      await pool.end();
    });

    const makeDeps = (input?: { projectId: string }, p: MockProvider = provider) => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', p]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId: input?.projectId ?? projectId },
          new ArtifactLlmOutputStore(pool, {
            workspaceId,
            projectId: input?.projectId ?? projectId,
          }),
        ),
        minEnglishConfidence: 0.99,
        cancelPollMs: 10,
      }),
    });
    // The first planning call is held open until the durable cancellation check aborts it.
    const heldOpen = () =>
      makeDeps(
        undefined,
        new MockProvider((req) => script(req)).injectFault({
          kind: 'block',
          onCall: 1,
          until: new Promise(() => undefined),
        }),
      );

    it('keeps a planning run claimable when the cancellation came from a lost lease, and fails it otherwise', async () => {
      for (const id of [projectId, otherId]) {
        const started = await startNovel(makeDeps({ projectId: id }), {
          projectId: id,
          intake: INTAKE,
        });
        await approveConcept(pool, { projectId: id, conceptId: started.concepts[0]?.id ?? '' });
      }
      const planning = await getNovelRun(pool, projectId);
      if (!planning) throw new Error('run expected');
      expect(planning.status).toBe('planning');
      // The G8 incident: the stage started, then the lease read failed mid-planning and the call was cancelled.
      const cancelAfterStart = () => {
        let checks = 0;
        return async () => Promise.resolve(++checks > 1);
      };
      const lost = await advanceNovelRun(heldOpen(), planning, {
        isCancelled: cancelAfterStart(),
        leaseLost: () => true,
      });
      expect(lost).toMatchObject({ kind: 'stopped', reason: 'lease_lost' });
      expect((await getNovelRun(pool, projectId))?.status).toBe('planning');
      // An operator's cancellation (the lease still held) keeps its old outcome.
      const cancelled = await advanceNovelRun(heldOpen(), planning, {
        isCancelled: cancelAfterStart(),
        leaseLost: () => false,
      });
      expect(cancelled).toMatchObject({ kind: 'stopped', reason: 'planning_failed' });
      expect((await getNovelRun(pool, projectId))?.status).toBe('failed');
    }, 300_000);

    it('claims only the named project’s run', async () => {
      const other = await getNovelRun(pool, otherId);
      expect(other?.status).toBe('planning');
      // The failed run above is not claimable; the other project's planning run is, but not for this project.
      const scoped = new NovelRunner({ pool, makeDeps, runnerId: 'scoped', projectId });
      expect(await scoped.tick()).toBe(false);
      expect((await getNovelRun(pool, otherId))?.runner_id ?? null).toBeNull();
      const claimed = await claimNovelRun(pool, 'scoped-other', 60, otherId);
      expect(claimed?.project_id).toBe(otherId);
      expect(claimed?.runner_id).toBe('scoped-other');
    }, 120_000);

    it('records a call aborted by the runner’s lost lease as lease_lost (ADR-0109)', async () => {
      const { projectId: thirdId } = await createProject(pool, {
        workspaceId,
        title: 'Third Ledger',
        operatingMode: 'autopilot',
      });
      const started = await startNovel(makeDeps({ projectId: thirdId }), {
        projectId: thirdId,
        intake: INTAKE,
      });
      await approveConcept(pool, { projectId: thirdId, conceptId: started.concepts[0]?.id ?? '' });
      const planning = await getNovelRun(pool, thirdId);
      if (!planning) throw new Error('run expected');
      const lease = new AbortController();
      setTimeout(() => lease.abort(), 200);
      const held = makeDeps(
        { projectId: thirdId },
        new MockProvider((req) => script(req)).injectFault({
          kind: 'block',
          onCall: 1,
          until: new Promise(() => undefined),
        }),
      );
      const outcome = await advanceNovelRun(held, planning, {
        isCancelled: async () => Promise.resolve(lease.signal.aborted),
        leaseLost: () => lease.signal.aborted,
        cancelSignals: [{ signal: lease.signal, reason: 'lease_lost' }],
      });
      expect(outcome).toMatchObject({ kind: 'stopped', reason: 'lease_lost' });
      const calls = await pool.query<{ reason: string | null }>(
        `SELECT cancellation->>'reason' AS reason FROM llm_calls
          WHERE project_id = $1 AND cancellation IS NOT NULL`,
        [thirdId],
      );
      expect(calls.rows.map((r) => r.reason)).toEqual(['lease_lost']);
    }, 120_000);
  },
);
