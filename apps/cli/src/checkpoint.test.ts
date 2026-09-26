import { describe, expect, it } from 'vitest';
import { renderFindings, roundExtras, textShape } from './checkpoint.js';

describe('quality:checkpoint measures', () => {
  it('counts 자 with and without spaces, quoted lines and the first lines', () => {
    const s = textShape('첫 줄이다.\n\n“말했다.”\n\n‘속마음.’\n\n끝.');
    expect(s.chars).toBe('첫 줄이다.“말했다.”‘속마음.’끝.'.length);
    expect(s.chars_no_spaces).toBe(s.chars - 1);
    expect(s.quoted_dialogue_lines).toBe(1);
    expect(s.quoted_inner_lines).toBe(1);
    expect(s.first_lines).toEqual(['첫 줄이다.', '“말했다.”', '‘속마음.’']);
    expect(s.talk_share).toBeGreaterThan(0);
  });

  it('counts blocking and major findings, reader secrets, device lint and copy findings', () => {
    const x = roundExtras([
      { severity: 'blocking', kind: 'reader_knowledge_violation' },
      { severity: 'major', kind: 'knowledge_leak' },
      { severity: 'major', kind: 'other', metric: { rule_id: 'KO-DEVICE-01' } },
      { severity: 'blocking', kind: 'corpus_copy' },
      { severity: 'minor', kind: 'reader_knowledge_violation' },
    ]);
    expect(x).toEqual({
      blocking: 2,
      major: 2,
      reader_secret: { blocking: 1, major: 1 },
      ko_device: 1,
      corpus_copy: 1,
    });
  });

  it('exports only blocking and major findings with their quotes', () => {
    const text = renderFindings([
      {
        label: 'r0 v1',
        overall: { score: 80 },
        sections: { prose: { score: 80, passed: true, issue_ids: ['a'] } },
        issues: [
          {
            severity: 'major',
            dimension: 'prose',
            kind: 'other',
            claim: '주장',
            chapter_span: { quote: '인용' },
          },
          { severity: 'minor', dimension: 'prose', kind: 'other', claim: '사소함' },
        ],
      },
    ]);
    expect(text).toContain('=== scorecard r0 v1');
    expect(text).toContain('claim: 주장');
    expect(text).toContain('quote: 인용');
    expect(text).not.toContain('사소함');
  });
});
