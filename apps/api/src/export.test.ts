import { describe, expect, it } from 'vitest';
import { type ExportResult } from '@yeonjae/workflows';
import { DEFAULT_TYPOGRAPHY, renderTxt } from './export.js';

const chapter = (n: number) => ({
  chapter_no: n,
  manuscript_version_id: `v${n}`,
  version_no: 1,
  content_hash: 'sha256:0',
  canon_version: n,
  words: 3,
});

// Studio test strings for the export splitter, not manuscript text.
const koText = '## 1화\n\n문이 열렸다.\n\n2화 예고는 없었다.\n\n## 2화\n\n계단이 끝났다.\n';

describe('export headings follow the manuscript language (audit §5.12)', () => {
  it('writes N화 headings for a Korean export and splits chapters only on a heading line', () => {
    const result: ExportResult = {
      project_id: 'p',
      chapters: [chapter(1), chapter(2)],
      format: 'markdown',
      text: koText,
      content_hash: 'sha256:0',
      language: 'ko',
    };
    const txt = renderTxt(result, { title: '재의 장부', typography: DEFAULT_TYPOGRAPHY });
    expect(txt).toBe(
      '재의 장부\n\n1화\n\n문이 열렸다.\n\n2화 예고는 없었다.\n\n2화\n\n계단이 끝났다.\n',
    );
    expect(txt).not.toContain('Chapter');
  });

  it('keeps English headings and output unchanged', () => {
    const result: ExportResult = {
      project_id: 'p',
      chapters: [chapter(1)],
      format: 'text',
      text: 'Chapter 1\n\nThe door opened.\n',
      content_hash: 'sha256:0',
    };
    expect(renderTxt(result, { title: 'Ledger', typography: DEFAULT_TYPOGRAPHY })).toBe(
      'Ledger\n\nChapter 1\n\nThe door opened.\n',
    );
  });
});
