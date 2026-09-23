import { describe, expect, it } from 'vitest';
import { koStyleDigest, lintKoreanWebnovel } from './ko-style.js';

const markers = [
  { id: 'TRN-KO-03', pattern: '(을|를) 통해(서)?', weight: 0.4, note: '‘~로’로.' },
  { id: 'TRN-KO-09', pattern: '(을|를) 느낄 수 있었다', weight: 0.5, note: '감각을 바로.' },
];
const patterns = [
  {
    id: 'AIT-KO-01',
    category: 'stale_cliche',
    pattern: '알 수 없는 (감정|기분)',
    severity: 'minor',
  },
  { id: 'SP-02', category: 'outline', pattern: '(^|\\n)\\s*(#{1,6}\\s)', severity: 'major' },
];

describe('lintKoreanWebnovel', () => {
  it('flags 번역투, clichés, format drift and Latin script with code-point spans', () => {
    const text =
      '# 1화\n\n그는 검을 통해 증명했다. 그녀의 살기를 느낄 수 있었다.\n\n알 수 없는 감정이 밀려왔다. OKAY.';
    const r = lintKoreanWebnovel(text, {
      translationMarkers: markers,
      forbiddenPatterns: patterns,
    });
    const ids = r.findings.map((f) => f.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining(['TRN-KO-03', 'TRN-KO-09', 'AIT-KO-01', 'SP-02', 'TRN-KO-02']),
    );
    const trn = r.findings.find((f) => f.rule_id === 'TRN-KO-03');
    expect(trn?.paragraph_ids).toEqual(['p2']);
    expect(trn?.quote).toBe('을 통해');
    expect(r.metrics.cliche_hits).toBe(1);
  });

  it('measures pronoun density, long paragraphs, dialogue share and reflective endings', () => {
    const long =
      '그는 걸었다. 그는 멈췄다. 그는 돌아봤다. 그는 다시 걸었다. 그녀는 그를 보고 있었다. 그의 발소리가 울렸다.';
    const text =
      [...Array(12).keys()].map(() => long).join('\n\n') + '\n\n그렇게 그날 하루가 저물었다.';
    const r = lintKoreanWebnovel(text);
    const ids = r.findings.map((f) => f.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining(['KO-PRN-RATE', 'KO-PARA-LONG', 'KO-DLG-LOW', 'KO-END-01']),
    );
    expect(r.findings.find((f) => f.rule_id === 'KO-END-01')?.severity).toBe('major');
    expect(koStyleDigest(r)).toContain('측정:');
  });

  it('passes a clean mobile-serial passage and respects the allowlist', () => {
    const text =
      '“비켜.”\n\n반장이 턱을 치켜들었다.\n\n“싫은데?”\n\n‘셋. 진짜는 뒤에 있는 놈.’\n\n[근력이 1 올랐습니다.]\n\n문 뒤에서 누가 박수를 쳤다.';
    const r = lintKoreanWebnovel(text, {
      translationMarkers: markers,
      forbiddenPatterns: patterns,
    });
    expect(r.findings).toEqual([]);
    const withLatin = lintKoreanWebnovel('“Lumen이다.”', { allowlist: ['Lumen'] });
    expect(withLatin.findings.filter((f) => f.rule_id === 'TRN-KO-02')).toEqual([]);
  });

  it('detects verbatim reuse of a studio exemplar line', () => {
    const exemplar = '“재밌는 신입이 들어왔네.”\n\n학생회 완장을 찬 여자가 웃고 있었다.';
    const r = lintKoreanWebnovel('그때였다.\n\n학생회 완장을 찬 여자가 웃고 있었다.', {
      exemplarTexts: [exemplar],
    });
    expect(r.findings.map((f) => f.rule_id)).toContain('EXEMPLAR-COPY');
  });
});
