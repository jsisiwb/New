import { describe, expect, it } from 'vitest';
import { asUuid, isUuid, uuidv7, uuidv7Time } from './ids.js';

describe('UUIDv7', () => {
  it('generates RFC-shaped, time-ordered ids', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a.charAt(14)).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(a.charAt(19));
    expect(uuidv7Time(a)).toBe(1_700_000_000_000);
    expect(a < b).toBe(true);
  });

  it('stays monotonic within one millisecond', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7(1_700_000_000_500));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(50);
  });

  it('rejects malformed ids', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(() => asUuid('0191b2a0-0000-7000-8000-00000000000g')).toThrow(TypeError);
    expect(isUuid('0191b2a0-0000-7000-8000-000000000001')).toBe(true);
  });
});
