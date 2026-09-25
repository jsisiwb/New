import { describe, expect, it } from 'vitest';
import {
  buildBlindPacket,
  decodeKey,
  encodeKey,
  normalizePacketText,
  pickOperatorMatches,
  type OperatorChapter,
} from './blind-packet.js';

describe('blinded packet (N3)', () => {
  it('normalizes layout the same way for both sources', () => {
    expect(normalizePacketText('첫 줄.\n두 번째 줄.\n\n\n* * *\n\n  셋째 줄.  \n─────\n')).toBe(
      '첫 줄.\n\n두 번째 줄.\n\n셋째 줄.',
    );
    // Dialogue and status-window lines are text, not layout.
    expect(normalizePacketText('“왔어?”\n[레벨: 1]')).toBe('“왔어?”\n\n[레벨: 1]');
  });

  const ch = (book: string, ordinal: number, pov: OperatorChapter['pov']): OperatorChapter => ({
    id: `${book}-${String(ordinal)}`,
    book,
    ordinal,
    pov,
    text: `${book} ${String(ordinal)}.`,
  });
  const chapters = [
    ch('a', 1, 'first'),
    ch('a', 2, 'third'),
    ch('a', 3, 'first'),
    ch('b', 1, 'third'),
    ch('b', 2, 'first'),
    ch('b', 3, 'first'),
  ];

  it('matches each position with the same point of view, never twice, from both books', () => {
    const picked = pickOperatorMatches(
      [1, 2, 3].map((position) => ({ position, pov: 'first' as const })),
      chapters,
      'seed',
    );
    expect(picked).toHaveLength(3);
    expect(picked.every((c) => c.pov === 'first')).toBe(true);
    expect(new Set(picked.map((c) => c.id)).size).toBe(3);
    expect(new Set(picked.map((c) => c.book)).size).toBe(2);
    expect(picked.every((c, i) => Math.abs(c.ordinal - (i + 1)) <= 2)).toBe(true);
    expect(pickOperatorMatches([{ position: 1, pov: 'first' }], chapters, 'seed')).toEqual(
      picked.slice(0, 1),
    );
  });

  it('shuffles by seed, shows no labels, and keeps the key checkable', () => {
    const sources = [
      {
        origin: 'pipeline' as const,
        label: 'pipeline: project-x 화 1 v3',
        position: 1,
        text: '문이 열렸다.',
      },
      {
        origin: 'operator' as const,
        label: 'operator: book-a chapter 1',
        position: 1,
        text: '바람이 불었다.',
      },
      {
        origin: 'pipeline' as const,
        label: 'pipeline: project-x 화 2 v2',
        position: 2,
        text: '종이 울렸다.',
      },
    ];
    const one = buildBlindPacket(sources, 'seed-1');
    expect(buildBlindPacket(sources, 'seed-1')).toEqual(one);
    expect(one.packet).not.toMatch(/pipeline|operator|project-x|book-a|화 1/u);
    expect(one.packet).toContain('## A');
    expect(one.packet).toContain('| C | | | | |');
    expect(one.key.items.map((i) => i.item)).toEqual(['A', 'B', 'C']);
    expect(new Set(one.key.items.map((i) => i.label))).toEqual(
      new Set(sources.map((s) => s.label)),
    );
    const encoded = encodeKey(one.key);
    expect(encoded).not.toContain('pipeline');
    expect(decodeKey(encoded, one.manifest)).toEqual(one.key);
    expect(() => decodeKey(encodeKey({ ...one.key, seed: 'other' }), one.manifest)).toThrow(
      /does not match/,
    );
    const orders = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) =>
        buildBlindPacket(sources, s)
          .key.items.map((i) => i.label)
          .join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });
});
