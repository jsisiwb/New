/**
 * The blinded packet (the operator's plan, N3): accepted pipeline chapters mixed with the operator's own chapters at
 * similar positions, with no metadata, and a separate answer key. The operator reads the packet before the key.
 *
 * Both sources are normalized the same way — paragraphs separated by one blank line, symbol-only lines (scene
 * breaks) dropped, no titles — so layout does not give a chapter away. Character names are not masked: the operator
 * may recognize their own cast. The key is written base64-encoded, with its hash in the manifest, so browsing the
 * pull request does not spoil the reading and the key cannot be changed afterwards unnoticed.
 */
import { createHash } from 'node:crypto';

export type PacketOrigin = 'pipeline' | 'operator';

export interface PacketSource {
  readonly origin: PacketOrigin;
  /** Answer-key label: which project and 화, or which book and chapter. Never shown in the packet. */
  readonly label: string;
  /** The 화 position the chapter stands at. */
  readonly position: number;
  readonly text: string;
}

export interface OperatorChapter {
  readonly id: string;
  readonly book: string;
  /** 1-based order of the chapter among the book's chapters. */
  readonly ordinal: number;
  readonly pov: 'first' | 'third' | 'mixed' | null;
  readonly text: string;
}

export interface BlindPacket {
  readonly packet: string;
  readonly key: {
    readonly seed: string;
    readonly items: readonly {
      readonly item: string;
      readonly origin: PacketOrigin;
      readonly label: string;
      readonly position: number;
      readonly sha256: string;
    }[];
  };
  readonly manifest: {
    readonly seed: string;
    readonly items: number;
    readonly packet_sha256: string;
    readonly key_sha256: string;
  };
}

const SYMBOL_LINE = /^[\s*·•◇◆○●□■─—\-=~#_+.]+$/u;

/** One paragraph per block, blank line between; symbol-only lines (scene breaks) dropped. */
export function normalizePacketText(text: string): string {
  return text
    .normalize('NFC')
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !SYMBOL_LINE.test(l))
    .join('\n\n');
}

/** A seeded generator (mulberry32 over the seed's hash): the same seed gives the same packet. */
function random(seed: string): () => number {
  let a = createHash('sha256').update(seed, 'utf8').digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * For each pipeline chapter, the operator chapter at the same position (within `window` either side), preferring the
 * same point of view, alternating books, never using one chapter twice.
 */
export function pickOperatorMatches(
  wanted: readonly { readonly position: number; readonly pov: 'first' | 'third' | null }[],
  chapters: readonly OperatorChapter[],
  seed: string,
  window = 2,
): OperatorChapter[] {
  const books = [...new Set(chapters.map((c) => c.book))].sort();
  const rnd = random(`${seed}:books`);
  let turn = Math.floor(rnd() * Math.max(1, books.length));
  const used = new Set<string>();
  const out: OperatorChapter[] = [];
  for (const w of wanted) {
    const order = books.map((_, i) => books[(turn + i) % books.length] ?? '');
    turn += 1;
    const pick =
      order
        .map(
          (book) =>
            chapters
              .filter((c) => c.book === book && !used.has(c.id))
              .filter((c) => Math.abs(c.ordinal - w.position) <= window)
              .sort(
                (a, b) =>
                  Number(b.pov === w.pov) - Number(a.pov === w.pov) ||
                  Math.abs(a.ordinal - w.position) - Math.abs(b.ordinal - w.position) ||
                  a.ordinal - b.ordinal,
              )[0],
        )
        .filter((c): c is OperatorChapter => c !== undefined)
        .sort((a, b) => Number(b.pov === w.pov) - Number(a.pov === w.pov))[0] ?? undefined;
    if (!pick) continue;
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Items shuffled by the seed and lettered; the packet shows the letters and the normalized text only. */
export function buildBlindPacket(sources: readonly PacketSource[], seed: string): BlindPacket {
  const rnd = random(`${seed}:order`);
  const shuffled = sources
    .map((s) => ({ s, r: rnd() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.s);
  const letter = (i: number) =>
    i < 26
      ? String.fromCharCode(65 + i)
      : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`;
  const items = shuffled.map((s, i) => {
    const text = normalizePacketText(s.text);
    return {
      item: letter(i),
      origin: s.origin,
      label: s.label,
      position: s.position,
      text,
      sha256: sha256(text),
    };
  });
  const packet = [
    '# Blinded reading packet',
    '',
    `${String(items.length)} chapters in random order. Some are yours; some the studio wrote. Titles, chapter numbers and`,
    'layout were removed from all of them the same way (one blank line between paragraphs, no scene-break marks).',
    'Names are not masked. Read every chapter, fill in the sheet at the end, and only then open the answer key',
    '(`pnpm cli corpus:reveal --dir=<this folder>`).',
    '',
    ...items.flatMap((it) => [`## ${it.item}`, '', it.text, '']),
    '## Reading sheet',
    '',
    '| Item | Yours? (yes / no) | Confidence (1–5) | Would you keep reading? (yes / no) | What gave it away |',
    '| --- | --- | --- | --- | --- |',
    ...items.map((it) => `| ${it.item} | | | | |`),
    '',
  ].join('\n');
  const key = {
    seed,
    items: items.map(({ item, origin, label, position, sha256: h }) => ({
      item,
      origin,
      label,
      position,
      sha256: h,
    })),
  };
  return {
    packet,
    key,
    manifest: {
      seed,
      items: items.length,
      packet_sha256: sha256(packet),
      key_sha256: sha256(JSON.stringify(key)),
    },
  };
}

export function encodeKey(key: BlindPacket['key']): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64');
}

/** The key, checked against the manifest's hash. */
export function decodeKey(
  encoded: string,
  manifest: { readonly key_sha256: string },
): BlindPacket['key'] {
  const json = Buffer.from(encoded.trim(), 'base64').toString('utf8');
  if (sha256(json) !== manifest.key_sha256)
    throw new Error('answer key does not match the manifest');
  return JSON.parse(json) as BlindPacket['key'];
}
