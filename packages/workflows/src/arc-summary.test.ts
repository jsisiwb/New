import { describe, expect, it } from 'vitest';
import { clampSummary } from './arc-summary.js';

describe('clampSummary (ADR-0076)', () => {
  // Synthetic test strings (two short sentences), not manuscript prose.
  const text = '문이 열렸다. 그가 들어왔다.';

  it('keeps a summary within the limit as it is', () => {
    expect(clampSummary(text, 100)).toEqual({ text, truncated: false });
  });

  it('cuts at the last sentence end within the limit, counting code points', () => {
    expect(clampSummary(text, 12)).toEqual({ text: '문이 열렸다.', truncated: true });
  });

  it('cuts at the limit when no sentence ends inside it', () => {
    expect(clampSummary(text, 4)).toEqual({ text: '문이 열', truncated: true });
  });
});
