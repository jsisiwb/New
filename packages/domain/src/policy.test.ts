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
      'policy/standard@11',
      'policy/standard@12',
      'policy/standard@13',
      'policy/standard@14',
      'policy/standard@15',
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

  it('standard.v15 is standard.v14 with plan-level prevention and converging revision (ADR-0086)', () => {
    const v14 = requirePolicy('policy/standard@14', policies);
    const v15 = requirePolicy('policy/standard@15', policies);
    expect(v15.revision).toEqual({
      ...v14.revision,
      convergence: {
        rejudge_open_majors: true,
        prefer_failing_dimension: true,
        span_attribution: true,
        threshold_protection: true,
        round_scope: 'all_open',
        score_targets: true,
        confirm_full: true,
      },
    });
    expect(v15.planning).toEqual({
      ...v14.planning,
      reveal_schedule: { hint_budget: 1 },
      plan_critic: { max_repairs: 1 },
      cut_design: true,
      time_frames: true,
      dialogue_floor: {
        ...v14.planning?.dialogue_floor,
        scene_redraft_ratio: 0.6,
        partner_in_contract: true,
        strip_talk_bans: true,
        line_targets: {
          median_per_1k: 9.2,
          min_per_1k: 5.3,
          monologue_max_per_1k: 2.1,
          median_share: 0.234,
        },
      },
    });
    expect(v15.prompts).toEqual({ max_version: '4.7.0' });
    const strip = (p: typeof v14) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        revision: _r,
        planning: _p,
        prompts: _pr,
        ...rest
      } = p;
      return rest;
    };
    // No gate threshold moves (rule 5): everything else, gates included, is v14's.
    expect(strip(v15)).toEqual(strip(v14));
    expect(v15.gates).toEqual(v14.gates);
  });

  it('standard.v14 is standard.v13 with revision convergence and the dialogue floor (ADR-0084)', () => {
    const v13 = requirePolicy('policy/standard@13', policies);
    const v14 = requirePolicy('policy/standard@14', policies);
    expect(v14.revision).toEqual({
      ...v13.revision,
      convergence: { rejudge_open_majors: true, prefer_failing_dimension: true },
    });
    expect(v14.planning).toEqual({
      ...v13.planning,
      dialogue_floor: { chapter_min: 0.2, partner_required: true, scene_redraft_below: 0.12 },
    });
    expect(v14.identity).toEqual({ ...v13.identity, device_lexicon: true });
    expect(v14.drafting).toEqual({ ...v13.drafting, reader_secrets_in_plan: true });
    const strip = (p: typeof v13) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        calibration: _c,
        revision: _r,
        planning: _p,
        identity: _i,
        drafting: _d,
        ...rest
      } = p;
      return rest;
    };
    expect(strip(v14)).toEqual(strip(v13));
    expect(v14.gates).toEqual(v13.gates);
  });

  it('standard.v13 is standard.v12 with the operator voice, corpus exemplars and the copy check (ADR-0083)', () => {
    const v12 = requirePolicy('policy/standard@12', policies);
    const v13 = requirePolicy('policy/standard@13', policies);
    expect(v13.identity).toEqual({
      language_layer: 'lang/ko@7',
      voice_profile: 'voice/operator@1',
      operator_exemplars: {
        tagger: 'passages@1',
        functions: ['hook', 'banter', 'status_window', 'cliffhanger'],
        per_function: 1,
      },
    });
    expect(v13.evaluation).toEqual({ ...v12.evaluation, corpus_copy: { min_chars: 14 } });
    const strip = (p: typeof v12) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        calibration: _c,
        identity: _i,
        evaluation: _e,
        ...rest
      } = p;
      return rest;
    };
    expect(strip(v13)).toEqual(strip(v12));
    // No gate threshold changes.
    expect(v13.gates).toEqual(v12.gates);
  });

  it('standard.v12 is standard.v11 with the Gemini and same-model judging settings (ADR-0080, ADR-0081)', () => {
    const v11 = requirePolicy('policy/standard@11', policies);
    const v12 = requirePolicy('policy/standard@12', policies);
    expect(v12.prompts).toEqual({ max_version: '4.6.0' });
    expect(v11.prompts).toBeUndefined();
    expect(v12.drafting).toEqual({ paragraph_per_line: true });
    expect(v12.provider_retry).toEqual({
      ...v11.provider_retry,
      refusal: { max_retries: 2, detect_text: true },
    });
    expect(v12.evaluation).toEqual({
      ...v11.evaluation,
      length_in_structure: true,
      judge_calibration: { max_gap_points: 30 },
    });
    expect(v12.length.scene_calibration).toEqual({
      ...v11.length.scene_calibration,
      request_ratio: 1.1,
    });
    expect(v12.gates.dimensions.structure).toEqual({ min_score: 78, judge_weight: 0.5 });
    const strip = (p: typeof v11) => {
      const {
        version: _v,
        name: _n,
        content_hash: _h,
        calibration: _c,
        prompts: _p,
        drafting: _d,
        provider_retry: _r,
        evaluation: _e,
        length: _l,
        gates,
        ...rest
      } = p;
      const { dimensions, ...g } = gates;
      const { structure: _s, ...dims } = dimensions;
      return { ...rest, gates: { ...g, dimensions: dims } };
    };
    expect(strip(v12)).toEqual(strip(v11));
    // Thresholds are unchanged: no gate is lowered.
    for (const d of ['prose', 'structure', 'genre', 'voice'] as const)
      expect(v12.gates.dimensions[d]?.min_score).toBe(v11.gates.dimensions[d]?.min_score);
  });

  it('standard.v11 is standard.v10 with parent-baseline patch regression (ADR-0078)', () => {
    const v10 = requirePolicy('policy/standard@10', policies);
    const v11 = requirePolicy('policy/standard@11', policies);
    expect(v11.revision).toEqual({ ...v10.revision, regression_baseline: 'parent' });
    const strip = (p: typeof v10) => {
      const { version: _v, name: _n, content_hash: _h, revision: _r, ...rest } = p;
      return rest;
    };
    expect(strip(v11)).toEqual(strip(v10));
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
