/**
 * The operator corpus (ADR-0082): manifest parsing, title matching, chapter classification, language and
 * point-of-view inference, and the per-chapter text layout. Pure functions; the importer (CLI + db) stores
 * the result. Nothing here writes or changes a sentence of the corpus.
 */
import { readEpub, type EpubBook } from './epub.js';

export interface ManifestEntry {
  readonly title: string;
  readonly tags: readonly string[];
}

/**
 * `Manifest.csv` is not a CSV: each book is a title line followed by hashtag lines (`#판타지`), books
 * separated by blank lines; lines may carry leading spaces.
 */
export function parseManifest(text: string): ManifestEntry[] {
  const out: { title: string; tags: string[] }[] = [];
  let current: { title: string; tags: string[] } | undefined;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') {
      current = undefined;
      continue;
    }
    if (line.startsWith('#')) {
      const tags = line
        .split(/\s+/)
        .map((t) => t.replace(/^#+/, '').trim())
        .filter((t) => t.length > 0);
      if (!current) {
        current = { title: '', tags: [] };
        out.push(current);
      }
      current.tags.push(...tags);
      continue;
    }
    current = { title: line, tags: [] };
    out.push(current);
  }
  return out.filter((e) => e.title !== '');
}

/** The leading `[number]` of a file name: a store/work id, kept as metadata. */
export function storeIdOf(fileName: string): string | undefined {
  return /^\s*\[(\d+)\]/.exec(fileName)?.[1];
}

/** A title reduced for matching: NFC, bracketed ids and the extension removed, punctuation and spaces dropped. */
export function titleKey(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\.epub$/i, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .toLowerCase();
}

export type CorpusChapterKind =
  'prologue' | 'chapter' | 'side' | 'epilogue' | 'afterword' | 'notice';

/** Classify a spine document by its heading and file name; `skip` for cover and info pages. */
export function classifyDocument(title: string, href: string): CorpusChapterKind | 'skip' {
  const h = href.toLowerCase();
  if (/cover|(^|\/)info\./.test(h)) return 'skip';
  // A numbered heading is a chapter of the main story, whatever its words ("111. 에필로그" closes an arc).
  if (/^\d+\s*\./.test(title.trim()) && !h.includes('notice')) return 'chapter';
  if (
    h.includes('notice') ||
    /^notice\s*:/i.test(title) ||
    /^(공지|new work announcement|신작)/i.test(title)
  )
    return 'notice';
  if (/^(외전|side\s*\.|bonus\s*\.|특별편)/i.test(title)) return 'side';
  if (/(^|\s)(완결\s*)?후기$|^afterword$|^작가의 말/i.test(title.trim())) return 'afterword';
  if (/그 이후의 이야기|에필로그|^epilogue/i.test(title)) return 'epilogue';
  return 'chapter';
}

export function hangulShare(text: string): number {
  const h = (text.match(/[\uac00-\ud7a3]/g) ?? []).length;
  const l = (text.match(/[A-Za-z]/g) ?? []).length;
  return h + l === 0 ? 0 : h / (h + l);
}

export function textLanguage(text: string): 'ko' | 'en' | 'mixed' {
  const s = hangulShare(text);
  return s >= 0.9 ? 'ko' : s <= 0.1 ? 'en' : 'mixed';
}

const FIRST_PERSON = /(?<![가-힣])(나는|내가|나를|나의|나에게|내게|나도|나만|나한테|나와|내\s)/gu;
const THIRD_PERSON =
  /(?<![가-힣])(그는|그가|그를|그의|그에게|그녀는|그녀가|그녀를|그녀의|그녀에게)(?![가-힣])/gu;

/** Narration lines only: dialogue (“…”, "…") and bracketed lines are left out. */
export function narrationOf(text: string): string {
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return t !== '' && !/^[“"「『[<(]/.test(t);
    })
    .join('\n');
}

export interface PovEvidence {
  readonly first_per_1k: number;
  readonly third_per_1k: number;
  readonly narration_chars: number;
}

export function povEvidence(text: string): PovEvidence {
  const n = narrationOf(text);
  const chars = n.replace(/\s/g, '').length;
  const per1k = (re: RegExp) => (chars === 0 ? 0 : ((n.match(re) ?? []).length * 1000) / chars);
  return {
    first_per_1k: Math.round(per1k(FIRST_PERSON) * 100) / 100,
    third_per_1k: Math.round(per1k(THIRD_PERSON) * 100) / 100,
    narration_chars: chars,
  };
}

/**
 * First person when first-person markers dominate the narration, third when they are nearly absent, mixed
 * otherwise (a first-person narrator with third-person cutaways). Inferred, never given by the source.
 */
export function inferPov(e: PovEvidence): 'first' | 'third' | 'mixed' {
  if (e.first_per_1k >= 3 && e.first_per_1k >= 2 * e.third_per_1k) return 'first';
  if (e.first_per_1k < 1) return 'third';
  return 'mixed';
}

export interface CorpusChapter {
  readonly spine_index: number;
  readonly kind: CorpusChapterKind;
  readonly position?: number | undefined;
  readonly number?: number | undefined;
  readonly title: string;
  readonly text: string;
  readonly chars_with_spaces: number;
  readonly chars_without_spaces: number;
  readonly paragraph_count: number;
  readonly pov?: 'first' | 'third' | 'mixed' | undefined;
  readonly source_href: string;
}

export interface CorpusBook {
  readonly title: string;
  readonly title_key: string;
  readonly author?: string | undefined;
  readonly status?: string | undefined;
  readonly synopsis?: string | undefined;
  readonly subjects: readonly string[];
  readonly text_language: 'ko' | 'en' | 'mixed';
  readonly is_translation: boolean;
  readonly voice_eligible: boolean;
  readonly pov?: 'first' | 'third' | 'mixed' | undefined;
  readonly pov_evidence: PovEvidence & { readonly chapter_povs: Readonly<Record<string, number>> };
  readonly chapters: readonly CorpusChapter[];
}

/** A chapter's stored text: one source paragraph per line, blank source paragraphs kept as blank lines. */
export function chapterText(paragraphs: readonly string[], title: string): string {
  const lines = [...paragraphs];
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  // A heading repeated as the first paragraph is not body text.
  if (lines.length > 0 && (lines[0] ?? '').trim() === title.trim()) lines.shift();
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  const collapsed: string[] = [];
  for (const l of lines)
    if (!(l === '' && collapsed[collapsed.length - 1] === '')) collapsed.push(l);
  return collapsed.join('\n').normalize('NFC');
}

export function corpusBookFrom(epub: EpubBook, fileName: string): CorpusBook {
  const docs = epub.documents.map((d, i) => ({ d, i, kind: classifyDocument(d.title, d.href) }));
  const story = docs.filter((x) => x.kind !== 'skip' && x.kind !== 'notice');
  const numbered = story.filter((x) => /^\d+\s*\./.test(x.d.title)).length;
  let position = 0;
  const chapters: CorpusChapter[] = [];
  for (const x of docs) {
    if (x.kind === 'skip') continue;
    const number = /^(\d+)\s*\./.exec(x.d.title)?.[1];
    let kind: CorpusChapterKind = x.kind;
    // An unnumbered chapter before numbered ones is a prologue.
    if (kind === 'chapter' && numbered > 0 && number === undefined && position === 0)
      kind = 'prologue';
    const main = kind === 'chapter' || kind === 'prologue';
    if (main) position += 1;
    const text = chapterText(x.d.paragraphs, x.d.title);
    const nonEmpty = text.split('\n').filter((l) => l.trim() !== '');
    const inferred = main ? inferPov(povEvidence(text)) : undefined;
    chapters.push({
      spine_index: x.i + 1,
      kind,
      ...(main ? { position } : {}),
      ...(number !== undefined ? { number: Number(number) } : {}),
      title: x.d.title,
      text,
      chars_with_spaces: text.replace(/\n/g, '').length,
      chars_without_spaces: text.replace(/\s/g, '').length,
      paragraph_count: nonEmpty.length,
      ...(inferred ? { pov: inferred } : {}),
      source_href: x.d.href,
    });
  }
  const mainText = chapters
    .filter((c) => c.kind === 'chapter' || c.kind === 'prologue')
    .map((c) => c.text)
    .join('\n');
  const language = textLanguage(mainText);
  const translatedMarker = epub.documents.some((d) =>
    /translated chapter/i.test(d.title + (d.paragraphs[0] ?? '')),
  );
  const hangul = /[\uac00-\ud7a3]/;
  const koreanTitle = hangul.test(epub.title) || hangul.test(fileName);
  const isTranslation = language !== 'ko' && (translatedMarker || koreanTitle);
  // A translated file keeps its Korean title (the file name) as the book's title.
  const fileTitle = fileName
    .replace(/\.epub$/i, '')
    .replace(/^\s*\[[^\]]*\]\s*/, '')
    .trim();
  const title =
    !hangul.test(epub.title) && hangul.test(fileTitle) ? fileTitle : epub.title || fileTitle;
  const evidence = povEvidence(mainText);
  const chapterPovs: Record<string, number> = {};
  for (const c of chapters) if (c.pov) chapterPovs[c.pov] = (chapterPovs[c.pov] ?? 0) + 1;
  const status = /Status:\s*<\/strong>\s*([^<]+)/.exec('')?.[1];
  return {
    title: title.trim(),
    title_key: titleKey(title),
    author: epub.creator,
    status,
    synopsis: epub.description,
    subjects: epub.subjects,
    text_language: language,
    is_translation: isTranslation,
    voice_eligible: language === 'ko',
    pov: language === 'ko' ? inferPov(evidence) : undefined,
    pov_evidence: { ...evidence, chapter_povs: chapterPovs },
    chapters,
  };
}

export function readCorpusBook(buf: Buffer, fileName: string): CorpusBook {
  return corpusBookFrom(readEpub(buf), fileName);
}
