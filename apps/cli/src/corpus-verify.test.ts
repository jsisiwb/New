/** Run 3: `corpus:verify --database` measures every stored chapter again from its own stored text. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { storedChapterMismatches } from './corpus.js';

const text = '문이 열렸다.\n\n“늦었네.”';
const stored = {
  text,
  chars_with_spaces: text.replace(/\n/g, '').length,
  chars_without_spaces: text.replace(/\s/g, '').length,
  paragraph_count: 2,
  content_sha256: createHash('sha256').update(text).digest('hex'),
};

describe('corpus:verify --database', () => {
  it('reproduces every stored measure of an unchanged chapter', () => {
    expect(storedChapterMismatches(stored)).toEqual([]);
  });

  it('names the measures a changed text no longer reproduces', () => {
    expect(storedChapterMismatches({ ...stored, text: `${text} 끝.` })).toEqual([
      'chars_with_spaces',
      'chars_without_spaces',
      'content_sha256',
    ]);
    expect(storedChapterMismatches({ ...stored, paragraph_count: 3 })).toEqual(['paragraph_count']);
  });
});
