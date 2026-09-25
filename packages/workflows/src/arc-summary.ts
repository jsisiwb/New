/**
 * Arc summaries (L2) for hierarchical story memory (ADR-0076). When a chapter's arc starts, every earlier
 * scheduled arc whose chapters are all accepted gets one arc summary, written by the `arc_summarizer` role
 * from the accepted L1 summaries of its chapters and the last chapter's ending hook. The first stored summary
 * of a range wins (`insertArcSummaryOnce`), so later chapter jobs read it instead of calling the model again;
 * within the job that writes it the step is checkpointed like any other.
 *
 * Only accepted material goes in (L1 summaries are made from accepted versions only) and the summary is
 * read back only while every chapter it covers is accepted (`acceptedArcSummariesBefore`).
 */
import {
  acceptedArcSummariesBefore,
  acceptedChapter,
  acceptedSummariesBefore,
  insertArcSummaryOnce,
  l1SummaryFor,
} from '@yeonjae/db';
import { codePointLength, sliceCodePoints, toNfcText } from '@yeonjae/prose';
import { WorkflowError } from './errors.js';
import { modelCall, runStep, saveArtifact, type WorkflowContext } from './runtime.js';

export interface ArcRange {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly ordinal?: number | undefined;
  readonly arcInSeason?: number | undefined;
}

export interface ArcSummaryResult {
  readonly summary_id: string;
  readonly chapter_from: number;
  readonly chapter_to: number;
  readonly text: string;
  /** True when this job wrote the summary; false when an earlier job had. */
  readonly created: boolean;
  readonly truncated: boolean;
}

/** Cut at the last sentence end within `max` code points (a summary is derived data, never manuscript). */
export function clampSummary(text: string, max: number): { text: string; truncated: boolean } {
  if (codePointLength(text) <= max) return { text, truncated: false };
  const head = sliceCodePoints(text, 0, max);
  const end = Math.max(...['.', '!', '?', '…', '。'].map((p) => head.lastIndexOf(p)));
  return { text: (end > 0 ? head.slice(0, end + 1) : head).trim(), truncated: true };
}

/**
 * Summarize `arc` if every chapter in it is accepted and no summary of the range exists yet. Returns the
 * summary (new or existing), or undefined when the arc is not fully accepted.
 */
export async function ensureArcSummary(
  ctx: WorkflowContext,
  arc: ArcRange,
): Promise<ArcSummaryResult | undefined> {
  const memory = ctx.policy.context.story_memory;
  if (!memory?.arc_summaries) return undefined;
  const stored = (await acceptedArcSummariesBefore(ctx.pool, ctx.projectId, arc.to + 1)).find(
    (s) => s.chapter_from === arc.from && s.chapter_to === arc.to,
  );
  if (stored) return { ...stored, created: false, truncated: false };
  const l1 = (await acceptedSummariesBefore(ctx.pool, ctx.projectId, arc.to + 1)).filter(
    (r) => r.chapter_no >= arc.from,
  );
  if (l1.length !== arc.to - arc.from + 1) return undefined;
  return runStep(
    ctx,
    'arc_summary',
    async () => {
      const ko = ctx.identity.outputLanguage.language === 'ko';
      const last = await acceptedChapter(ctx.pool, ctx.projectId, arc.to);
      const hook =
        last.state === 'accepted'
          ? ((await l1SummaryFor(ctx.pool, last.chapter.version.id))?.ending_hook ?? undefined)
          : undefined;
      const label = ko
        ? `${arc.ordinal !== undefined ? `${arc.ordinal}시즌 ` : ''}${arc.arcInSeason !== undefined ? `${arc.arcInSeason}번째 아크, ` : ''}${arc.from}~${arc.to}화`
        : `${arc.ordinal !== undefined ? `Season ${arc.ordinal}, ` : ''}${arc.arcInSeason !== undefined ? `arc ${arc.arcInSeason}, ` : ''}chapters ${arc.from}–${arc.to}`;
      const call = await modelCall<{ summary_l2?: string }>(ctx, {
        step: 'arc_summary',
        family: 'arc_summarizer',
        activityId: `arc_summary:${arc.from}-${arc.to}`,
        variables: {
          arc_label: label,
          chapter_summaries: l1
            .map((r) => (ko ? `${r.chapter_no}화: ${r.text}` : `Ch.${r.chapter_no}: ${r.text}`))
            .join('\n'),
          ending_hook: hook ?? (ko ? '(기록 없음)' : '(none recorded)'),
          max_chars: String(memory.l2_max_chars),
        },
      });
      const raw = toNfcText(call.output.summary_l2 ?? '').text.trim();
      if (!raw)
        throw new WorkflowError('SUMMARY_INVALID', 'the arc summarizer returned no summary_l2', {
          step: 'arc_summary',
          recommendedActions: ['regenerate'],
        });
      const clamped = clampSummary(raw, memory.l2_max_chars);
      const row = await insertArcSummaryOnce(ctx.pool, {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        chapterFrom: arc.from,
        chapterTo: arc.to,
        text: clamped.text,
        canonVersion: last.state === 'accepted' ? last.chapter.acceptedCanonVersion : 0,
        promptVersionId: ctx.promptSet.mapping.arc_summarizer,
      });
      await saveArtifact(ctx, {
        step: 'arc_summary',
        kind: 'arc_summary',
        key: `${arc.from}-${arc.to}`,
        payload: {
          arc_id: arc.id,
          chapter_from: arc.from,
          chapter_to: arc.to,
          summary_id: row.summary_id,
          text: row.text,
          truncated: clamped.truncated,
          source_summary_ids: l1.map((r) => r.summary_id),
        },
      });
      const result: ArcSummaryResult = {
        summary_id: row.summary_id,
        chapter_from: row.chapter_from,
        chapter_to: row.chapter_to,
        text: row.text,
        created: row.created,
        truncated: clamped.truncated,
      };
      return result;
    },
    `${arc.from}-${arc.to}`,
  );
}
