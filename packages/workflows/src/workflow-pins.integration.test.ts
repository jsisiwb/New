import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, getProject, PgAuditStore, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { PromptRegistry } from '@yeonjae/prompts';
import { Gateway, MemoryBudget, MockProvider } from '@yeonjae/gateway';
import { makeContext, produceChapter } from './chapter-production.js';
import { makePlanContext } from './story-plan.js';
import { advanceNovelRun, approveConcept, startNovel } from './novel.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { simulatedModelScript } from './simulated-model.js';
import { createHarness, REPLAY_ROUTING, type Harness } from './testkit.js';

const dbAvailable = !!databaseUrl();

function upgradedRegistry(options: { omitHistorical?: boolean; changeHistorical?: boolean } = {}) {
  const source = PromptRegistry.fromDirectory();
  const registry = new PromptRegistry();
  for (const version of source.list()) {
    if (
      version.id === 'scene_writer@1.0.0' ||
      version.id === source.activeSet().mapping.world_builder
    ) {
      const meta = { ...version, content_hash: undefined };
      registry.add({ ...meta, version: '2.0.0' }, version.system_template, version.user_template);
      if (options.omitHistorical) continue;
      if (options.changeHistorical) {
        registry.add(
          meta,
          version.system_template + '\nChanged instructions.',
          version.user_template,
        );
        continue;
      }
    }
    registry.add(version, version.system_template, version.user_template);
  }
  return registry;
}

describe.skipIf(!dbAvailable)('deployment-safe persisted workflow pins (ADR-0053)', () => {
  let pool: Pool;
  let h: Harness;

  beforeEach(async () => {
    pool = await freshDatabase();
    h = await createHarness(pool);
  }, 30_000);

  afterEach(async () => {
    await pool.end();
  });

  const open = async (
    kind: 'chapter' | 'planning',
    registry = PromptRegistry.fromDirectory(),
    projectId = h.projectId,
  ) => {
    const deps = { pool, gateway: h.gateway(), registry, bindings: h.bindings };
    return kind === 'chapter' ? makeContext(deps, projectId, 1) : makePlanContext(deps, projectId);
  };

  describe.each(['chapter', 'planning'] as const)('%s jobs', (kind) => {
    it('does not consult active defaults at all when restoring an existing job', async () => {
      const original = (await open(kind)).ctx;
      const registry = upgradedRegistry();
      const activeSet = vi.spyOn(registry, 'activeSet').mockImplementation(() => {
        throw new Error('Unrelated new defaults unavailable');
      });
      const restored = (await open(kind, registry)).ctx;
      expect(restored.pins).toEqual(original.pins);
      expect(activeSet).not.toHaveBeenCalled();
    });

    it('refuses a canon-read column that disagrees with the persisted pin', async () => {
      const { ctx } = await open(kind);
      await pool.query(
        'UPDATE jobs SET canon_version_read = canon_version_read + 1 WHERE id = $1',
        [ctx.job.id],
      );
      await expect(open(kind)).rejects.toMatchObject({
        code: 'STEP_NONDETERMINISTIC',
        options: { data: { reason: 'canon_version_pin_mismatch' } },
      });
      expect((await pool.query('SELECT id FROM llm_calls')).rows).toHaveLength(0);
    });

    it('does not create a pinned job for an invalid identity and permits configuration repair', async () => {
      const project = await getProject(pool, h.projectId);
      await pool.query(
        `UPDATE projects SET settings = jsonb_set(settings, '{narrative_identity_ref}', '"project/missing@1"'::jsonb) WHERE id = $1`,
        [h.projectId],
      );
      await expect(open(kind)).rejects.toThrow();
      expect((await pool.query('SELECT id FROM jobs')).rows).toHaveLength(0);
      await pool.query('UPDATE projects SET settings = $2::jsonb WHERE id = $1', [
        h.projectId,
        JSON.stringify(project.settings),
      ]);
      await expect(open(kind)).resolves.toMatchObject({
        ctx: { job: { kind: kind === 'chapter' ? 'chapter_production' : 'story_plan' } },
      });
    });

    it('reports changed project identity as a pin conflict before attempting profile lookup', async () => {
      await open(kind);
      await pool.query(
        `UPDATE projects SET settings = jsonb_set(settings, '{narrative_identity_ref}', '"project/missing@1"'::jsonb) WHERE id = $1`,
        [h.projectId],
      );
      await expect(open(kind)).rejects.toMatchObject({ code: 'STEP_NONDETERMINISTIC' });
    });

    it('concurrent creators with different defaults converge on the winning job pins', async () => {
      const original = (await open(kind)).ctx;
      const registry = upgradedRegistry();
      const oldDefault = upgradedRegistry();
      vi.spyOn(oldDefault, 'activeSet').mockReturnValue(original.promptSet);
      await makeContext({ pool, gateway: h.gateway(), registry }, h.projectId, 99);
      const project = await getProject(pool, h.projectId);
      const next = await createProject(pool, {
        workspaceId: h.workspaceId,
        title: 'Concurrent deployment job',
        settings: project.settings,
      });
      const [oldDeployment, newDeployment] = await Promise.all([
        open(kind, oldDefault, next.projectId),
        open(kind, registry, next.projectId),
      ]);
      expect(oldDeployment.ctx.job.id).toBe(newDeployment.ctx.job.id);
      expect(oldDeployment.ctx.promptSet).toEqual(newDeployment.ctx.promptSet);
      expect(oldDeployment.ctx.pins).toEqual(newDeployment.ctx.pins);
    });

    it('resumes the original set after a release, while new jobs use the new defaults', async () => {
      const original = (await open(kind)).ctx;
      const registry = upgradedRegistry();
      expect(registry.activeSet().id).not.toBe(original.promptSet.id);
      const resumed = (await open(kind, registry)).ctx;
      expect(resumed.job.id).toBe(original.job.id);
      expect(resumed.pins).toEqual(original.pins);
      expect(resumed.promptSet).toEqual(original.promptSet);
      expect(resumed.job.pins).toEqual(original.job.pins);

      const project = await getProject(pool, h.projectId);
      const next = await createProject(pool, {
        workspaceId: h.workspaceId,
        title: 'New deployment job',
        settings: project.settings,
      });
      const fresh = (await open(kind, registry, next.projectId)).ctx;
      expect(fresh.promptSet.id).toBe(registry.activeSet().id);
      expect(fresh.promptSet.mapping.scene_writer).toBe('scene_writer@2.0.0');
      expect((await pool.query('SELECT id FROM llm_calls')).rows).toHaveLength(0);
    });

    it.each([
      ['missing historical prompt', { omitHistorical: true }],
      ['changed historical prompt content', { changeHistorical: true }],
    ] as const)('fails closed before spend for %s', async (_label, options) => {
      await open(kind);
      await expect(open(kind, upgradedRegistry(options))).rejects.toMatchObject({
        code: 'STEP_NONDETERMINISTIC',
        options: {
          step: 'init',
          data: {
            reason:
              'omitHistorical' in options ? 'missing_historical_prompt' : 'prompt_version_mismatch',
          },
        },
      });
      expect((await pool.query('SELECT id FROM llm_calls')).rows).toHaveLength(0);
    });

    it('still refuses policy changes even when old prompt versions remain available', async () => {
      await open(kind);
      await pool.query(
        "UPDATE projects SET production_policy_version = 'policy/premium@1' WHERE id = $1",
        [h.projectId],
      );
      await expect(open(kind, upgradedRegistry())).rejects.toMatchObject({
        code: 'STEP_NONDETERMINISTIC',
      });
      expect((await pool.query('SELECT id FROM llm_calls')).rows).toHaveLength(0);
    });

    it.each([
      ['missing prompt map', { prompt_set: null }],
      ['empty prompt map', { prompt_set: {} }],
      ['inconsistent prompt set id', { prompt_set_id: 'sha256:not-the-recorded-set' }],
      ['different policy hash', { production_policy_hash: 'sha256:changed' }],
      [
        'different identity version',
        { narrative_identity_version_id: '0191b2a0-0000-7000-8000-000000060099' },
      ],
      ['different identity reference', { narrative_identity_ref: 'project/different@1' }],
      ['invalid canon read pin', { canon_version_read: -1 }],
      ['different valid canon read pin', { canon_version_read: 1 }],
    ])('refuses corrupted persisted pins: %s', async (_label, patch) => {
      const { ctx } = await open(kind);
      await pool.query('UPDATE jobs SET pins = pins || $2::jsonb WHERE id = $1', [
        ctx.job.id,
        JSON.stringify(patch),
      ]);
      await expect(open(kind)).rejects.toMatchObject({ code: 'STEP_NONDETERMINISTIC' });
      expect((await pool.query('SELECT id FROM llm_calls')).rows).toHaveLength(0);
    });

    it('refuses a well-formed map that disagrees with its immutable prompt set', async () => {
      const { ctx } = await open(kind);
      const mapping = { ...ctx.pins.promptSet, scene_writer: 'scene_planner@1.0.0' };
      await pool.query(
        "UPDATE jobs SET pins = jsonb_set(pins, '{prompt_set}', $2::jsonb) WHERE id = $1",
        [ctx.job.id, JSON.stringify(mapping)],
      );
      await expect(open(kind)).rejects.toMatchObject({ code: 'STEP_NONDETERMINISTIC' });
    });
  });

  it('keeps approved-concept bible generation on the suggestion job pins after deployment', async () => {
    const { projectId } = await createProject(pool, {
      workspaceId: h.workspaceId,
      title: 'Deployment-safe planning',
      operatingMode: 'autopilot',
    });
    const provider = new MockProvider(simulatedModelScript);
    const routing = Object.fromEntries(
      Object.entries(REPLAY_ROUTING).map(([key, routes]) => [
        key,
        routes.map((route) => ({ ...route, provider: 'mock' })),
      ]),
    ) as typeof REPLAY_ROUTING;
    const deps = {
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId: h.workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId: h.workspaceId, projectId }),
        ),
        minEnglishConfidence: 0.99,
      }),
    };
    const started = await startNovel(deps, {
      projectId,
      intake: {
        title_working: 'Ash Ledger',
        premise: 'An accountant exposes a guild conspiracy by climbing the hunter ranks.',
        genre: { primary: 'hunter-gate' },
        main_character: { name: 'Seo Ji-an', description: 'A meticulous accountant.' },
        target_chapters: 2,
        target_words_per_chapter: 600,
        operating_mode: 'autopilot',
      },
    });
    const original = (await makePlanContext(deps, projectId)).ctx;
    const concept = started.concepts[0];
    if (!concept) throw new Error('Missing concept');
    const approved = await approveConcept(pool, { projectId, conceptId: concept.id });
    const result = await advanceNovelRun({ ...deps, registry: upgradedRegistry() }, approved);
    expect(result.kind).toBe('planned');
    expect((await getProject(pool, projectId)).settings.story_plan).toBeDefined();
    const calls = await pool.query<{ prompt_version_id: string; prompt_hash: string }>(
      'SELECT prompt_version_id, prompt_hash FROM llm_calls WHERE project_id = $1',
      [projectId],
    );
    expect(
      calls.rows.some(
        (call) => call.prompt_version_id === original.promptSet.mapping.world_builder,
      ),
    ).toBe(true);
    for (const call of calls.rows) {
      expect(Object.values(original.promptSet.mapping)).toContain(call.prompt_version_id);
      expect(call.prompt_hash).toBe(original.registry.get(call.prompt_version_id).content_hash);
    }
    expect(
      (await makePlanContext({ ...deps, registry: upgradedRegistry() }, projectId)).ctx.pins,
    ).toEqual(original.pins);
    expect(provider.log.some((request) => request.trace?.role === 'scene_writer')).toBe(false);
    expect(
      provider.log.filter((request) => request.trace?.role === 'requirement_interpreter'),
    ).toHaveLength(1);
    expect(
      provider.log.filter((request) => request.trace?.role === 'concept_generator'),
    ).toHaveLength(started.concepts.length);
  }, 60_000);

  it('finishes an interrupted chapter after a prompt release without repeating completed calls', async () => {
    const deps = { pool, gateway: h.gateway(), bindings: h.bindings };
    await expect(produceChapter(deps, h.input(1, { failAfterStep: 'evaluate' }))).rejects.toThrow();
    const before = await pool.query<{ id: string; prompt_version_id: string }>(
      'SELECT id, prompt_version_id FROM llm_calls',
    );
    const original = (await makeContext(deps, h.projectId, 1)).ctx;
    const resumed = await produceChapter({ ...deps, registry: upgradedRegistry() }, h.input(1));
    expect(resumed.status).toBe('completed');
    expect(resumed.pins).toEqual(original.pins);
    expect(
      resumed.steps.filter((step) => step.status === 'replayed').map((step) => step.step),
    ).toEqual(expect.arrayContaining(['story_spec', 'story_bible', 'scene_draft', 'evaluate']));
    const after = await pool.query<{ id: string; prompt_version_id: string }>(
      'SELECT id, prompt_version_id FROM llm_calls',
    );
    expect(after.rows).toEqual(expect.arrayContaining(before.rows));
    expect(after.rows.length - before.rows.length).toBe(10);
    expect(after.rows.some((call) => call.prompt_version_id === 'scene_writer@2.0.0')).toBe(false);
  }, 60_000);
});
