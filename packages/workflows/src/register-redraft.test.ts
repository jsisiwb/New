/** ADR-0111 (G16-2): a scene that mixes 존대 and 반말 inside quotations beyond the operator's p90 is re-drafted once. */
import { describe, expect, it } from 'vitest';
import { registerMixAllowance, registerRedraftNote } from './drafting.js';

describe('register re-draft (ADR-0111)', () => {
  it('allows the operator p90 per 1,000자 for the scene’s length, at least one', () => {
    expect(registerMixAllowance('가'.repeat(1000), 0.725)).toBe(1);
    expect(registerMixAllowance('가'.repeat(2800), 0.725)).toBe(2);
    expect(registerMixAllowance('가'.repeat(400), 0.725)).toBe(1);
    // Line breaks are not counted.
    expect(registerMixAllowance(`${'가'.repeat(1400)}\n\n${'가'.repeat(1400)}`, 0.725)).toBe(2);
  });

  it('names the mixed utterances and the one-level rule, in Korean only', () => {
    const note = registerRedraftNote([{ quote: '“팔십이에요. 낼 돈은 있고?”' }]);
    expect(note).toContain('“팔십이에요. 낼 돈은 있고?”');
    expect(note).toContain('같은 상대에게는 한 말높이로만 말한다');
    expect(note).not.toMatch(/[A-Za-z]/u);
    const many = registerRedraftNote(
      Array.from({ length: 12 }, (_, i) => ({ quote: `“${String(i)}번이에요. 가.”` })),
    );
    expect(many.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(8);
  });
});
