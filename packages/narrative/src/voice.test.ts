/**
 * Operator voice profiles (ADR-0083, C3): shipped versions validate, are immutable, and carry Korean rule
 * lines only (no Latin letters reach a Korean prompt).
 */
import { describe, expect, it } from 'vitest';
import { loadVoiceProfiles, requireVoiceProfile } from './voice.js';

describe('operator voice profiles', () => {
  const profiles = loadVoiceProfiles();

  it('ships voice/operator@1 with writer, planner and judge lines in Korean', () => {
    expect([...profiles.keys()]).toEqual(['voice/operator@1']);
    const v = requireVoiceProfile('voice/operator@1', profiles);
    expect(v.language).toBe('ko');
    expect(v.writer.length).toBeGreaterThanOrEqual(10);
    expect(v.planner.length).toBeGreaterThanOrEqual(5);
    expect(v.judges.length).toBeGreaterThanOrEqual(5);
    for (const line of [...v.writer, ...v.planner, ...v.judges])
      expect(line).not.toMatch(/[A-Za-z]/);
    // The measured bands the analysis found are stated, not invented: first-person median 23 %.
    expect(v.writer.join('\n')).toContain('중앙값 23%');
  });

  it('rejects an unknown ref', () => {
    expect(() => requireVoiceProfile('voice/operator@9', profiles)).toThrow(
      /unknown voice profile/,
    );
  });
});
