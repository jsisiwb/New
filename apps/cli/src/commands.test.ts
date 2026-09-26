import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { run } from './commands.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ch09 = `${root}examples/fixture/manuscripts/ch09.accepted.txt`;
const delta = `${root}examples/fixture/canon-delta.ch09.json`;
const spec = `${root}examples/fixture/story-spec.v3.json`;

describe('cli commands', () => {
  it('lists schemas and policies', () => {
    expect(run(['schemas']).ok).toBe(true);
    const p = run(['policies']);
    expect(p.ok).toBe(true);
    expect((p.output as { ref: string }[]).map((x) => x.ref)).toEqual([
      'policy/economy@1',
      'policy/premium@1',
      'policy/standard@1',
      // loadPolicies reads the files in name order: standard.v10.json sorts before standard.v2.json.
      'policy/standard@10',
      'policy/standard@11',
      'policy/standard@12',
      'policy/standard@13',
      'policy/standard@14',
      'policy/standard@15',
      'policy/standard@16',
      'policy/standard@17',
      'policy/standard@18',
      'policy/standard@19',
      'policy/standard@2',
      'policy/standard@20',
      'policy/standard@21',
      'policy/standard@22',
      'policy/standard@23',
      'policy/standard@24',
      'policy/standard@25',
      'policy/standard@26',
      'policy/standard@27',
      'policy/standard@28',
      'policy/standard@29',
      'policy/standard@3',
      'policy/standard@30',
      'policy/standard@31',
      'policy/standard@32',
      'policy/standard@33',
      'policy/standard@34',
      'policy/standard@4',
      'policy/standard@5',
      'policy/standard@6',
      'policy/standard@7',
      'policy/standard@8',
      'policy/standard@9',
    ]);
  });

  it('validates fixture examples against their schemas', () => {
    expect(run(['validate', 'canon-delta.schema.json', delta]).ok).toBe(true);
    expect(run(['validate', 'story-intake.schema.json', delta]).ok).toBe(false);
  });

  it('measures, language-checks and verifies evidence for the fixture chapter', () => {
    const m = run(['measure', ch09]);
    expect(m.ok).toBe(true);
    expect((m.output as { words: number }).words).toBeGreaterThan(2000);
    expect(run(['language-check', ch09]).ok).toBe(true);
    const v = run(['verify-evidence', ch09, delta]);
    expect(v.ok, JSON.stringify(v.output)).toBe(true);
  });

  it('compiles the fixture identity block and lists the prompt set', () => {
    const b = run([
      'identity:compile',
      'project/0191b2a0-0000-7000-8000-000000000001@1',
      'writer_full',
    ]);
    expect(b.ok).toBe(true);
    const out = b.output as { sections: string[]; text: string };
    expect(out.sections.slice(0, 3)).toEqual([
      'header',
      'output_language_contract',
      'tradition_contract',
    ]);
    expect(out.text).toContain('## Output-Language Contract');
    const p = run(['prompts:list']);
    expect(p.ok).toBe(true);
    // 31 English lineage versions + 25 Korean v2.0.0–v2.2.5 (8 each, ADR-0054) + 25 fully Korean v3.0.0
    // (ADR-0055) + 25 Korean webnovel craft v4.0.0, the arc_planner/targeted_reviser v4.0.1 fixes, nine
    // v4.1.0 first-live-chapter versions and three v4.2.0 writer/planner versions (ADR-0056), and the two
    // schema-generated v4.3.0 output shapes (ADR-0057), six v4.4.0 evaluator versions (ADR-0060) and the
    // v4.5.0 arc summarizer (ADR-0076), and five v4.6.0 same-model judging / Gemini writer versions
    // (ADR-0081).
    expect((p.output as { versions: unknown[] }).versions).toHaveLength(318);
  });

  it('compiles the Active Constraint Set for a chapter and fails on overflow', () => {
    const r = run(['constraints:compile', '12', spec]);
    expect(r.ok).toBe(true);
    const out = r.output as { hard: string[]; excluded: { id: string }[]; content_hash: string };
    expect(out.hard).toContain('REQ-00021');
    expect(out.hard).not.toContain('REQ-00061');
    expect(out.content_hash).toMatch(/^sha256:/);
    const over = run(['constraints:compile', '12', spec, '100']);
    expect(over.ok).toBe(false);
    expect((over.output as { error: string }).error).toBe('CONSTRAINTS_OVERFLOW');
  });

  it('prints usage on unknown commands', () => {
    const r = run(['nope']);
    expect(r.ok).toBe(false);
    expect(String(r.output)).toContain('yeonjae <command>');
    expect(String(r.output)).toContain('pack:build');
  });
});
