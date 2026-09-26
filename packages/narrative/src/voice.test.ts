/**
 * Operator voice profiles (ADR-0083, C3): shipped versions validate, are immutable, and carry Korean rule
 * lines only (no Latin letters reach a Korean prompt).
 */
import { describe, expect, it } from 'vitest';
import { loadVoiceProfiles, requireVoiceProfile } from './voice.js';

describe('operator voice profiles', () => {
  const profiles = loadVoiceProfiles();

  it('ships voice/operator@1 with writer, planner and judge lines in Korean', () => {
    expect([...profiles.keys()].sort()).toEqual([
      'voice/operator@1',
      'voice/operator@2',
      'voice/operator@3',
    ]);
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

  it('ships voice/operator@2: v1 plus the pronoun band and comic or irony cuts for judges (ADR-0088)', () => {
    const v1 = requireVoiceProfile('voice/operator@1', profiles);
    const v2 = requireVoiceProfile('voice/operator@2', profiles);
    expect(v2.planner).toEqual(v1.planner);
    expect(v2.judges.slice(0, v1.judges.length)).toEqual(v1.judges);
    expect(v2.judges.length).toBe(v1.judges.length + 2);
    expect(v2.judges.join('\n')).toContain('상위 10%가 2.6회');
    expect(v2.judges.join('\n')).toContain('착각의 아이러니');
    for (const line of [...v2.writer, ...v2.judges]) expect(line).not.toMatch(/[A-Za-z]/);
  });

  it('ships voice/operator@3: v2 with the heroine formula bounded by the reveal schedule (ADR-0092)', () => {
    const v2 = requireVoiceProfile('voice/operator@2', profiles);
    const v3 = requireVoiceProfile('voice/operator@3', profiles);
    expect(v3.writer).toEqual(v2.writer);
    expect(v3.judges).toEqual(v2.judges);
    expect(v3.planner.length).toBe(v2.planner.length);
    const changed = v3.planner.filter((line, i) => line !== v2.planner[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('공개 일정이 독자에게 허락한 것만');
    expect(changed[0]).not.toContain('운명이나 비밀');
    for (const line of v3.planner) expect(line).not.toMatch(/[A-Za-z]/);
  });

  it('rejects an unknown ref', () => {
    expect(() => requireVoiceProfile('voice/operator@9', profiles)).toThrow(
      /unknown voice profile/,
    );
  });
});
