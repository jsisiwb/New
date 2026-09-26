/**
 * The scene plan's dialogue floor (ADR-0084, U6; live defect G3-2). A chapter planned with its POV character
 * alone, or with scenes planned at a tenth of the operator's talk share, cannot be revised into a scene with
 * an exchange; the plan is the place to fix it. Deterministic: targets below the floor are raised, and when no
 * scene puts anyone beside its POV character, the longest scene gets the contract's first on-page participant
 * who is not that POV character.
 */
import { type Generated } from '@yeonjae/domain';

type ScenePlan = Generated.ScenePlanSchema.ScenePlan;
type ChapterContract = Generated.ChapterContractSchema.ChapterContract;

export interface DialogueFloorFinding {
  readonly rule: 'PLAN-DLG-01' | 'PLAN-DLG-04' | 'PLAN-PARTNER-01';
  readonly repaired: boolean;
  readonly message: string;
}

/** A scene with no one beside its POV character on stage. */
export function isSoloScene(s: Pick<ScenePlan, 'participants' | 'pov'>): boolean {
  return !s.participants.some((p) => p !== s.pov.character_id);
}

export function applyDialogueFloor(
  scenes: readonly ScenePlan[],
  contract: Pick<ChapterContract, 'participants'>,
  floor: {
    readonly chapter_min: number;
    readonly partner_required: boolean;
    readonly solo_scenes?: boolean | undefined;
    readonly solo_max?: number | undefined;
  },
): { scenes: ScenePlan[]; findings: DialogueFloorFinding[] } {
  if (floor.solo_scenes === true) return applySoloAwareFloor(scenes, contract, floor);
  const findings: DialogueFloorFinding[] = [];
  const raised = scenes.filter((s) => (s.dialogue_density_target ?? 0) < floor.chapter_min);
  const out = scenes.map((s) =>
    (s.dialogue_density_target ?? 0) < floor.chapter_min
      ? { ...s, dialogue_density_target: floor.chapter_min }
      : s,
  );
  return withPartner(out, contract, floor, findings, raised);
}

/**
 * ADR-0110 (G7-4): a scene with no one beside its POV character cannot carry an exchange, so it is not raised to the
 * floor: its target is the planner's, at most `solo_max` (속마음 only). The scenes with a partner carry the chapter's
 * floor instead: each is raised to the floor, then all of them together until the length-weighted share of the chapter
 * reaches it (at most 0.6 each).
 */
function applySoloAwareFloor(
  scenes: readonly ScenePlan[],
  contract: Pick<ChapterContract, 'participants'>,
  floor: {
    readonly chapter_min: number;
    readonly partner_required: boolean;
    readonly solo_max?: number | undefined;
  },
): { scenes: ScenePlan[]; findings: DialogueFloorFinding[] } {
  const findings: DialogueFloorFinding[] = [];
  const soloMax = floor.solo_max ?? 0.05;
  // A partner is placed first, so a scene given one is not treated as solo.
  const staged = withPartner([...scenes], contract, floor, findings, []).scenes;
  const solos = staged.filter(isSoloScene);
  let out = staged.map((s) =>
    isSoloScene(s)
      ? { ...s, dialogue_density_target: Math.min(s.dialogue_density_target ?? 0, soloMax) }
      : {
          ...s,
          dialogue_density_target: Math.max(s.dialogue_density_target ?? 0, floor.chapter_min),
        },
  );
  const len = (s: ScenePlan) => s.length_target.value;
  const total = out.reduce((n, s) => n + len(s), 0);
  const pairedLength = out.filter((s) => !isSoloScene(s)).reduce((n, s) => n + len(s), 0);
  const talk = out.reduce((n, s) => n + len(s) * s.dialogue_density_target, 0);
  if (pairedLength > 0 && total > 0 && talk / total < floor.chapter_min) {
    const soloTalk = out
      .filter(isSoloScene)
      .reduce((n, s) => n + len(s) * s.dialogue_density_target, 0);
    const needed = Math.min(0.6, (floor.chapter_min * total - soloTalk) / pairedLength);
    out = out.map((s) =>
      isSoloScene(s) || s.dialogue_density_target >= needed
        ? s
        : { ...s, dialogue_density_target: Math.round(needed * 1000) / 1000 },
    );
  }
  const raised = out.filter((s, i) => {
    const before = staged[i];
    return !isSoloScene(s) && s.dialogue_density_target > (before?.dialogue_density_target ?? 0);
  });
  if (raised.length > 0)
    findings.push({
      rule: 'PLAN-DLG-01',
      repaired: true,
      message: `scenes ${raised.map((s) => String(s.scene_no)).join(', ')} with a partner raised so the chapter's talk reaches the floor ${String(floor.chapter_min)}`,
    });
  if (solos.length > 0)
    findings.push({
      rule: 'PLAN-DLG-04',
      repaired: true,
      message: `scenes ${solos.map((s) => String(s.scene_no)).join(', ')} have no one beside their POV character; their talk target is at most ${String(soloMax)} and the scenes with a partner carry the floor`,
    });
  return { scenes: out, findings };
}

function withPartner(
  scenes: ScenePlan[],
  contract: Pick<ChapterContract, 'participants'>,
  floor: { readonly chapter_min: number; readonly partner_required: boolean },
  findings: DialogueFloorFinding[],
  raised: readonly ScenePlan[],
): { scenes: ScenePlan[]; findings: DialogueFloorFinding[] } {
  let out = scenes;
  if (raised.length > 0)
    findings.push({
      rule: 'PLAN-DLG-01',
      repaired: true,
      message: `scenes ${raised.map((s) => String(s.scene_no)).join(', ')} planned below the dialogue floor ${String(floor.chapter_min)}; raised to it`,
    });
  const hasPartner = out.some((s) => s.participants.some((p) => p !== s.pov.character_id));
  if (floor.partner_required && !hasPartner && out.length > 0) {
    const longest = out.reduce((a, s) => (s.length_target.value > a.length_target.value ? s : a));
    const partner = contract.participants.find(
      (p) => p.on_page && p.character_id !== longest.pov.character_id,
    );
    if (partner) {
      out = out.map((s) =>
        s === longest ? { ...s, participants: [...s.participants, partner.character_id] } : s,
      );
      findings.push({
        rule: 'PLAN-PARTNER-01',
        repaired: true,
        message: `no scene had anyone beside its POV character; scene ${String(longest.scene_no)} now includes an on-page contract participant`,
      });
    } else
      findings.push({
        rule: 'PLAN-PARTNER-01',
        repaired: false,
        message:
          'no scene has anyone beside its POV character and the contract puts no one else on page',
      });
  }
  return { scenes: out, findings };
}
