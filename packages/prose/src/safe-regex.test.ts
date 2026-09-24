import { describe, expect, it } from 'vitest';
import { compileModelPattern, MAX_MODEL_PATTERN_LENGTH } from './safe-regex.js';

describe('compileModelPattern (ADR-0057)', () => {
  it('compiles a valid pattern as a regex', () => {
    const p = compileModelPattern('레온(은|이) 죽', 'i');
    expect(p.valid).toBe(true);
    expect(p.re.test('그때 레온은 죽었다')).toBe(true);
  });

  it('matches an invalid pattern literally instead of throwing', () => {
    const p = compileModelPattern('(배신', 'i');
    expect(p.valid).toBe(false);
    expect(p.reason).toBe('invalid_syntax');
    expect(p.re.test('그는 (배신을 결심했다')).toBe(true);
    expect(p.re.test('배신')).toBe(false);
  });

  it('matches an oversized pattern literally', () => {
    const long = `(${'a|'.repeat(MAX_MODEL_PATTERN_LENGTH)}b)`;
    const p = compileModelPattern(long);
    expect(p).toMatchObject({ valid: false, reason: 'too_long' });
    expect(() => p.re.test('aaaa')).not.toThrow();
  });
});
