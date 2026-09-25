import { describe, expect, it } from 'vitest';
import { calibrateSceneTarget } from './length-calibration.js';

const CAL = { request_ratio: 0.8, redistribute: true, min_ratio: 0.5, max_ratio: 1.3 };

describe('scene length calibration (ADR-0075, K3)', () => {
  it('asks the first scene for request_ratio × its target', () => {
    expect(calibrateSceneTarget([1700, 1800, 1800], 0, [], CAL)).toEqual({
      requested: 1360,
      redistributed: 1700,
      factor: 1,
    });
  });

  it('absorbs an earlier overshoot in the remaining scenes', () => {
    // The live chapter-1 overshoot on scene 1 (2,293자 against 1,700) leaves 3,007 for the last 3,600.
    const r = calibrateSceneTarget([1700, 1800, 1800], 1, [2293], CAL);
    expect(r.factor).toBeCloseTo(3007 / 3600, 6);
    expect(r.redistributed).toBe(Math.round(1800 * (3007 / 3600)));
    expect(r.requested).toBe(Math.round(r.redistributed * 0.8));
  });

  it('gives an undershoot back to the remaining scenes, up to max_ratio', () => {
    const r = calibrateSceneTarget([1000, 1000], 1, [200], CAL);
    expect(r.factor).toBe(1.3);
    expect(r.redistributed).toBe(1300);
  });

  it('never asks for less than min_ratio of the plan, even after a runaway scene', () => {
    const r = calibrateSceneTarget([1700, 1800, 1800], 2, [4000, 3000], CAL);
    expect(r.factor).toBe(0.5);
    expect(r.requested).toBe(720);
  });

  it('without redistribute only the request ratio applies', () => {
    const r = calibrateSceneTarget([1700, 1800], 1, [9999], { ...CAL, redistribute: false });
    expect(r).toEqual({ requested: 1440, redistributed: 1800, factor: 1 });
  });

  it('simulated on the live overshoot profile, the chapter lands near its planned total', () => {
    // Each scene overshoots what it is asked for by the live profile's ratios (+35 %, +9 %, +37 %).
    const targets = [1700, 1800, 1800];
    const overshoot = [1.35, 1.09, 1.37];
    const measured: number[] = [];
    for (let i = 0; i < targets.length; i++)
      measured.push(
        Math.round(calibrateSceneTarget(targets, i, measured, CAL).requested * (overshoot[i] ?? 1)),
      );
    const total = measured.reduce((a, b) => a + b, 0);
    // Uncalibrated the same profile gives 6,717 (+27 %); calibrated it stays inside the 12 % warn band.
    expect(Math.abs(total / 5300 - 1)).toBeLessThan(0.12);
  });
});
