/**
 * The operator-corpus toolkit (ADR-0082): manifest format, title matching, classification, EPUB reading,
 * translation detection, the copy index and the ending classifier. Every Korean string here is a short
 * synthetic test string, not corpus text.
 */
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  classifyDocument,
  corpusBookFrom,
  inferPov,
  parseManifest,
  povEvidence,
  storeIdOf,
  titleKey,
} from './corpus.js';
import { CorpusCopyIndex, skeletonOf } from './corpus-copy.js';
import { chapterMetrics, endingClass } from './corpus-stats.js';
import { readEpub } from './epub.js';

/** A minimal ZIP writer (stored or deflated entries) for building test EPUBs. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8');
    const deflate = name.endsWith('.xhtml');
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const xhtml = (title: string, ps: string[]) =>
  `<?xml version="1.0"?><html><head><title>${title}</title></head><body><h1>${title}</h1>${ps.map((p) => `<p>${p}</p>`).join('')}</body></html>`;

function epub(chapters: [string, string, string[]][], bookTitle: string): Buffer {
  const items = chapters
    .map(
      ([id], i) =>
        `<item id="${id}" href="Text/c${String(i)}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('');
  const spine = chapters.map(([id]) => `<itemref idref="${id}"/>`).join('');
  const files: Record<string, string> = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': `<package><metadata><dc:title>${bookTitle}</dc:title><dc:creator>작가</dc:creator><dc:subject>판타지</dc:subject></metadata><manifest>${items}</manifest><spine>${spine}</spine></package>`,
  };
  chapters.forEach(([, title, ps], i) => {
    files[`OEBPS/Text/c${String(i)}.xhtml`] = xhtml(title, ps);
  });
  return zip(files);
}

describe('operator corpus (ADR-0082)', () => {
  it('parses the title-plus-hashtags manifest, with leading spaces and blank-line separators', () => {
    const m = parseManifest('제목 하나\n#판타지\n#아카데미\n\n\n[9] 제목 둘.\n  #하렘\n#빙의\n');
    expect(m).toEqual([
      { title: '제목 하나', tags: ['판타지', '아카데미'] },
      { title: '[9] 제목 둘.', tags: ['하렘', '빙의'] },
    ]);
  });

  it('matches titles by key and keeps the store id as metadata', () => {
    expect(titleKey('[154110] 제목 둘..epub')).toBe(titleKey('제목 둘.'));
    expect(storeIdOf('[154110] 제목 둘..epub')).toBe('154110');
    expect(storeIdOf('제목 하나.epub')).toBeUndefined();
  });

  it('classifies notices, side stories, afterwords and numbered arc epilogues', () => {
    expect(classifyDocument('Notice: 연재 공지', 'Text/chapter_notice0001.xhtml')).toBe('notice');
    expect(classifyDocument('외전. 밤', 'Text/c9.xhtml')).toBe('side');
    expect(classifyDocument('완결 후기', 'Text/c9.xhtml')).toBe('afterword');
    expect(classifyDocument('111. 에필로그', 'Text/c9.xhtml')).toBe('chapter');
    expect(classifyDocument('마지막, 그 이후의 이야기 (1)', 'Text/c9.xhtml')).toBe('epilogue');
    expect(classifyDocument('', 'Text/cover.html')).toBe('skip');
  });

  it('reads an EPUB in spine order, with a prologue before numbered chapters and blank lines kept', () => {
    const buf = epub(
      [
        ['n1', 'Notice: 공지', ['공지 문장이다.']],
        ['c0', '시작', ['뚜벅 뚜벅.', ' ', '나는 복도를 걸었다.']],
        ['c1', '1. 첫 화', ['1. 첫 화', '“가자.”', '나는 문을 열었다.']],
      ],
      '시험 작품',
    );
    const e = readEpub(buf);
    expect(e.title).toBe('시험 작품');
    expect(e.documents.map((d) => d.title)).toEqual(['Notice: 공지', '시작', '1. 첫 화']);
    const book = corpusBookFrom(e, '[42] 시험 작품.epub');
    expect(book.chapters.map((c) => [c.kind, c.position ?? null, c.number ?? null])).toEqual([
      ['notice', null, null],
      ['prologue', 1, null],
      ['chapter', 2, 1],
    ]);
    expect(book.chapters[1]?.text).toBe('뚜벅 뚜벅.\n\n나는 복도를 걸었다.');
    // The heading repeated as the first paragraph is dropped.
    expect(book.chapters[2]?.text).toBe('“가자.”\n나는 문을 열었다.');
    expect(book).toMatchObject({
      text_language: 'ko',
      is_translation: false,
      voice_eligible: true,
    });
  });

  it('flags an English file with a Korean file name as a translation that carries no voice', () => {
    const buf = epub(
      [['c0', 'I Got It', ['I transmigrated into a novel.', 'It was a cliché.']]],
      'I Got It',
    );
    const book = corpusBookFrom(readEpub(buf), '시험 작품.epub');
    expect(book).toMatchObject({
      text_language: 'en',
      is_translation: true,
      voice_eligible: false,
      title: '시험 작품',
    });
  });

  it('infers the point of view from narration markers', () => {
    expect(inferPov(povEvidence('나는 문을 열었다. 내가 먼저 들어갔다.'))).toBe('first');
    expect(inferPov(povEvidence('그는 문을 열었다. 그녀가 먼저 들어갔다.'))).toBe('third');
  });
});

describe('corpus copy index (ADR-0082)', () => {
  const index = CorpusCopyIndex.build([
    { id: 'a', text: '빗물이 고인 골목 끝에서 낡은 등불이 천천히 흔들리고 있었다.' },
    { id: 'b', text: '검은 외투의 사내는 대답 대신 담배를 비벼 껐다.' },
  ]);

  it('finds a shared run of at least 14 kept characters, ignoring spaces and punctuation', () => {
    const copies = index.findCopies('그날 밤, 빗물이 고인 골목 끝에서… 낡은 등불이 흔들렸다.');
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ source_id: 'a', chars: 15 });
    expect(copies[0]?.quote).toBe('빗물이 고인 골목 끝에서… 낡은 등불이');
  });

  it('ignores a shorter overlap and text it never saw', () => {
    expect(index.findCopies('사내는 대답 대신 웃었다.')).toEqual([]);
    expect(index.findCopies('전혀 다른 문장이다.')).toEqual([]);
    expect(CorpusCopyIndex.build([]).findCopies('빗물이 고인 골목 끝에서 낡은 등불이')).toEqual([]);
  });

  it('keeps code-point offsets into the draft', () => {
    const draft = '“아.” 검은 외투의 사내는 대답 대신 담배를 비벼 껐다.';
    const [c] = index.findCopies(draft);
    expect(c && Array.from(draft).slice(c.start, c.end).join('')).toBe(c?.quote);
    expect(skeletonOf('가, 나!').chars).toEqual(['가', '나']);
  });
});

describe('corpus statistics (ADR-0082)', () => {
  it('classifies narration sentence endings', () => {
    expect(endingClass('나는 문을 열었다.')).toBe('past');
    expect(endingClass('나는 문을 연다.')).toBe('present');
    expect(endingClass('이를 악무는 소녀.')).toBe('fragment');
    expect(endingClass('문을 열었으나.')).toBe('connective');
  });

  it('measures a chapter one paragraph per line', () => {
    const m = chapterMetrics('“가자.”\n나는 문을 열었다.');
    expect(m.paragraphs).toBe(2);
    expect(m.dialogue_ratio).toBeGreaterThan(0);
    expect(m.talk_share).toBeGreaterThanOrEqual(m.dialogue_ratio);
  });
});
