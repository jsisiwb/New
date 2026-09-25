/**
 * ADR-0096 (live defect G12-1): per-hit pronoun markers inside the operator's pronoun band are notes, and the prose judge's
 * digest names the band instead of listing them. The two sentences are G12a r3 draft lines the prose judge quoted; the
 * repeated syllable only sets the chapter's length, and so its pronoun rate.
 */
import { requirePolicy } from '@yeonjae/domain';
import { type ManuscriptVersionRow } from '@yeonjae/db';
import { ProfileStore } from '@yeonjae/narrative';
import { type KoStyleReport } from '@yeonjae/prose';
import { describe, expect, it } from 'vitest';
import {
  PRONOUN_MARKER,
  pronounBand,
  proseLintDigest,
  runDeterministicChecks,
} from './evaluation.js';
import { pronounRedraftNote } from './drafting.js';
import { type ChapterContract } from './planning.js';
import { type WorkflowContext } from './runtime.js';

const outputLanguage = ProfileStore.fromDirectory().get('lang/ko@9').output_language;
const ctxFor = (policy: string) =>
  ({
    workflowId: 'chapter:test:1',
    policy: requirePolicy(policy),
    identity: { outputLanguage, preferences: { pov: 'first' }, genres: [], tradition: {} },
  }) as unknown as WorkflowContext;

const lines = [
  '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.',
  '그녀의 목소리는 방금 전 레이몬드를 꾸짖을 때보다 훨씬 더 매서웠다.',
];
const contract = {
  chapter_number: 1,
  scene_count: 1,
  length_target: { unit: 'characters', value: 1200, tolerance_ratio: 0.12 },
  must_not_happen: [],
} as unknown as ChapterContract;
const version = (filler: number) =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    text: [...lines, '가'.repeat(filler)].join('\n'),
  }) as ManuscriptVersionRow;
const markers = (policy: string, filler: number) => {
  const det = runDeterministicChecks(ctxFor(policy), version(filler), contract, []);
  return {
    det,
    severities: det.issues
      .filter((i) => i.metric?.rule_id === PRONOUN_MARKER)
      .map((i) => i.severity),
  };
};

describe('per-hit pronoun markers inside the operator’s band (ADR-0096, G12-1)', () => {
  it('records the hits as notes below the warn line, with their spans', () => {
    // Two hits in about 1,100자: 1.8 per 1,000자, G12a's own rate, under the first-person warn line (2.57).
    const { det, severities } = markers('policy/standard@24', 1000);
    expect(det.pronoun_band?.warn).toBe(2.57);
    expect(severities).toEqual(['note', 'note']);
    const hit = det.issues.find((i) => i.metric?.rule_id === PRONOUN_MARKER);
    expect(hit?.chapter_span?.quote).toBe('그는 ');
  });

  it('keeps every hit minor at or above the warn line, and under an earlier policy', () => {
    const dense = markers('policy/standard@24', 100);
    expect(dense.det.pronoun_band).toBeUndefined();
    expect(dense.severities).toEqual(['minor', 'minor']);
    const v23 = markers('policy/standard@23', 1000);
    expect(v23.det.pronoun_band).toBeUndefined();
    expect(v23.severities).toEqual(['minor', 'minor']);
  });

  it('reads the third-person line when the layer has no first-person one', () => {
    const report = { metrics: { pronoun_per_1k: 3 } } as unknown as KoStyleReport;
    const only3p = { 'KO-PRN-RATE': { warn: 3.79, fail: 5.74 } };
    expect(pronounBand(report, only3p, 'first')).toEqual({ rate: 3, warn: 3.79 });
    expect(
      pronounBand(report, { ...only3p, 'KO-PRN-RATE-1P': { warn: 2.57, fail: 3.78 } }, 'first'),
    ).toBeUndefined();
    expect(pronounBand(report, undefined, 'first')).toBeUndefined();
  });

  it('names the band in the prose judge’s digest instead of listing the hits', () => {
    const { det } = markers('policy/standard@24', 1000);
    const report = det.ko_style;
    if (!report) throw new Error('no ko_style report');
    const banded = proseLintDigest(report, det.pronoun_band);
    expect(banded).not.toContain(`[${PRONOUN_MARKER}`);
    expect(banded).toContain('운영자 원고의 범위 안이다(경고선 2.57)');
    expect(proseLintDigest(report, undefined)).toContain(`[${PRONOUN_MARKER}`);
  });
});

describe('the pronoun redraft instruction (ADR-0097, G14-1)', () => {
  it('carries the measured rate and the warn line, and keeps the scene’s events', () => {
    const note = pronounRedraftNote(4.41, 2.57);
    expect(note).toContain('1,000자에 4.41번');
    expect(note).toContain('경고선 2.57');
    expect(note).toContain('사건·비트·대사는 그대로 둔다');
    expect(note).not.toMatch(/[A-Za-z]/);
  });
});
