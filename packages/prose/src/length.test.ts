import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toNfcText } from './nfc.js';
import { countSentences, countWords, judgeLength, measure } from './length.js';

const FIXTURE = fileURLToPath(
  new URL('../../../examples/fixture/manuscripts/ch09.accepted.txt', import.meta.url),
);

describe('length model (ADR-0034)', () => {
  it('counts hyphenated names, contractions and em-dash splits as English words', () => {
    expect(countWords('Kang Do-yoon didn’t answer—he couldn’t.')).toBe(6);
    expect(countWords('“Two,” he said.')).toBe(3);
    expect(countWords('F-rank porter… 120 million won.')).toBe(5);
    expect(countWords('')).toBe(0);
  });

  it('counts sentences with quotes and ellipses', () => {
    expect(countSentences('It cried. “Red.” Then… nothing?')).toBe(3);
    expect(countSentences('He waited… Then it came.')).toBe(2);
    expect(countSentences('No terminator at all')).toBe(1);
    expect(countSentences('')).toBe(0);
  });

  it('measures the fixture chapter in words and code points (not UTF-16 units)', () => {
    const nfc = toNfcText(readFileSync(FIXTURE, 'utf8'));
    const m = measure(nfc);
    expect(m.code_points).toBe(nfc.codePoints.length);
    expect(m.words).toBeGreaterThan(2000);
    expect(m.words).toBeLessThan(2600);
    expect(m.paragraphs).toBe(119);
    expect(m.est_tokens).toBe(Math.round(m.words * 1.3));
    expect(m.est_reading_seconds).toBeGreaterThan(0);
  });

  it('judges length against a words target with warn/fail tolerances', () => {
    const target = { unit: 'words' as const, value: 2500, tolerance_ratio: 0.12 };
    expect(judgeLength(2500, target, 0.2)).toMatchObject({
      verdict: 'within',
      warn: false,
      fail: false,
    });
    expect(judgeLength(2150, target, 0.2)).toMatchObject({
      verdict: 'under',
      warn: true,
      fail: false,
    });
    expect(judgeLength(1900, target, 0.2)).toMatchObject({
      verdict: 'under',
      warn: true,
      fail: true,
    });
    expect(judgeLength(2900, target, 0.2)).toMatchObject({
      verdict: 'over',
      warn: true,
      fail: false,
    });
  });
});
