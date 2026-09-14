import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { run } from './commands.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ch09 = `${root}examples/fixture/manuscripts/ch09.accepted.txt`;
const delta = `${root}examples/fixture/canon-delta.ch09.json`;

describe('cli commands', () => {
  it('lists schemas and policies', () => {
    expect(run(['schemas']).ok).toBe(true);
    const p = run(['policies']);
    expect(p.ok).toBe(true);
    expect((p.output as { ref: string }[]).map((x) => x.ref)).toEqual([
      'policy/economy@1',
      'policy/premium@1',
      'policy/standard@1',
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

  it('prints usage on unknown commands', () => {
    const r = run(['nope']);
    expect(r.ok).toBe(false);
    expect(String(r.output)).toContain('yeonjae <command>');
  });
});
