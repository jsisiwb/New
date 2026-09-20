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
  createProject,
  createWorkspace,
  getNovelRun,
  getProject,
  listNovelRunEvents,
  PgAuditStore,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { Gateway, MemoryBudget, MockProvider, type ProviderRequest } from '@yeonjae/gateway';
import { segmentParagraphs, sliceCodePoints, toNfcText } from '@yeonjae/prose';
import { simulatedModelScript as script } from './simulated-model.js';
import { approveConcept, startNovel } from './novel.js';
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

  it('approval queues planning; the runner builds the full bible, then writes every chapter', async () => {
    const before = await getNovelRun(pool, projectId);
    const concept = (await startNovel(makeDeps(), { projectId, intake: INTAKE })).concepts[1];
    expect(concept).toBeDefined();
    const approved = await approveConcept(pool, { projectId, conceptId: concept?.id ?? '' });
    expect(approved.status).toBe('planning');
    expect(approved.approved_concept_id).toBe(concept?.id);
    expect(before?.status).toBe('awaiting_approval');

    const runner = new NovelRunner({ pool, makeDeps, runnerId: 'test-runner', leaseSeconds: 30 });
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
