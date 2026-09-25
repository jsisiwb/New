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
  readonly rule: 'PLAN-DLG-01' | 'PLAN-PARTNER-01';
  readonly repaired: boolean;
  readonly message: string;
}

export function applyDialogueFloor(
  scenes: readonly ScenePlan[],
  contract: Pick<ChapterContract, 'participants'>,
  floor: { readonly chapter_min: number; readonly partner_required: boolean },
): { scenes: ScenePlan[]; findings: DialogueFloorFinding[] } {
  const findings: DialogueFloorFinding[] = [];
  const raised = scenes.filter((s) => (s.dialogue_density_target ?? 0) < floor.chapter_min);
  let out = scenes.map((s) =>
    (s.dialogue_density_target ?? 0) < floor.chapter_min
      ? { ...s, dialogue_density_target: floor.chapter_min }
      : s,
  );
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
