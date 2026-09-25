import { describe, expect, it } from 'vitest';
import { PromptRegistry } from '@yeonjae/prompts';
import { projectCost, promptSizes } from './ops-tools.js';

describe('operator tools (ADR-0079)', () => {
  it('projects the audit: the story plan once, plus the mean chapter times N', () => {
    const p = projectCost(
      [
        {
          chapter_no: null,
          calls: 9,
          input_tokens: 30_000,
          output_tokens: 12_000,
          latency_ms: 450_000,
        },
        {
          chapter_no: 1,
          calls: 40,
          input_tokens: 150_000,
          output_tokens: 20_000,
          latency_ms: 1_800_000,
        },
        {
          chapter_no: 2,
          calls: 30,
          input_tokens: 110_000,
          output_tokens: 16_000,
          latency_ms: 1_200_000,
        },
      ],
      200,
    );
    expect(p.chapters_observed).toBe(2);
    expect(p.plan).toEqual({ calls: 9, input_tokens: 30_000, output_tokens: 12_000 });
    expect(p.per_chapter).toEqual({
      calls: 35,
      input_tokens: 130_000,
      output_tokens: 18_000,
      model_minutes: 25,
    });
    expect(p.projected).toEqual({
      chapters: 200,
      calls: 9 + 35 * 200,
      input_tokens: 30_000 + 130_000 * 200,
      output_tokens: 12_000 + 18_000 * 200,
      model_hours: Math.round(((450_000 + 1_500_000 * 200) / 3_600_000) * 10) / 10,
    });
  });

  it('projects nothing per chapter before any chapter ran', () => {
    const p = projectCost(
      [{ chapter_no: null, calls: 3, input_tokens: 10, output_tokens: 5, latency_ms: 60_000 }],
      10,
    );
    expect(p.per_chapter.calls).toBe(0);
    expect(p.projected.calls).toBe(3);
  });

  it('sizes every active prompt, largest first', () => {
    const reg = PromptRegistry.fromDirectory();
    const sizes = promptSizes(reg);
    expect(sizes.map((s) => s.family).sort()).toEqual(Object.keys(reg.activeSet().mapping).sort());
    for (let i = 1; i < sizes.length; i++)
      expect(sizes[i - 1]?.est_tokens ?? 0).toBeGreaterThanOrEqual(sizes[i]?.est_tokens ?? 0);
    // The active set is the Korean one: measured with the Korean estimator.
    expect(new Set(sizes.map((s) => s.estimator))).toEqual(new Set(['korean_chars_v1']));
    expect(sizes.every((s) => s.est_tokens > 0)).toBe(true);
  });
});
