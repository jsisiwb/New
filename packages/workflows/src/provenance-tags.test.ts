import { describe, expect, it } from 'vitest';
import {
  DESIGN_FAMILIES,
  stripProvenanceTags,
  stripProvenanceTagsDeep,
} from './provenance-tags.js';

describe('provenance tags in design answers (G7)', () => {
  it('removes the tags the G7 designers copied, wherever they sit', () => {
    expect(stripProvenanceTags('[FACT] 입학 실기 평가장. 카운트다운 30초.')).toBe(
      '입학 실기 평가장. 카운트다운 30초.',
    );
    expect(stripProvenanceTags('효율성만 따진다. [PLANNED] 그 과정에서')).toBe(
      '효율성만 따진다. 그 과정에서',
    );
    expect(stripProvenanceTags('끝난다 [SUMMARY]')).toBe('끝난다');
    expect(stripProvenanceTags('[FACT v128 ch.12] 사실 [EVIDENCE ch.9 ¶14] 근거')).toBe(
      '사실 근거',
    );
  });

  it('keeps status windows, other brackets and untouched strings as they are', () => {
    const status = '[이름: 카일]  [레벨: 99(MAX)]';
    expect(stripProvenanceTags(status)).toBe(status);
    expect(stripProvenanceTags('[FACTORY] 공장')).toBe('[FACTORY] 공장');
    expect(stripProvenanceTags('[시스템] 퀘스트')).toBe('[시스템] 퀘스트');
  });

  it('walks nested answers and returns the same object when nothing changed', () => {
    const clean = { logline: '빙의했다.', beats: [{ text: '문이 열린다.' }], n: 3, ok: true };
    const same = stripProvenanceTagsDeep(clean);
    expect(same.removed).toBe(0);
    expect(same.value).toBe(clean);
    const tagged = {
      logline: '[FACT] 빙의했다.',
      beats: [{ text: '[PLANNED] 문이 열린다.' }, null],
      n: 3,
    };
    const out = stripProvenanceTagsDeep(tagged);
    expect(out.removed).toBe(2);
    expect(out.value).toEqual({
      logline: '빙의했다.',
      beats: [{ text: '문이 열린다.' }, null],
      n: 3,
    });
    expect(tagged.logline).toBe('[FACT] 빙의했다.');
  });

  it('covers only the roles that write design data, never a judge or the extractor quoting a draft', () => {
    expect(DESIGN_FAMILIES.has('concept_generator')).toBe(true);
    expect(DESIGN_FAMILIES.has('power_system_designer')).toBe(true);
    for (const f of ['canon_extractor', 'prose_judge', 'scene_writer', 'targeted_reviser'])
      expect(DESIGN_FAMILIES.has(f)).toBe(false);
  });
});
