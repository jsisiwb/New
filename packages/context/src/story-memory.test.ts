import { describe, expect, it } from 'vitest';
import { estimateTokensKo } from '@yeonjae/prose';
import { storySoFarItems, type StorySoFarInput } from './story-memory.js';

const SECTION = { name: 'story_so_far', tier: 'T2' as const };

// Synthetic filler of about 400자 (the Korean L1 prompt's length), not manuscript prose.
const l1Text = (n: number) => `${n}화 요약 문장. ${'가나다라마바사 '.repeat(48).trim()}.`;
const l2Text = (from: number, to: number) =>
  `${from}~${to}화 아크 요약 문장. ${'아자차카타파하 '.repeat(60).trim()}.`;

function rows(prev: number) {
  const l1 = Array.from({ length: prev - 1 }, (_, i) => ({
    chapter_no: i + 1,
    summary_id: `s${i + 1}`,
    text: l1Text(i + 1),
  }));
  // Arcs of ten chapters (ARC_WINDOW), summarized once every chapter of the arc is accepted.
  const l2 = [];
  for (let from = 1; from + 9 < prev; from += 10)
    l2.push({
      summary_id: `a${from}`,
      chapter_from: from,
      chapter_to: from + 9,
      text: l2Text(from, from + 9),
    });
  return { l1, l2 };
}

function input(prev: number, memory?: StorySoFarInput['memory']): StorySoFarInput {
  return {
    ...rows(prev),
    lang: 'ko',
    section: SECTION,
    canonVersion: 7,
    projectId: 'p',
    previousChapterNo: prev,
    memory,
  };
}

const tokens = (items: readonly { text: string }[]) =>
  items.reduce((a, i) => a + estimateTokensKo(i.text), 0);

describe('story memory (ADR-0061, ADR-0076)', () => {
  it('without story_memory: every L1 summary in blocks of ten, ADR-0061 unchanged', () => {
    const items = storySoFarItems({ ...input(26), l2: undefined });
    expect(items.map((i) => i.id)).toEqual([
      'story_so_far:1-10',
      'story_so_far:11-20',
      'story_so_far:21-25',
    ]);
    expect(items[0]?.text.startsWith(`1~10화\n1화: ${l1Text(1)}\n2화: `)).toBe(true);
    expect(items[0]?.source).toEqual({
      kind: 'summary',
      ref: 's1,s2,s3,s4,s5,s6,s7,s8,s9,s10',
      version: 'L1-digest@canon7',
      project_id: 'p',
    });
    expect(items.map((i) => i.signals?.recency)).toEqual([0, 0.5, 1]);
    // L2 rows are ignored without the policy block.
    expect(storySoFarItems(input(26))).toEqual(items);
  });

  it('with story_memory: arcs older than the recent window are one L2 item each', () => {
    const items = storySoFarItems(input(200, { recentChapters: 20 }));
    const arcs = items.filter((i) => i.id.startsWith('story_so_far:arc:'));
    const blocks = items.filter((i) => !i.id.startsWith('story_so_far:arc:'));
    // Window starts at chapter 180: arcs 1–10 … 161–170 are summarized; 171–180 ends inside the window.
    expect(arcs.map((i) => i.id)).toEqual(
      Array.from({ length: 17 }, (_, k) => `story_so_far:arc:${k * 10 + 1}-${k * 10 + 10}`),
    );
    expect(blocks.map((i) => i.id)).toEqual([
      'story_so_far:171-180',
      'story_so_far:181-190',
      'story_so_far:191-199',
    ]);
    expect(arcs[0]?.text).toBe(`1~10화 아크 요약\n${l2Text(1, 10)}`);
    expect(arcs[0]?.source).toMatchObject({ ref: 'a1', version: 'L2@canon7' });
    // Arcs outrank the chapter detail of the same age when the budget sheds T2.
    expect(arcs.every((a) => (a.signals?.importance ?? 0) > 0.5)).toBe(true);
  });

  it('represents every chapter before the previous one exactly once', () => {
    for (const prev of [12, 35, 99, 200]) {
      const seen = new Map<number, number>();
      for (const i of storySoFarItems(input(prev, { recentChapters: 20 }))) {
        const arc = /^story_so_far:arc:(\d+)-(\d+)$/.exec(i.id);
        const chapters = arc
          ? Array.from(
              { length: Number(arc[2]) - Number(arc[1]) + 1 },
              (_, k) => Number(arc[1]) + k,
            )
          : [...i.text.matchAll(/^(\d+)화: /gm)].map((m) => Number(m[1]));
        for (const c of chapters) seen.set(c, (seen.get(c) ?? 0) + 1);
      }
      expect(
        [...seen.keys()].sort((a, b) => a - b),
        `prev ${prev}`,
      ).toEqual(Array.from({ length: prev - 1 }, (_, k) => k + 1));
      expect(
        [...seen.values()].every((v) => v === 1),
        `prev ${prev}`,
      ).toBe(true);
    }
  });

  it('an arc summary that overlaps the recent window or another arc is not used', () => {
    const base = input(60, { recentChapters: 20 });
    const items = storySoFarItems({
      ...base,
      l2: [
        ...(base.l2 ?? []),
        { summary_id: 'dup', chapter_from: 5, chapter_to: 14, text: 'x' },
        { summary_id: 'late', chapter_from: 35, chapter_to: 44, text: 'y' },
      ],
    });
    expect(items.some((i) => i.source.ref === 'dup' || i.source.ref === 'late')).toBe(false);
  });

  it('200-화 simulation: the story so far stays bounded while every arc is represented', () => {
    const report = [50, 100, 150, 200].map((prev) => ({
      prev,
      flat: tokens(storySoFarItems(input(prev))),
      hierarchical: tokens(storySoFarItems(input(prev, { recentChapters: 20 }))),
    }));
    // The flat digest grows with every chapter (≈ 400자 each); at 200화 it alone exceeds the whole
    // standard.v8 writer budget (36,000), so the ladder sheds most of the serial.
    const at200 = report[report.length - 1];
    expect(at200?.flat).toBeGreaterThan(36_000);
    // The hierarchical digest: ≤ 30 chapters of L1 detail plus ≈ 500자 per older arc.
    for (const r of report) expect(r.hierarchical, `prev ${r.prev}`).toBeLessThan(22_000);
    expect(at200?.hierarchical).toBeLessThan((at200?.flat ?? 0) / 3);
    // Growth past the window is per arc, not per chapter: +10 chapters add one arc (~500자), not 4,000.
    const h = (prev: number) => tokens(storySoFarItems(input(prev, { recentChapters: 20 })));
    expect(h(200) - h(190)).toBeLessThan(1_000);
  });
});
