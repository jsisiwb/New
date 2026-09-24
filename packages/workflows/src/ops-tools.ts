/**
 * Operator tools (ADR-0079): read-only views an operator needs beside a live run. None of them calls a
 * model or writes canon.
 *
 * - `inspectPack`: rebuild a chapter's context pack from its stored contract and measure every section
 *   against the pinned budget (the live `PACK_FAILED` of ADR-0075 was diagnosed this way).
 * - `storyState`: where a serial stands — run status, accepted chapters, the last accepted ending, arc
 *   summaries, open and overdue promises.
 * - `costProjection`: calls, tokens and model time per chapter from the audit, projected to N chapters.
 * - `promptSizes`: the static size of every active prompt, largest first (the input for pruning).
 */
import {
  acceptedArcSummariesBefore,
  acceptedSummariesBefore,
  getJobByWorkflowId,
  getNovelRun,
  type Pool,
} from '@yeonjae/db';
import { assemblePack, budgetFor, estimatorFor, fetchContext } from '@yeonjae/context';
import { type PromptRegistry } from '@yeonjae/prompts';
import { WorkflowError } from './errors.js';
import { makeContext, workflowIdFor } from './chapter-production.js';
import { type ChapterContract, type StorySpec } from './planning.js';

export interface PackSectionMeasure {
  readonly name: string;
  readonly tier: string;
  readonly items: number;
  readonly tokens: number;
}

export interface PackInspection {
  readonly template: string;
  readonly role: string;
  readonly chapter_no: number;
  readonly estimator: string;
  readonly budget: number | undefined;
  readonly sections: readonly PackSectionMeasure[];
  readonly items_tokens: number;
  readonly assembled?: {
    readonly total: number;
    readonly by_tier: Readonly<Record<string, number | undefined>>;
    readonly ladder_steps: readonly string[];
  };
  readonly overflow?: string;
}

async function latestArtifact<T>(
  pool: Pool,
  projectId: string,
  kind: string,
  keyPrefix: string,
): Promise<T | undefined> {
  const r = await pool.query<{ payload: T }>(
    `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = $2 AND key LIKE $3
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [projectId, kind, `${keyPrefix}%`],
  );
  return r.rows[0]?.payload;
}

/**
 * Rebuild the pack `role` would receive for chapter `chapterNo` from the stored contract and spec (and, for
 * checker roles, the chapter's latest version), measure each section with the pack's estimator, and try the
 * pinned budget. Requires the chapter's job to exist: inspection never creates one.
 */
export async function inspectPack(
  pool: Pool,
  input: { projectId: string; chapterNo: number; role: string; budget?: number | undefined },
): Promise<PackInspection> {
  if (!(await getJobByWorkflowId(pool, workflowIdFor(input.projectId, input.chapterNo))))
    throw new WorkflowError(
      'INTERNAL',
      `chapter ${input.chapterNo} of project ${input.projectId} has no chapter job yet; nothing to inspect`,
      { step: 'inspect' },
    );
  const { ctx } = await makeContext(
    { pool, gateway: undefined as never },
    input.projectId,
    input.chapterNo,
  );
  const contract = await latestArtifact<ChapterContract>(
    pool,
    input.projectId,
    'chapter_contract',
    `${input.chapterNo}:v`,
  );
  const spec = await latestArtifact<StorySpec>(pool, input.projectId, 'story_spec', 'v');
  if (!contract || !spec)
    throw new WorkflowError(
      'INTERNAL',
      `chapter ${input.chapterNo} has no stored contract or spec`,
      {
        step: 'inspect',
      },
    );
  const version = await pool.query<{ id: string; status: string; text: string }>(
    `SELECT mv.id, mv.status, mv.text FROM manuscript_versions mv JOIN chapters c ON c.id = mv.chapter_id
      WHERE c.project_id = $1 AND c.number = $2 ORDER BY mv.version_no DESC LIMIT 1`,
    [input.projectId, input.chapterNo],
  );
  const checker = input.role !== 'scene_writer' && input.role !== 'chapter_planner';
  const latest = version.rows[0];
  // Checker packs take a draft; an accepted chapter is measured as its text (nothing is stored).
  const chapterText =
    !checker || !latest
      ? undefined
      : latest.status === 'accepted'
        ? { text: latest.text, status: 'approved' as const, label: 'inspection' }
        : { versionId: latest.id };
  const fetched = await fetchContext(pool, {
    projectId: input.projectId,
    role: input.role,
    contract,
    spec,
    policy: ctx.policy,
    identity: ctx.identity,
    promptSetId: ctx.pins.promptSetId,
    ...(chapterText ? { chapterText } : {}),
    budgetTokens: Number.MAX_SAFE_INTEGER,
  });
  const est = estimatorFor(fetched.input.language ?? 'en');
  const bySection = new Map<string, { tier: string; items: number; tokens: number }>();
  for (const it of fetched.input.items) {
    const e = bySection.get(it.section) ?? { tier: it.tier, items: 0, tokens: 0 };
    e.items++;
    e.tokens += est.estimate(it.text);
    bySection.set(it.section, e);
  }
  const sections = [...bySection.entries()]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => b.tokens - a.tokens || (a.name < b.name ? -1 : 1));
  const budget = input.budget ?? budgetFor(fetched.template, ctx.policy.context);
  const base: PackInspection = {
    template: fetched.template.name,
    role: input.role,
    chapter_no: input.chapterNo,
    estimator: est.id,
    budget,
    sections,
    items_tokens: sections.reduce((a, s) => a + s.tokens, 0),
  };
  try {
    const pack = assemblePack(fetched.input, { budgetTokens: budget });
    return {
      ...base,
      assembled: {
        total: pack.manifest.token_counts.total,
        by_tier: pack.manifest.token_counts.by_tier,
        ladder_steps: pack.manifest.degradation?.ladder_steps ?? [],
      },
    };
  } catch (err) {
    return { ...base, overflow: err instanceof Error ? err.message : String(err) };
  }
}

export function renderPackInspection(p: PackInspection): string {
  const lines = [
    `${p.template} for ${p.role}, chapter ${p.chapter_no} — estimator ${p.estimator}, budget ${p.budget ?? 'none'}`,
    ...p.sections.map(
      (s) =>
        `  ${s.tier} ${s.name.padEnd(20)} ${String(s.items).padStart(4)} items ${String(s.tokens).padStart(7)} tokens`,
    ),
    `  items before rendering: ${p.items_tokens} tokens`,
    p.assembled
      ? `  assembled: ${p.assembled.total} tokens (${Object.entries(p.assembled.by_tier)
          .map(([t, n]) => `${t} ${String(n ?? 0)}`)
          .join(', ')}); ladder: ${p.assembled.ladder_steps.join(', ') || 'none'}`
      : `  does not fit: ${p.overflow ?? 'unknown'}`,
  ];
  return lines.join('\n');
}

export interface StoryState {
  readonly project_id: string;
  readonly run_status: string | undefined;
  readonly next_chapter: number | undefined;
  readonly accepted_chapters: number;
  readonly last_accepted?: { readonly chapter_no: number; readonly summary: string } | undefined;
  readonly arc_summaries: readonly { readonly from: number; readonly to: number }[];
  readonly promises: { readonly open: number; readonly overdue: number; readonly paid: number };
  readonly canon_version: number;
}

/** Past any chapter number (Postgres `integer`). */
const ALL_CHAPTERS = 2_147_483_647;

export async function storyState(pool: Pool, projectId: string): Promise<StoryState> {
  const run = await getNovelRun(pool, projectId);
  const l1 = await acceptedSummariesBefore(pool, projectId, ALL_CHAPTERS);
  const l2 = await acceptedArcSummariesBefore(pool, projectId, ALL_CHAPTERS);
  const last = l1[l1.length - 1];
  const lastNo = last?.chapter_no ?? 0;
  const promises = await pool.query<{ open: string; overdue: string; paid: string }>(
    `SELECT count(*) FILTER (WHERE status IN ('open','advanced')) AS open,
            count(*) FILTER (WHERE status IN ('open','advanced') AND due_max_chapter IS NOT NULL
                               AND due_max_chapter < $2) AS overdue,
            count(*) FILTER (WHERE status = 'paid') AS paid
       FROM promises WHERE project_id = $1`,
    [projectId, lastNo + 1],
  );
  const canon = await pool.query<{ canon_version: number }>(
    'SELECT canon_version FROM projects WHERE id = $1',
    [projectId],
  );
  const p = promises.rows[0];
  return {
    project_id: projectId,
    run_status: run?.status,
    next_chapter: run?.next_chapter,
    accepted_chapters: l1.length,
    last_accepted: last ? { chapter_no: last.chapter_no, summary: last.text } : undefined,
    arc_summaries: l2.map((a) => ({ from: a.chapter_from, to: a.chapter_to })),
    promises: {
      open: Number(p?.open ?? 0),
      overdue: Number(p?.overdue ?? 0),
      paid: Number(p?.paid ?? 0),
    },
    canon_version: canon.rows[0]?.canon_version ?? 0,
  };
}

export interface CallRow {
  /** Chapter number for chapter jobs, null for the story plan (spec, concepts, bible). */
  readonly chapter_no: number | null;
  readonly calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms: number;
}

export interface CostProjection {
  readonly chapters_observed: number;
  readonly plan: {
    readonly calls: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  readonly per_chapter: {
    readonly calls: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly model_minutes: number;
  };
  readonly projected: {
    readonly chapters: number;
    readonly calls: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly model_hours: number;
  };
}

/**
 * Project the audit to `chapters` chapters: the story plan once, plus the mean of the observed chapters.
 * Model time is the sum of call latencies (calls within a chapter run one after another in the MVP loop,
 * evaluators up to `max_parallel_evaluators` at once, so wall-clock time is at most this).
 */
export function projectCost(rows: readonly CallRow[], chapters: number): CostProjection {
  const plan = rows.filter((r) => r.chapter_no === null);
  const chs = rows.filter((r) => r.chapter_no !== null);
  const sum = (xs: readonly CallRow[], k: keyof Omit<CallRow, 'chapter_no'>) =>
    xs.reduce((a, r) => a + r[k], 0);
  const n = chs.length;
  const mean = (k: keyof Omit<CallRow, 'chapter_no'>) => (n === 0 ? 0 : sum(chs, k) / n);
  const planCalls = sum(plan, 'calls');
  const planIn = sum(plan, 'input_tokens');
  const planOut = sum(plan, 'output_tokens');
  const round = (x: number) => Math.round(x);
  return {
    chapters_observed: n,
    plan: { calls: planCalls, input_tokens: planIn, output_tokens: planOut },
    per_chapter: {
      calls: round(mean('calls') * 10) / 10,
      input_tokens: round(mean('input_tokens')),
      output_tokens: round(mean('output_tokens')),
      model_minutes: round((mean('latency_ms') / 60_000) * 10) / 10,
    },
    projected: {
      chapters,
      calls: round(planCalls + mean('calls') * chapters),
      input_tokens: round(planIn + mean('input_tokens') * chapters),
      output_tokens: round(planOut + mean('output_tokens') * chapters),
      model_hours:
        round(((sum(plan, 'latency_ms') + mean('latency_ms') * chapters) / 3_600_000) * 10) / 10,
    },
  };
}

/** The audit's calls per chapter (from the call's idempotency key, `chapter:<project>:<n>:…`) and for the plan. */
export async function callRows(pool: Pool, projectId: string): Promise<CallRow[]> {
  const r = await pool.query<{
    chapter_no: number | null;
    calls: string;
    input_tokens: string | null;
    output_tokens: string | null;
    latency_ms: string | null;
  }>(
    `SELECT CASE WHEN idempotency_key LIKE 'chapter:%'
                 THEN split_part(idempotency_key, ':', 3)::int END AS chapter_no,
            count(*) AS calls,
            sum(COALESCE((usage->>'input')::bigint, 0)) AS input_tokens,
            sum(COALESCE((usage->>'output')::bigint, 0)) AS output_tokens,
            sum(COALESCE(latency_ms, 0)) AS latency_ms
       FROM llm_calls
      WHERE project_id = $1
      GROUP BY 1 ORDER BY 1 NULLS FIRST`,
    [projectId],
  );
  return r.rows.map((x) => ({
    chapter_no: x.chapter_no,
    calls: Number(x.calls),
    input_tokens: Number(x.input_tokens ?? 0),
    output_tokens: Number(x.output_tokens ?? 0),
    latency_ms: Number(x.latency_ms ?? 0),
  }));
}

export interface PromptSize {
  readonly family: string;
  readonly version: string;
  readonly system_chars: number;
  readonly user_chars: number;
  readonly est_tokens: number;
  readonly estimator: string;
}

const HANGUL = /[\uac00-\ud7a3]/g;

/** Static size of every active prompt (templates without their variables), largest first. */
export function promptSizes(registry: PromptRegistry): PromptSize[] {
  const set = registry.activeSet();
  return Object.values(set.mapping)
    .map((id) => {
      const pv = registry.get(id);
      const text = `${pv.system_template}\n${pv.user_template}`;
      const korean = (text.match(HANGUL)?.length ?? 0) > text.length / 10;
      const est = estimatorFor(korean ? 'ko' : 'en');
      return {
        family: pv.family,
        version: pv.version,
        system_chars: Array.from(pv.system_template).length,
        user_chars: Array.from(pv.user_template).length,
        est_tokens: est.estimate(text),
        estimator: est.id,
      };
    })
    .sort((a, b) => b.est_tokens - a.est_tokens || (a.family < b.family ? -1 : 1));
}
