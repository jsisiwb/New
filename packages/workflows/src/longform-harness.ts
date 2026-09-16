/**
 * Harness for the deterministic 120-chapter continuity/replay validation (B-4-1, deterministic portion).
 *
 * It is the production harness of `testkit.ts` with one substitution: the chapter-scoped recordings come
 * from the generated long-form seed instead of the three authored chapter fixtures. Everything else — the
 * project, the pinned identity, the standard Production Policy, the Gateway with its Guard, budget, audit
 * store and English output-language check, the `produceChapter` loop itself — is the same code the CLI and
 * the worker run. Nothing here re-implements acceptance, canon or retrieval.
 */
import { readFileSync } from 'node:fs';
import { createProject, createWorkspace, PgAuditStore, type Pool } from '@yeonjae/db';
import { Gateway, MemoryBudget, ReplayProvider, type Recording } from '@yeonjae/gateway';
import { type ChapterProductionInput } from './chapter-production.js';
import {
  LONGFORM_BIBLE,
  LONGFORM_CHAPTERS,
  LONGFORM_IDS,
  longformContractId,
  longformRecordings,
} from './longform-fixture.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { FIXTURE_DIR, IDENTITY_REF, IDENTITY_VERSION, INTAKE, REPLAY_ROUTING } from './testkit.js';

/** Planning recordings are chapter-independent, so the authored ch01 ones are reused verbatim. */
const PLANNING_KEYS = ['activity:story_spec:v1', 'activity:assumptions:v1', 'activity:arc_plan:1'];

export function longformProvider(
  bindings: () => Readonly<Record<string, string>>,
  chapters = LONGFORM_CHAPTERS,
): ReplayProvider {
  const authored = JSON.parse(readFileSync(`${FIXTURE_DIR}replay.ch01.json`, 'utf8')) as Record<
    string,
    Recording
  >;
  const merged = new Map<string, Recording>();
  for (const key of PLANNING_KEYS) {
    const rec = authored[key];
    if (!rec) throw new Error(`long-form harness: planning recording ${key} is missing`);
    merged.set(key, rec);
  }
  for (const [key, rec] of Object.entries(longformRecordings(chapters))) merged.set(key, rec);
  return new ReplayProvider(merged, { name: 'replay', bindings });
}

export interface LongformHarness {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly mainTimelineId: string;
  readonly provider: ReplayProvider;
  readonly bindings: Record<string, string>;
  gateway(): Gateway;
  input(chapterNo: number, extra?: Partial<ChapterProductionInput>): ChapterProductionInput;
}

export interface LongformHarnessOptions {
  readonly chapters?: number | undefined;
  /**
   * Pin the workspace and project ids. The context-pack manifest carries both, so two runs can only be
   * compared byte-for-byte when they are genuinely equivalent — same pinned inputs, same ids. The
   * determinism proof uses this; ordinary runs let the database allocate.
   */
  readonly workspaceId?: string | undefined;
  readonly projectId?: string | undefined;
}

export async function createLongformHarness(
  pool: Pool,
  options: LongformHarnessOptions = {},
): Promise<LongformHarness> {
  const chapters = options.chapters ?? LONGFORM_CHAPTERS;
  const workspaceId = options.workspaceId
    ? ((
        await pool.query<{ id: string }>(
          'INSERT INTO workspaces (id, name) VALUES ($1, $2) RETURNING id',
          [options.workspaceId, 'longform-120'],
        )
      ).rows[0]?.id ?? options.workspaceId)
    : await createWorkspace(pool, 'longform-120');
  const { projectId, mainTimelineId } = await createProject(pool, {
    workspaceId,
    title: 'Second Awakening (120-chapter replay)',
    ...(options.projectId ? { id: options.projectId } : {}),
    settings: {
      narrative_identity_ref: IDENTITY_REF,
      narrative_identity_version_id: IDENTITY_VERSION,
    },
  });
  const bindings: Record<string, string> = {};
  const provider = longformProvider(() => bindings, chapters);
  return {
    pool,
    workspaceId,
    projectId,
    mainTimelineId,
    provider,
    bindings,
    gateway() {
      return new Gateway({
        providers: new Map([['replay', provider]]),
        routing: REPLAY_ROUTING,
        budget: new MemoryBudget(100_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
        ),
        guardContext: { pinnedIdentityVersionId: IDENTITY_VERSION },
        minEnglishConfidence: 0.99,
      });
    },
    input(chapterNo, extra = {}) {
      return {
        projectId,
        chapterNo,
        intake: INTAKE,
        bible: LONGFORM_BIBLE,
        ids: {
          arcId: LONGFORM_IDS.arcId,
          seasonId: LONGFORM_IDS.seasonId,
          contractId: longformContractId(chapterNo),
        },
        ...extra,
      };
    },
  };
}
