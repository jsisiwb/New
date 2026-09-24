import { describe, expect, it } from 'vitest';
import { canonicalPolicyHash, loadPolicies, overrideClassFor, requirePolicy } from './policy.js';

describe('Production Policy (ADR-0041 / ADR-0042)', () => {
  const policies = loadPolicies();

  it('loads the shipped policies with verified content hashes', () => {
    expect([...policies.keys()].sort()).toEqual([
      'policy/economy@1',
      'policy/premium@1',
      'policy/standard@1',
      'policy/standard@2',
      'policy/standard@3',
      'policy/standard@4',
    ]);
    for (const p of policies.values()) expect(p.content_hash).toBe(canonicalPolicyHash(p));
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
