import { describe, expect, it } from 'vitest';
import { capPronounFindings, capTalkFindings, type Issue } from './evaluation.js';

const issue = (over: Partial<Issue>): Issue => ({
  id: 'i',
  kind: 'translation_like_english',
  dimension: 'prose',
  severity: 'major',
  status: 'open',
  source: 'judge:prose_judge',
  confidence: 0.8,
  claim: '불필요한 서구식 대명사 ‘그녀의’가 사용되었습니다.',
  override_class: 'advisory',
  ...over,
});

describe('pronoun findings inside the operator’s pronoun band (ADR-0090, G8-7)', () => {
  const pronoun = issue({});
  const passive = issue({ id: 'p', claim: '‘확정되어 있었다’는 이중 피동이다.' });
  const voice = issue({ id: 'v', source: 'judge:voice_judge', dimension: 'voice' });

  it('records a prose-judge pronoun finding as minor below the band’s upper edge (G8a: 0.33 against 2.57)', () => {
    const out = capPronounFindings([pronoun, passive, voice], 0.33, 2.57);
    expect(out.map((i) => i.severity)).toEqual(['minor', 'major', 'major']);
  });

  it('keeps the judge’s severity when the pronouns stack at or above the band', () => {
    expect(capPronounFindings([pronoun], 2.57, 2.57)[0]?.severity).toBe('major');
    expect(capPronounFindings([pronoun], 4.1, 2.57)[0]?.severity).toBe('major');
  });
});

describe('the talk band cap (ADR-0095)', () => {
  const base = {
    id: '01950000-0000-7000-8000-000000000001',
    dimension: 'structure' as const,
    kind: 'serial_drift' as const,
    override_class: 'reviewer' as const,
    confidence: 0.9,
    status: 'open' as const,
  };
  const judged = {
    ...base,
    source: 'judge:structure_judge',
    severity: 'major' as const,
    claim: '결정적 린트 보고 기준 대사 비중이 13%로 낮아 장면이 무겁다.',
  };
  it('records a judge finding about the amount of dialogue as minor inside the operator band', () => {
    const [kept] = capTalkFindings([judged], 0.13, 0.126);
    expect(kept?.severity).toBe('minor');
  });
  it('leaves it below the band, and leaves other findings and the lint alone', () => {
    expect(capTalkFindings([judged], 0.1, 0.126)[0]?.severity).toBe('major');
    const other = { ...judged, claim: '절단이 약하다.' };
    expect(capTalkFindings([other], 0.3, 0.126)[0]?.severity).toBe('major');
    const lint = { ...judged, source: 'lint:ko_style' };
    expect(capTalkFindings([lint], 0.3, 0.126)[0]?.severity).toBe('major');
  });
});
