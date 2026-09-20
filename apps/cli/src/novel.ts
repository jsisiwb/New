/**
 * CLI surface for the novel lifecycle. Same functions the API calls; the CLI is the path that needs no
 * browser and no second process:
 *
 *   novel:start   <project> <intake.json> [--identity=<composed-ref>]   spec + suggestions
 *   novel:approve <project> <concept-id> [--one-chapter-at-a-time] [--stop-after=N]
 *   novel:run     <project> [--once]                                    drive the run to rest (or one step)
 *   novel:status  <project>
 *   novel:pause | novel:resume | novel:cancel <project>
 *
 * `novel:start` pins the fixture composed identity on the project when none is pinned yet, so a project
 * created with `project:create` is usable without an extra step; a project with its own identity keeps it.
 */
import { readFileSync } from 'node:fs';
import {
  getNovelRun,
  getProject,
  listNovelRunEvents,
  PgAuditStore,
  PgProviderAdmission,
  SharedBudget,
  type Pool,
} from '@yeonjae/db';
import { Gateway, MemoryBudget, resolveProvidersFromEnv } from '@yeonjae/gateway';
import {
  advanceNovelRun,
  approveConcept,
  ArtifactLlmOutputStore,
  cancelNovelRun,
  NovelRunner,
  pauseNovelRun,
  resumeNovelRun,
  startNovel,
  WorkflowError,
  type NovelDeps,
} from '@yeonjae/workflows';

const DEFAULT_IDENTITY_REF = 'project/0191b2a0-0000-7000-8000-000000000001@1';
const DEFAULT_IDENTITY_VERSION = '0191b2a0-0000-7000-8000-000000060001';

export interface CliResult {
  ok: boolean;
  output: unknown;
}

function depsFor(pool: Pool): (input: { workspaceId: string; projectId: string }) => NovelDeps {
  const resolved = resolveProvidersFromEnv();
  const shared = process.env.YEONJAE_ENFORCEMENT_MODE === 'shared';
  const budgetCents = Number(process.env.YEONJAE_BUDGET_CENTS ?? '100000');
  return ({ workspaceId, projectId }) => ({
    pool,
    gateway: new Gateway({
      providers: resolved.providers(),
      routing: resolved.routing,
      budget: shared ? new SharedBudget(pool) : new MemoryBudget(budgetCents),
      ...(shared
        ? { admission: new PgProviderAdmission(pool, { holder: `cli:${process.pid}` }) }
        : {}),
      audit: new PgAuditStore(
        pool,
        { workspaceId, projectId },
        new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
      ),
    }),
  });
}

async function ensureIdentity(
  pool: Pool,
  projectId: string,
  ref: string | undefined,
): Promise<void> {
  const project = await getProject(pool, projectId);
  const settings = project.settings;
  if (typeof settings.narrative_identity_ref === 'string' && ref === undefined) return;
  await pool.query(
    'UPDATE projects SET settings = settings || $2::jsonb, updated_at = now() WHERE id = $1',
    [
      projectId,
      JSON.stringify({
        narrative_identity_ref: ref ?? DEFAULT_IDENTITY_REF,
        narrative_identity_version_id: DEFAULT_IDENTITY_VERSION,
      }),
    ],
  );
}

function flag(flags: readonly string[], name: string): string | undefined {
  return flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function runNovelCommand(
  pool: Pool,
  cmd: string,
  rest: readonly string[],
  usage: string,
): Promise<CliResult> {
  const [projectId, ...args] = rest;
  if (!projectId) return { ok: false, output: usage };
  try {
    switch (cmd) {
      case 'novel:start': {
        const [file, ...flags] = args;
        if (!file) return { ok: false, output: usage };
        await ensureIdentity(pool, projectId, flag(flags, 'identity'));
        const project = await getProject(pool, projectId);
        const intake = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        const make = depsFor(pool);
        const result = await startNovel(make({ workspaceId: project.workspace_id, projectId }), {
          projectId,
          intake,
        });
        return {
          ok: true,
          output: {
            run: result.run.status,
            spec_version: result.specVersion,
            suggestions: result.concepts.map((c) => ({
              id: c.id,
              angle: c.angle,
              logline: c.logline,
              story_promise: c.story_promise,
              chapter_one_hook: c.chapter_one_hook,
              ending_direction: c.ending_direction,
            })),
            next: `pnpm cli novel:approve ${projectId} <id>`,
          },
        };
      }
      case 'novel:approve': {
        const [conceptId, ...flags] = args;
        if (!conceptId) return { ok: false, output: usage };
        const stop = flag(flags, 'stop-after');
        const run = await approveConcept(pool, {
          projectId,
          conceptId,
          autoContinue: !flags.includes('--one-chapter-at-a-time'),
          stopAfterChapter: stop ? Number(stop) : undefined,
        });
        return {
          ok: true,
          output: { run: run.status, next: `pnpm cli novel:run ${projectId}` },
        };
      }
      case 'novel:run': {
        const project = await getProject(pool, projectId);
        const make = depsFor(pool);
        if (args.includes('--once')) {
          const run = await getNovelRun(pool, projectId);
          if (!run) return { ok: false, output: { error: 'NO_RUN' } };
          const outcome = await advanceNovelRun(
            make({ workspaceId: project.workspace_id, projectId }),
            run,
          );
          return {
            ok: true,
            output: {
              outcome: outcome.kind,
              run: outcome.run.status,
              next_chapter: outcome.run.next_chapter,
            },
          };
        }
        const runner = new NovelRunner({ pool, makeDeps: make, runnerId: `cli:${process.pid}` });
        // Drive until nothing is claimable: the run rests (completed, paused, needs_attention, failed).
        while (await runner.tick()) {
          /* keep claiming while work remains */
        }
        const run = await getNovelRun(pool, projectId);
        return { ok: run?.status !== 'failed', output: await statusView(pool, projectId) };
      }
      case 'novel:status':
        return { ok: true, output: await statusView(pool, projectId) };
      case 'novel:pause':
        return { ok: true, output: { run: (await pauseNovelRun(pool, projectId)).status } };
      case 'novel:resume': {
        const stop = flag(args, 'stop-after');
        const run = await resumeNovelRun(pool, {
          projectId,
          stopAfterChapter: stop ? Number(stop) : undefined,
        });
        return { ok: true, output: { run: run.status, next_chapter: run.next_chapter } };
      }
      case 'novel:cancel':
        return { ok: true, output: { run: (await cancelNovelRun(pool, projectId)).status } };
      default:
        return { ok: false, output: usage };
    }
  } catch (err) {
    if (err instanceof WorkflowError)
      return { ok: false, output: { error: err.code, detail: err.detail, step: err.options.step } };
    throw err;
  }
}

async function statusView(pool: Pool, projectId: string) {
  const run = await getNovelRun(pool, projectId);
  if (!run) return { error: 'NO_RUN', hint: 'pnpm cli novel:start <project> <intake.json>' };
  const chapters = await pool.query<{ number: number; status: string }>(
    'SELECT number, status FROM chapters WHERE project_id = $1 ORDER BY number',
    [projectId],
  );
  const events = await listNovelRunEvents(pool, run.id, 0, 500);
  return {
    status: run.status,
    spec_version: run.spec_version,
    approved_concept_id: run.approved_concept_id,
    target_chapters: run.target_chapters,
    next_chapter: run.next_chapter,
    auto_continue: run.auto_continue,
    stop_after_chapter: run.stop_after_chapter,
    last_error: run.last_error,
    accepted_chapters: chapters.rows.filter((c) => c.status === 'accepted').length,
    chapters: chapters.rows,
    recent_events: events.slice(-12).map((e) => ({ seq: e.seq, kind: e.kind, ...e.payload })),
  };
}

export const NOVEL_COMMANDS = new Set([
  'novel:start',
  'novel:approve',
  'novel:run',
  'novel:status',
  'novel:pause',
  'novel:resume',
  'novel:cancel',
]);

export const NOVEL_USAGE = `
Novel lifecycle (DATABASE_URL + YEONJAE_PROVIDER_MODE required; live mode needs YEONJAE_LIVE_*):
  novel:start <project> <intake.json> [--identity=<composed-ref>]
                                               interpret the intake and propose story directions (spends R-class calls)
  novel:approve <project> <concept-id> [--one-chapter-at-a-time] [--stop-after=N]
                                               approve a direction; queues full-bible planning then production
  novel:run <project> [--once]                 drive the run: build the bible, then write chapters until it rests
  novel:status <project>                       run state, chapter progress, recent events
  novel:pause <project> | novel:resume <project> [--stop-after=N] | novel:cancel <project>
`;
