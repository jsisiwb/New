/**
 * Previous-chapter tail extraction (docs/04-memory-canon/04 §4). The last `words` words of the accepted text,
 * verbatim, aligned backward to a paragraph boundary so the writer never continues from a half sentence, and
 * extended to the start of the last scene when that scene is shorter than the policy threshold. Offsets are
 * Unicode code points into the NFC text (ADR-0030) so the slice can be re-verified against the version.
 */
import { segmentParagraphs, toNfcText } from '@yeonjae/prose';
import { countWords } from './hash.js';

export interface TailSlice {
  readonly text: string;
  readonly startCp: number;
  readonly endCp: number;
  readonly words: number;
}

const SCENE_BREAK = /^\s*(?:\*\s*\*\s*\*|—{3,}|-{3,}|◇|◆|#)\s*$/u;

export function previousTail(text: string, words: number, extendToSceneBelowWords = 0): TailSlice {
  const source = toNfcText(text);
  const paragraphs = segmentParagraphs(source);
  if (paragraphs.length === 0) return { text: '', startCp: 0, endCp: 0, words: 0 };
  const cps = Array.from(source.text);
  const last = paragraphs[paragraphs.length - 1];
  const endCp = last ? last.end : cps.length;

  // Walk paragraphs backward until at least `words` words are covered (paragraph-aligned).
  let startCp = 0;
  let acc = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (!p) continue;
    acc += countWords(p.text);
    if (acc >= words) {
      startCp = p.start;
      break;
    }
  }
  if (extendToSceneBelowWords > 0) {
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      const p = paragraphs[i];
      if (!p || !SCENE_BREAK.test(p.text)) continue;
      const sceneStart = paragraphs[i + 1]?.start ?? endCp;
      const sceneWords = countWords(cps.slice(sceneStart, endCp).join(''));
      if (sceneWords < extendToSceneBelowWords && sceneStart < startCp) startCp = sceneStart;
      break;
    }
  }
  const slice = cps.slice(startCp, endCp).join('');
  return { text: slice, startCp, endCp, words: countWords(slice) };
}
