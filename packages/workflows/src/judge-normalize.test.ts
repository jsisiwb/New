import { loadSchemas, validatorFor } from '@yeonjae/domain';
import { segmentParagraphs, toNfcText } from '@yeonjae/prose';
import { describe, expect, it } from 'vitest';
import {
  anchorIssueQuote,
  DRIFT_FLAG_ALIASES,
  normalizeDimensionScores,
  normalizeDriftFlags,
  normalizeRepair,
} from './judge-normalize.js';

const scorecardSchema = loadSchemas().schemas.get('scorecard.schema.json')?.schema as {
  properties: {
    sections: {
      properties: Record<
        string,
        { allOf: { properties?: { drift_flags?: { items?: { enum?: string[] } } } }[] }
      >;
    };
  };
};
const driftEnum = (section: string): string[] =>
  scorecardSchema.properties.sections.properties[section]?.allOf.find(
    (p) => p.properties?.drift_flags,
  )?.properties?.drift_flags?.items?.enum ?? [];

// Excerpt of a live chapter: three paragraphs, the third in straight quotes, the first in curly ones.
const CHAPTER = toNfcText(
  '“이게 무슨……”\n\n「로젠하임 아카데미 입학 안내」\n\n문이 벌컥 열렸다.\n\n"이안! 너 왜 그렇게 창백해?"',
);
const PARAGRAPHS = segmentParagraphs(CHAPTER);

describe('normalizeDriftFlags', () => {
  it('maps the issue kinds a live structure judge returned onto the schema enum', () => {
    expect(
      normalizeDriftFlags('structure', [
        'late_hook',
        'western_novel_drift',
        'weak_pacing',
        'weak_ending',
      ]),
    ).toEqual(['serial', 'western_novel', 'cadence']);
  });

  it('drops what has no taught alias and keeps schema values unchanged', () => {
    expect(
      normalizeDriftFlags('prose', ['translation_like', '번역투', 'paragraph_length']),
    ).toEqual(['translation_like']);
    expect(normalizeDriftFlags('prose', 'translation_like')).toEqual([]);
  });

  it('keeps free text for the sections whose flags the schema leaves open', () => {
    expect(normalizeDriftFlags('genre', ['히로인·호감 전개 부재', '', 7])).toEqual([
      '히로인·호감 전개 부재',
    ]);
  });

  it('maps every alias to a value the scorecard schema accepts', () => {
    for (const section of ['prose', 'structure'] as const) {
      const allowed = driftEnum(section);
      expect(allowed.length).toBeGreaterThan(0);
      for (const target of Object.values(DRIFT_FLAG_ALIASES[section]))
        expect(allowed).toContain(target);
    }
  });
});

describe('normalizeDimensionScores', () => {
  it('drops a 0–100 section score instead of rescaling it', () => {
    expect(normalizeDimensionScores({ prose: 88 })).toEqual({});
  });

  it('keeps 1–5 sub-scores', () => {
    expect(
      normalizeDimensionScores({ hook_timing: 5, ending_pull: 2.5, low: 0, text: '3', nan: NaN }),
    ).toEqual({ hook_timing: 5, ending_pull: 2.5 });
    expect(normalizeDimensionScores([4])).toEqual({});
  });
});

describe('normalizeRepair', () => {
  it('reads a string repair as the suggestion', () => {
    expect(normalizeRepair(' 방 인원수를 4인실로 고친다. ')).toEqual({
      suggestion: '방 인원수를 4인실로 고친다.',
    });
    expect(normalizeRepair('  ')).toBeUndefined();
  });

  it('returns a schema-valid repair as the same object', () => {
    const repair = { scope: 'sentence', suggestion: 'Rewrite.', must_preserve_fact_ids: [] };
    expect(normalizeRepair(repair)).toBe(repair);
  });

  it('keeps only the schema fields of anything else', () => {
    expect(
      normalizeRepair({
        scope: 'whole',
        suggestion: '짧게.',
        must_preserve_fact_ids: ['방 배정 규칙', '01920000-0000-7000-8000-000000000001'],
        why: '…',
      }),
    ).toEqual({
      suggestion: '짧게.',
      must_preserve_fact_ids: ['01920000-0000-7000-8000-000000000001'],
    });
    expect(normalizeRepair({ note: 'x' })).toBeUndefined();
    expect(normalizeRepair(3)).toBeUndefined();
  });
});

describe('anchorIssueQuote', () => {
  it('anchors an exact quote with its paragraph ids', () => {
    const a = anchorIssueQuote(CHAPTER, PARAGRAPHS, '「로젠하임 아카데미 입학 안내」');
    expect(a).toMatchObject({ quote: '「로젠하임 아카데미 입학 안내」', paragraph_ids: ['p2'] });
  });

  it('tolerates copied paragraph markers and a quote spanning paragraphs', () => {
    const a = anchorIssueQuote(
      CHAPTER,
      PARAGRAPHS,
      '[p3] 문이 벌컥 열렸다. [p4] "이안! 너 왜 그렇게 창백해?"',
    );
    expect(a?.paragraph_ids).toEqual(['p3', 'p4']);
    expect(a?.quote).toBe('문이 벌컥 열렸다.\n\n"이안! 너 왜 그렇게 창백해?"');
  });

  it('tolerates retyped quotation marks and returns the manuscript text', () => {
    const a = anchorIssueQuote(CHAPTER, PARAGRAPHS, '"이게 무슨……"');
    expect(a).toMatchObject({ start: 0, quote: '“이게 무슨……”', paragraph_ids: ['p1'] });
  });

  it('does not anchor a quote the manuscript does not contain', () => {
    expect(anchorIssueQuote(CHAPTER, PARAGRAPHS, '방이 우리 넷이라니')).toBeUndefined();
    expect(anchorIssueQuote(CHAPTER, PARAGRAPHS, 42)).toBeUndefined();
  });

  it('yields a chapter_span and repair the issue schema accepts', () => {
    const span = anchorIssueQuote(CHAPTER, PARAGRAPHS, '문이 벌컥 열렸다.');
    const issue = {
      id: '01920000-0000-7000-8000-00000000000a',
      source: 'judge:continuity_checker',
      dimension: 'continuity',
      kind: 'other',
      severity: 'major',
      confidence: 0.9,
      claim: '방 배정이 정사와 어긋난다.',
      status: 'open',
      chapter_span: { manuscript_version_id: '01920000-0000-7000-8000-00000000000b', ...span },
      repair: normalizeRepair('방 인원수를 4인실로 고친다.'),
    };
    expect(validatorFor('issue.schema.json')(issue)).toEqual({ ok: true, value: issue });
  });
});
