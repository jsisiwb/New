import { describe, expect, it } from 'vitest';
import { excerptOf, lengthOf, projectKey } from './packet.js';

// Synthetic tokens, not prose.
describe('reading packet helpers (run 6, STEP 2)', () => {
  it('counts 자 with spaces (line breaks excluded) and without whitespace', () => {
    expect(lengthOf('가 나\n\n다')).toEqual({ withSpaces: 4, noSpaces: 3 });
  });

  it('takes the first non-empty lines unedited', () => {
    expect(excerptOf('\nㄱ\n\n ㄴ \nㄷ\nㄹ')).toEqual(['ㄱ', 'ㄴ', 'ㄷ']);
  });

  it('files a project under the first word of its title', () => {
    expect(projectKey('G25r 회귀 standard37')).toBe('G25r');
    expect(projectKey('')).toBe('project');
  });
});
