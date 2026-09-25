/**
 * ADR-0057 §4: the ADR-0056 §11–12 output normalizers, classified. Every normalizer is counted
 * (`yeonjae_output_normalizations_total{kind}`) only when it CHANGES an answer; a schema-valid answer must
 * pass through untouched and uncounted, which is what lets the counter tell live runs apart from
 * conforming output.
 *
 * Measured on the deterministic suites (`d357099` + this change): the English replay suites
 * (chapter-production, longform-replay, recovery) fire no normalizer; the simulated-model runs
 * (novel, novel-ko, story-plan) fire only `scene_draft` and `evidence_anchor`. The shape repairs below
 * were added for live answers and fire only live; they are kept until their counter stays at zero.
 */
import { normalizationCounts, OUTPUT_NORMALIZERS } from '@yeonjae/domain';
import { describe, expect, it } from 'vitest';
import {
  normalizeDimensionScores,
  normalizeDriftFlags,
  normalizeRepair,
} from './judge-normalize.js';
import { normalizePatchFields } from './revision.js';

/** Shape repairs: remove once the counter reads zero across live runs with generated shapes. */
const SHAPE_REPAIRS = [
  'contract_output',
  // ADR-0074 (A-1): a contract that names no location gets a registered one.
  'contract_location_fallback',
  'scene_plans',
  'patch_fields',
  'judge_drift_flags',
  'judge_dimension_scores',
  'judge_repair',
] as const;
/** Designed paths: prompts ask for quotes (models cannot count offsets), so anchoring is permanent. */
const DESIGNED_PATHS = [
  'evidence_anchor',
  'quote_marks_folded',
  'patch_quote_anchor',
  'judge_quote_anchor',
  'scene_draft',
  // ADR-0080: the gateway's JSON recoveries; ADR-0081: one paragraph per line in a prose draft.
  'json_fence_stripped',
  'json_object_extracted',
  'paragraph_per_line',
  // ADR-0084: the plan's dialogue floor and scene partner, and the one scene redraft below the talk band.
  'dialogue_floor',
  'dialogue_partner',
  'dialogue_redraft',
  // ADR-0086: plan-level prevention repairs the plan, never an answer's shape.
  'contract_repair',
  'reveal_repair',
  'plan_talk_ban',
  'plan_cut_beat',
  'plan_repair',
  'patch_candidates',
  'scene_rewrite',
  // ADR-0088: a line repeated word for word right after itself, dropped at assembly.
  'repeated_line',
  // ADR-0090: a first-person scene drafted in the third person, re-drafted once.
  'pov_redraft',
] as const;

describe('output normalizer inventory (ADR-0057)', () => {
  it('classifies every counted normalizer exactly once', () => {
    expect([...SHAPE_REPAIRS, ...DESIGNED_PATHS].sort()).toEqual([...OUTPUT_NORMALIZERS].sort());
  });

  it('shape repairs leave schema-valid answers unchanged', () => {
    expect(normalizeDriftFlags('prose', ['translation_like'])).toEqual(['translation_like']);
    expect(normalizeDriftFlags('structure', ['serial', 'cadence'])).toEqual(['serial', 'cadence']);
    expect(normalizeDimensionScores({ hook_timing: 4, ending_pull: 5 })).toEqual({
      hook_timing: 4,
      ending_pull: 5,
    });
    const repair = { scope: 'sentence', suggestion: '문장을 줄인다' };
    expect(normalizeRepair(repair)).toEqual(repair);
    const patch = {
      scope: 'sentence',
      span: { original_quote: '그는 웃었다.' },
      new_text: '레온이 웃었다.',
      changed_claims: [],
      preserved_facts_ack: [],
    };
    expect(normalizePatchFields(patch)).toEqual(patch);
  });

  it('counts nothing for a conforming answer', () => {
    const before = normalizationCounts();
    normalizeDriftFlags('prose', ['literary']);
    normalizeDimensionScores({ readability: 3 });
    expect(normalizationCounts()).toEqual(before);
  });
});
