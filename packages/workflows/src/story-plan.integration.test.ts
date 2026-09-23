import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  createWorkspace,
  getProject,
  PgAuditStore,
  transitionNovelRun,
  type Pool,
} from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { Gateway, MemoryBudget, MockProvider, type ProviderRequest } from '@yeonjae/gateway';
import { advanceNovelRun, approveConcept, resumeNovelRun, startNovel } from './novel.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { loadStoredPlan } from './story-plan.js';
import { simulatedModelScript } from './simulated-model.js';
import { REPLAY_ROUTING } from './testkit.js';

const suite = databaseUrl() ? describe : describe.skip;
const intake = {
  title_working: 'Ash Ledger',
  premise: 'An accountant exposes a guild conspiracy by climbing the hunter ranks.',
  genre: { primary: 'hunter-gate' },
  main_character: { name: 'Seo Ji-an', description: 'A meticulous accountant.' },
  target_chapters: 2,
  target_words_per_chapter: 600,
  operating_mode: 'autopilot',
};
const routing = Object.fromEntries(
  Object.entries(REPLAY_ROUTING).map(([key, routes]) => [
    key,
    routes.map((route) => ({ ...route, provider: 'mock' })),
  ]),
) as typeof REPLAY_ROUTING;

suite('complete story bible before prose', () => {
  let pool: Pool;
  let workspaceId: string;
  beforeAll(async () => {
    pool = await freshDatabase();
    workspaceId = await createWorkspace(pool, 'complete-bible-tests');
  }, 120_000);
  afterAll(async () => {
    await pool.end();
  });

  async function setup(change?: (role: string, output: Record<string, unknown>) => void) {
    const { projectId } = await createProject(pool, {
      workspaceId,
      title: 'Complete bible',
      operatingMode: 'autopilot',
    });
    const provider = new MockProvider((request: ProviderRequest) => {
      const result = simulatedModelScript(request);
      if (result?.json && typeof result.json === 'object') {
        change?.(request.trace?.role ?? '', result.json as Record<string, unknown>);
      }
      return result;
    });
    const deps = {
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
    };
    const started = await startNovel(deps, { projectId, intake });
    const concept = started.concepts[0];
    if (!concept) throw new Error('Suggestions missing');
    const approved = await approveConcept(pool, { projectId, conceptId: concept.id });
    return { projectId, provider, deps, approved };
  }

  it('accepts a live arc plan whose repetition and cadence checks arrive as prose (ADR-0056)', async () => {
    const { projectId, deps, approved } = await setup((role, output) => {
      if (role === 'arc_planner') {
        output.repetition_check = '이전 아크와 겹침 없음.';
        output.cadence_check = { cider_interval_ok: true, notes: '사이다 간격 준수.' };
      }
    });
    const planned = await advanceNovelRun(deps, approved);
    const chapter = await advanceNovelRun(deps, planned.run);
    expect(chapter.kind).toBe('chapter_accepted');
    const arc = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'arc_plan'`,
      [projectId],
    );
    expect(arc.rows[0]?.payload.repetition_check).toEqual({ notes: '이전 아크와 겹침 없음.' });
    expect(arc.rows[0]?.payload.cadence_check).toMatchObject({ notes: ['사이다 간격 준수.'] });
  }, 120_000);

  it('retains complete design before any manuscript call and carries it into planners and writer cards', async () => {
    const voice = 'Counts pauses like overdue invoices.';
    const { projectId, provider, deps, approved } = await setup((role, output) => {
      if (role === 'character_designer') {
        output.author_only_ending = 'AUTHOR_ONLY_ENDGAME_MARKER';
        const protagonist = (output.characters as Record<string, unknown>[])[0];
        if (!protagonist) throw new Error('Simulated protagonist missing');
        protagonist.voice_notes = voice;
        protagonist.goals = ['Recover the original ledger'];
        protagonist.flaws = ['Confuses caution with loyalty'];
        protagonist.background = 'Unabridged background. '.repeat(60);
      }
    });
    const planned = await advanceNovelRun(deps, approved);
    expect(planned.kind).toBe('planned');
    expect(provider.log.some((r) => r.trace?.role === 'scene_writer')).toBe(false);
    const stored = await loadStoredPlan(pool, projectId);
    expect(stored?.bible.design?.characters).toMatchObject({
      characters: [
        expect.objectContaining({
          voice_notes: voice,
          background: 'Unabridged background. '.repeat(60),
        }),
        expect.anything(),
        expect.anything(),
      ],
    });
    expect(stored?.bible.design?.world).toHaveProperty('terminology');
    expect(stored?.bible.design?.progression).toHaveProperty('ranks');
    expect(provider.log.find((r) => r.trace?.role === 'story_architect')?.user).toContain(voice);
    const chapter = await advanceNovelRun(deps, planned.run);
    expect(chapter.kind).toBe('chapter_accepted');
    for (const role of ['arc_planner', 'chapter_planner', 'scene_writer']) {
      const request = provider.log.find((r) => r.trace?.role === role);
      expect(request, role).toBeDefined();
      expect(`${request?.system}\n${request?.user}`, role).toContain(voice);
      if (role === 'scene_writer')
        expect(`${request?.system}\n${request?.user}`).not.toContain('AUTHOR_ONLY_ENDGAME_MARKER');
    }
  }, 120_000);

  const invalidPlans: [string, string, (output: Record<string, unknown>) => void][] = [
    [
      'nameless cast',
      'character_designer',
      (o) => {
        const characters = o.characters as Record<string, unknown>[];
        const protagonist = characters[0];
        if (!protagonist) throw new Error('Simulated protagonist missing');
        delete protagonist.display_name;
      },
    ],
    [
      'missing supplied protagonist',
      'character_designer',
      (o) => {
        const characters = o.characters as Record<string, unknown>[];
        const protagonist = characters[0];
        if (!protagonist) throw new Error('Simulated protagonist missing');
        protagonist.display_name = 'Someone else';
      },
    ],
    [
      'empty world',
      'world_builder',
      (o) => {
        o.world_rules = [];
      },
    ],
    [
      'empty progression',
      'power_system_designer',
      (o) => {
        o.system_rules = [];
      },
    ],
    [
      'missing seasons',
      'story_architect',
      (o) => {
        o.seasons = [];
      },
    ],
    [
      'missing protagonist arc',
      'story_architect',
      (o) => {
        delete o.protagonist_arc;
      },
    ],
    [
      'missing ending',
      'story_architect',
      (o) => {
        delete o.ending;
      },
    ],
    [
      'missing endgame',
      'story_architect',
      (o) => {
        o.endgame_requirements = [];
      },
    ],
    [
      'initial gap',
      'story_architect',
      (o) => {
        o.seasons = [season(2, 2)];
      },
    ],
    [
      'trailing gap',
      'story_architect',
      (o) => {
        o.seasons = [season(1, 1)];
      },
    ],
    [
      'overlap',
      'story_architect',
      (o) => {
        o.seasons = [season(1, 1), season(1, 2)];
      },
    ],
    [
      'out of range',
      'story_architect',
      (o) => {
        o.seasons = [season(1, 3)];
      },
    ],
    [
      'malformed promises array',
      'story_architect',
      (o) => {
        o.promises = { statement: 'not an array' };
      },
    ],
    [
      'malformed promise item',
      'story_architect',
      (o) => {
        o.promises = [null];
      },
    ],
    [
      'malformed character arc item',
      'story_architect',
      (o) => {
        o.character_arcs = [null];
      },
    ],
    [
      'malformed progression milestone item',
      'story_architect',
      (o) => {
        o.progression_arc = { system_summary: 'Audits earn hunter rank.', milestones: [null] };
      },
    ],
    [
      'malformed turning point item',
      'story_architect',
      (o) => {
        const protagonistArc = o.protagonist_arc as Record<string, unknown>;
        protagonistArc.turning_points = [null];
      },
    ],
  ];
  it.each(invalidPlans)(
    'rejects %s without pinning a partial bible or starting prose',
    async (_name, role, invalidate) => {
      const { projectId, provider, deps, approved } = await setup((current, output) => {
        if (current === role) invalidate(output);
      });
      const result = await advanceNovelRun(deps, approved);
      expect(result.kind).toBe('stopped');
      expect(result.run.last_error).toMatchObject({ code: 'ARC_PLAN_INVALID' });
      expect((await getProject(pool, projectId)).settings.story_plan).toBeUndefined();
      expect(provider.log.some((r) => r.trace?.role === 'scene_writer')).toBe(false);
    },
    30_000,
  );

  it('regenerates only a semantically rejected stage on explicit resume', async () => {
    let reject = true;
    const { projectId, provider, deps, approved } = await setup((role, output) => {
      if (role === 'story_architect' && reject) output.seasons = [];
    });
    expect((await advanceNovelRun(deps, approved)).kind).toBe('stopped');
    reject = false;
    const resumed = await resumeNovelRun(pool, { projectId });
    expect((await advanceNovelRun(deps, resumed)).kind).toBe('planned');
    const calls = provider.log.filter((r) => r.trace?.role === 'story_architect');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.trace?.activityId).not.toEqual(calls[1]?.trace?.activityId);
    expect(provider.log.filter((r) => r.trace?.role === 'character_designer')).toHaveLength(1);
  }, 30_000);

  it('replays a paid valid response after a lost checkpoint instead of regenerating it', async () => {
    const { projectId, provider, deps, approved } = await setup();
    expect((await advanceNovelRun(deps, approved)).kind).toBe('planned');
    await pool.query("UPDATE projects SET settings = settings - 'story_plan' WHERE id = $1", [
      projectId,
    ]);
    await pool.query(
      `UPDATE job_steps SET status = 'running', result = NULL
      WHERE job_id IN (SELECT id FROM jobs WHERE project_id = $1) AND step = 'blueprint'`,
      [projectId],
    );
    const queued = await transitionNovelRun(pool, {
      runId: approved.id,
      to: 'planning',
      expectFrom: ['producing'],
    });
    expect((await advanceNovelRun(deps, queued.run)).kind).toBe('planned');
    expect(provider.log.filter((r) => r.trace?.role === 'story_architect')).toHaveLength(1);
  }, 30_000);
});

function season(from: number, to: number) {
  return {
    title: 'The audit',
    objective: 'Expose the payroll fraud.',
    chapter_range_est: { from, to },
  };
}
