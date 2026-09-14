import { describe, expect, it } from 'vitest';
import { toNfcText } from './nfc.js';
import { paragraphAt, segmentParagraphs } from './paragraphs.js';

describe('paragraph segmentation', () => {
  it('assigns stable ids and code-point boundaries', () => {
    const t = toNfcText('One 🔥.\n\nTwo.\n\n\nThree.\n');
    const ps = segmentParagraphs(t);
    expect(ps.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(ps[0]).toMatchObject({ start: 0, end: 6, text: 'One 🔥.' });
    expect(ps[1]).toMatchObject({ start: 8, end: 12, text: 'Two.' });
    expect(ps[2]).toMatchObject({ start: 15, end: 21, text: 'Three.' });
    expect(paragraphAt(ps, 9)?.id).toBe('p2');
    expect(paragraphAt(ps, 7)).toBeUndefined(); // blank line is in no paragraph
  });

  it('handles a single paragraph without trailing newline', () => {
    expect(segmentParagraphs(toNfcText('Only one.'))).toHaveLength(1);
    expect(segmentParagraphs(toNfcText(''))).toHaveLength(0);
  });
});
