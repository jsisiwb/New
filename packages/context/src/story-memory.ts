/**
 * The story-so-far items (ADR-0061, ADR-0076), as a pure function of accepted summaries so the long-story
 * behaviour can be measured without a database (the 200-화 simulation in `story-memory.test.ts`).
 *
 * - Without `memory`: every accepted L1 summary before the previous chapter, in blocks of ten chapters,
 *   newest block ranked first — ADR-0061's digest, unchanged byte for byte.
 * - With `memory` (ADR-0076): the chapters of an arc summary (L2) that ends before the last
 *   `recentChapters` accepted chapters are represented by that one L2 item; every other chapter keeps its L1
 *   line in its block of ten. L2 items rank above L1 blocks of the same age, so a tight budget sheds old
 *   chapter detail before it sheds whole arcs.
 *
 * Deterministic: accepted summaries only, never a model call and never a draft.
 */
import { type AcceptedSummaryRow, type ArcSummaryRow } from '@yeonjae/db';
import { type Item, type Tier } from './types.js';

/** Chapters per story-so-far block. */
export const DIGEST_BLOCK = 10;

export interface StorySoFarInput {
  readonly l1: readonly AcceptedSummaryRow[];
  readonly l2?: readonly ArcSummaryRow[] | undefined;
  readonly lang: 'en' | 'ko';
  readonly section: { readonly name: string; readonly tier: Tier };
  readonly canonVersion: number;
  readonly projectId: string;
  /** The chapter before the one being written; its own summary travels in the previous-chapter section. */
  readonly previousChapterNo: number;
  readonly memory?: { readonly recentChapters: number } | undefined;
}

export function storySoFarItems(input: StorySoFarInput): Item[] {
  const { l1, lang, section } = input;
  const ko = lang === 'ko';
  const out: Item[] = [];
  // ADR-0076: arcs wholly older than the recent window are one L2 item each.
  const covered = new Set<number>();
  const arcs: ArcSummaryRow[] = [];
  if (input.memory) {
    const windowStart = input.previousChapterNo - input.memory.recentChapters;
    for (const a of input.l2 ?? []) {
      if (a.chapter_to >= windowStart) continue;
      if (arcs.some((b) => a.chapter_from <= b.chapter_to && b.chapter_from <= a.chapter_to))
        continue;
      arcs.push(a);
      for (let n = a.chapter_from; n <= a.chapter_to; n++) covered.add(n);
    }
  }
  const rows = l1.filter((r) => !covered.has(r.chapter_no));
  if (rows.length === 0 && arcs.length === 0) return out;
  const blocks = new Map<number, AcceptedSummaryRow[]>();
  for (const r of rows) {
    const b = Math.floor((r.chapter_no - 1) / DIGEST_BLOCK);
    blocks.set(b, [...(blocks.get(b) ?? []), r]);
  }
  const newest = blocks.size > 0 ? Math.max(...blocks.keys()) : 0;
  for (const [b, block] of blocks) {
    const from = block[0]?.chapter_no ?? 0;
    const to = block[block.length - 1]?.chapter_no ?? 0;
    const lines = block.map((r) =>
      ko ? `${r.chapter_no}화: ${r.text}` : `Ch.${r.chapter_no}: ${r.text}`,
    );
    out.push({
      kind: 'summary',
      id: `story_so_far:${from}-${to}`,
      section: section.name,
      tier: section.tier,
      provenance: 'summary',
      source: {
        kind: 'summary',
        ref: block.map((r) => r.summary_id).join(','),
        version: `L1-digest@canon${input.canonVersion}`,
        project_id: input.projectId,
      },
      text: `${ko ? `${from}~${to}화` : `Chapters ${from}–${to}`}\n${lines.join('\n')}`,
      materiality: 'contextual',
      signals: { recency: newest === 0 ? 1 : b / newest, entity_overlap: 0, importance: 0.5 },
      dedupeKey: `story_so_far:${from}-${to}`,
    });
  }
  const last = Math.max(1, input.previousChapterNo);
  for (const a of arcs) {
    const id = `story_so_far:arc:${a.chapter_from}-${a.chapter_to}`;
    out.push({
      kind: 'summary',
      id,
      section: section.name,
      tier: section.tier,
      provenance: 'summary',
      source: {
        kind: 'summary',
        ref: a.summary_id,
        version: `L2@canon${input.canonVersion}`,
        project_id: input.projectId,
      },
      text: `${
        ko
          ? `${a.chapter_from}~${a.chapter_to}화 아크 요약`
          : `Chapters ${a.chapter_from}–${a.chapter_to} (arc summary)`
      }\n${a.text}`,
      materiality: 'contextual',
      signals: { recency: a.chapter_to / last, entity_overlap: 0, importance: 0.8 },
      dedupeKey: id,
    });
  }
  return out;
}
