/**
 * A minimal EPUB reader for the operator corpus (ADR-0082): ZIP central directory, the OPF spine, and each
 * spine document's heading and paragraphs. No dependency: stored and deflated entries only (what EPUB
 * writers produce), no ZIP64 (EPUB files are far below 4 GiB). Paragraph text is kept exactly — quotes,
 * brackets, ellipses and status-window lines — only markup and entities are removed.
 */
import { inflateRawSync } from 'node:zlib';

export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('EPUB_INVALID: no ZIP end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50)
      throw new Error('EPUB_INVALID: corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const compressed = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`EPUB_INVALID: unsupported ZIP method ${String(method)} for ${name}`);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Text of an XHTML fragment: tags removed (line breaks kept), entities decoded, NBSP as space. */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(
    /\u00a0/g,
    ' ',
  );
}

export interface EpubDocument {
  readonly idref: string;
  readonly href: string;
  readonly title: string;
  /** One entry per source paragraph; a whitespace-only paragraph is ''. */
  readonly paragraphs: readonly string[];
}

export interface EpubBook {
  readonly title: string;
  readonly creator?: string | undefined;
  readonly language?: string | undefined;
  readonly subjects: readonly string[];
  readonly description?: string | undefined;
  readonly documents: readonly EpubDocument[];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

function resolve(base: string, href: string): string {
  const parts = `${base}${decodeURIComponent(href)}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

export function readEpub(buf: Buffer): EpubBook {
  const zip = readZipEntries(buf);
  const utf8 = (name: string) => {
    const b = zip.get(name);
    if (!b) throw new Error(`EPUB_INVALID: missing ${name}`);
    return b.toString('utf8');
  };
  const container = utf8('META-INF/container.xml');
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error('EPUB_INVALID: container names no package document');
  const opf = utf8(opfPath);
  const base = dirOf(opfPath);
  const meta = (tag: string) => {
    const m = new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)</dc:${tag}>`).exec(opf);
    return m?.[1] !== undefined ? textOf(m[1]).trim() : undefined;
  };
  const subjects = [...opf.matchAll(/<dc:subject[^>]*>([\s\S]*?)<\/dc:subject>/g)].map((m) =>
    textOf(m[1] ?? '').trim(),
  );
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = attr(m[0], 'id');
    const href = attr(m[0], 'href');
    if (id !== undefined && href !== undefined) manifest.set(id, href);
  }
  const documents: EpubDocument[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*>/g)) {
    const idref = attr(m[0], 'idref');
    const href = idref === undefined ? undefined : manifest.get(idref);
    if (idref === undefined || href === undefined) continue;
    const path = resolve(base, href);
    const raw = zip.get(path)?.toString('utf8');
    if (raw === undefined) continue;
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(raw);
    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
    const title = textOf(h1?.[1] ?? titleTag?.[1] ?? '').trim();
    const body = h1 ? raw.slice(h1.index + h1[0].length) : raw;
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((p) => {
      const t = textOf(p[1] ?? '');
      return t.trim() === '' ? '' : t.replace(/\s+$/u, '');
    });
    documents.push({ idref, href, title, paragraphs });
  }
  return {
    title: meta('title') ?? '',
    creator: meta('creator'),
    language: meta('language'),
    subjects,
    description: meta('description'),
    documents,
  };
}
