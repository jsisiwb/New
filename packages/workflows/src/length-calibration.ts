/**
 * Scene length calibration (ADR-0075, K3). Live Korean drafts overshoot their scene targets (chapter 1 on
 * `standard.v7`: +35 %, +9 %, +37 % — 6,717자 against 5,300). The scene plan keeps its target and evaluation
 * still measures the chapter against the contract; only the length the writer is ASKED for changes:
 *
 * - `request_ratio` × the scene's target (the model's systematic overshoot), and
 * - with `redistribute`, the remaining scenes' targets are rescaled by the chapter's remaining budget — the
 *   planned total minus what the earlier scenes of this chapter measured — so one long scene is absorbed by
 *   the scenes after it instead of pushing the chapter over.
 *
 * Pure and deterministic: it reads only the plan and the measured lengths of this chapter's earlier scenes.
 */

export interface SceneCalibration {
  readonly request_ratio: number;
  readonly redistribute: boolean;
  readonly min_ratio: number;
  readonly max_ratio: number;
}

export interface CalibratedTarget {
  /** What the writer is asked for, in the plan's unit. */
  readonly requested: number;
  /** The scene's target after redistribution, before `request_ratio`. */
  readonly redistributed: number;
  /** The rescale factor applied by redistribution (1 without it). */
  readonly factor: number;
}

/**
 * @param targets every scene's planned target, in order
 * @param index the scene being drafted (0-based)
 * @param measured the measured lengths of scenes 0..index−1, in the same unit
 */
export function calibrateSceneTarget(
  targets: readonly number[],
  index: number,
  measured: readonly number[],
  cal: SceneCalibration,
): CalibratedTarget {
  const target = targets[index];
  if (target === undefined) throw new RangeError(`no scene target at index ${index}`);
  let factor = 1;
  if (cal.redistribute && index > 0) {
    const planned = targets.reduce((a, b) => a + b, 0);
    const drafted = measured.slice(0, index).reduce((a, b) => a + b, 0);
    const remaining = targets.slice(index).reduce((a, b) => a + b, 0);
    if (remaining > 0)
      factor = Math.min(cal.max_ratio, Math.max(cal.min_ratio, (planned - drafted) / remaining));
  }
  const redistributed = Math.round(target * factor);
  return {
    requested: Math.max(1, Math.round(redistributed * cal.request_ratio)),
    redistributed,
    factor,
  };
}
