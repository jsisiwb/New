import { describe, expect, it } from 'vitest';
import { canonicalPolicyHash, loadPolicies, overrideClassFor, requirePolicy } from './policy.js';

describe('Production Policy (ADR-0041 / ADR-0042)', () => {
  const policies = loadPolicies();

  it('loads the shipped policies with verified content hashes', () => {
    expect([...policies.keys()].sort()).toEqual([
      'policy/economy@1',
      'policy/premium@1',
      'policy/standard@1',
      'policy/standard@10',
      'policy/standard@2',
      'policy/standard@3',
      'policy/standard@4',
      'policy/standard@5',
      'policy/standard@6',
      'policy/standard@7',
      'policy/standard@8',
      'policy/standard@9',
    ]);
    for (const p of policies.values()) expect(p.content_hash).toBe(canonicalPolicyHash(p));
  });

  it('standard.v10 is standard.v9 with multi-patch revision (ADR-0077)', () => {
    const v9 = requirePolicy('policy/standard@9', policies);
    const v10 = requirePolicy('policy/standard@10', policies);
    expect(v10.revision).toEqual({
      ...v9.revision,
      multi_patch: { max_patches: 4, merge_gap_chars: 120 },
    });
    const strip = (p: typeof v9) => {
      const { version: _v, name: _n, content_hash: _h, revision: _r, ...rest } = p;
      return rest;
    };
    expect(strip(v10)).toEqual(strip(v9));
  });

  it('standard.v9 is standard.v8 with hierarchical story memory (ADR-0076)', () => {
    const v8 = requirePolicy('policy/standard@8', policies);
    const v9 = requirePolicy('policy/standard@9', policies);
    expect(v9.context).toEqual({
      ...v8.context,
      story_memory: { arc_summaries: true, recent_chapters: 20, l2_max_chars: 500 },
    });
    const strip = (p: typeof v8) => {
      const { version: _v, name: _n, content_hash: _h, context: _c, ...rest } = p;
      return rest;
    };
    expect(strip(v9)).toEqual(strip(v8));
  });

  it('standard.v8 is standard.v7 with Korean-calibrated budgets and scene length calibration (ADR-0075)', () => {
    const v7 = requirePolicy('policy/standard@7', policies);
    const v8 = requirePolicy('policy/standard@8', policies);
    expect(v8.context).toEqual({
      ...v7.context,
      writer_input_budget_tokens: 36_000,
      input_budget_tokens: {
        'pack.chapter_planner': 20_000,
        'pack.continuity_checker': 34_000,
        'pack.extractor': 30_000,
      },
    });
    expect(v8.length).toEqual({
      ...v7.length,
      scene_calibration: { request_ratio: 0.8, redistribute: true, min_ratio: 0.5, max_ratio: 1.3 },
    });
    const strip = (p: typeof v7) => {
      const { version: _v, name: _n, content_hash: _h, context: _c, length: _l, ...rest } = p;
      return rest;
    };
    expect(strip(v8)).toEqual(strip(v7));
  });

  it('standard.v7 is standard.v6 plus the Korean-prose opt-ins (ADR-0073, ADR-0074)', () => {
    const v6 = requirePolicy('policy/standard@6', policies);
    const v7 = requirePolicy('policy/standard@7', policies);
    expect(v7.identity).toEqual({ language_layer: 'lang/ko@6' });
    expect(v7.planning).toEqual({ ...v6.planning, rhythm_directives: true });
    expect(v7.revision).toEqual({ ...v6.revision, polish_pass: true });
    expect(v7.evaluation).toEqual({ ...v6.evaluation, pov_secrets_reader_visible: true });
    const strip = (p: typeof v6) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        identity: _i,
        planning: _p,
        revision: _r,
        evaluation: _e,
        ...rest
      } = p;
      return rest;
    };
    expect(strip(v7)).toEqual(strip(v6));
  });

  it('standard.v6 is standard.v5 plus provider_retry and planning.design_batches (ADR-0072)', () => {
    const v5 = requirePolicy('policy/standard@5', policies);
    const v6 = requirePolicy('policy/standard@6', policies);
    expect(v6.provider_retry).toEqual({
      max_attempts: 6,
      base_delay_ms: 30_000,
      max_delay_ms: 240_000,
      multiplier: 2,
      jitter: 'full',
      retry_empty_reply: true,
    });
    expect(v6.planning).toEqual({ ...v5.planning, design_batches: true });
    const strip = (p: typeof v5) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        planning: _p,
        provider_retry: _r,
        ...rest
      } = p;
      return rest;
    };
    expect(strip(v6)).toEqual(strip(v5));
  });

  it('standard.v2 is standard.v1 plus the ADR-0060 evaluation block', () => {
    const v1 = requirePolicy('policy/standard@1', policies);
    const v2 = requirePolicy('policy/standard@2', policies);
    expect(v1.evaluation).toBeUndefined();
    expect(v2.evaluation).toEqual({
      max_parallel_evaluators: 4,
      optional_evaluators: ['promise_checker', 'repetition_judge'],
      score_model: 'rubric_subscores',
      reevaluation: 'targeted',
      lint_penalty_points: { minor: 4, major: 15, blocking: 40 },
    });
    const strip = (p: typeof v1) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        evaluation: _e,
        calibration: _c,
        ...rest
      } = p;
      return rest;
    };
    expect(strip(v2)).toEqual(strip(v1));
  });

  it('standard.v5 is standard.v4 plus the ADR-0068 labelled scene plan', () => {
    const v4 = requirePolicy('policy/standard@4', policies);
    const v5 = requirePolicy('policy/standard@5', policies);
    expect(v4.planning?.scene_plan_format).toBeUndefined();
    expect(v5.planning).toEqual({ ...v4.planning, scene_plan_format: 'labelled' });
    const strip = (p: typeof v4) => {
      const { version: _v, name: _n, content_hash: _h, planning: _p, ...rest } = p;
      return rest;
    };
    expect(strip(v5)).toEqual(strip(v4));
  });

  it('standard.v4 is standard.v3 plus the ADR-0064 revision knobs', () => {
    const v3 = requirePolicy('policy/standard@3', policies);
    const v4 = requirePolicy('policy/standard@4', policies);
    expect(v3.revision.on_regression).toBeUndefined();
    expect(v4.revision).toEqual({
      ...v3.revision,
      on_regression: 'discard_and_continue',
      rounds_by_language: { en: 1, ko: 3 },
    });
    const strip = (p: typeof v3) => {
      const { version: _v, name: _n, content_hash: _h, revision: _r, ...rest } = p;
      return rest;
    };
    expect(strip(v4)).toEqual(strip(v3));
  });

  it('standard.v3 is standard.v2 plus the ADR-0063 ledger checks and plan check', () => {
    const v2 = requirePolicy('policy/standard@2', policies);
    const v3 = requirePolicy('policy/standard@3', policies);
    expect(v2.planning).toBeUndefined();
    expect(v2.evaluation?.ledger_checks).toBeUndefined();
    expect(v3.planning).toEqual({ plan_check: true });
    expect(v3.evaluation).toEqual({ ...v2.evaluation, ledger_checks: true });
    const strip = (p: typeof v2) => {
      const { version: _v, name: _n, content_hash: _h, evaluation: _e, planning: _p, ...rest } = p;
      return rest;
    };
    expect(strip(v3)).toEqual(strip(v2));
  });

  it('standard.v1 resolves the former 2-vs-3 revision-round disagreement to 3 and gates per dimension', () => {
    const std = requirePolicy('policy/standard@1', policies);
    expect(std.revision.max_rounds).toBe(3);
    expect(std.gates.dimensions.prose.min_score).toBe(78);
    expect(std.gates.dimensions.structure.min_score).toBe(78);
    expect(std.gates.blocking_max).toBe(0);
    expect(std.gates.major_max).toBe(0);
    expect(std.context.previous_tail_words).toBe(400);
  });

  it('override matrix: objective corruption is never overridable; locked-fact conflicts need a canon workflow', () => {
    const std = requirePolicy('policy/standard@1', policies);
    expect(overrideClassFor(std, 'non_english_output', 'blocking')).toBe('never');
    expect(overrideClassFor(std, 'truncated_output', 'blocking')).toBe('never');
    expect(overrideClassFor(std, 'evidence_integrity', 'blocking')).toBe('never');
    expect(overrideClassFor(std, 'knowledge_leak', 'blocking')).toBe('never');
    expect(overrideClassFor(std, 'canon_contradiction', 'major')).toBe('canon_workflow');
    expect(overrideClassFor(std, 'register_error', 'major')).toBe('reviewer');
    expect(overrideClassFor(std, 'register_error', 'minor')).toBe('advisory');
  });

  it('unknown policy refs fail loudly', () => {
    expect(() => requirePolicy('policy/standard@99', policies)).toThrow(
      /unknown production policy/,
    );
  });
});
