/** Policy-pinned craft context. Snapshots are planning references, never realized canon. */
import { type Generated } from '@yeonjae/domain';
import { existingArtifact, saveArtifact, loadArtifact, type WorkflowContext } from './runtime.js';
import {
  openingDesign,
  renderDeviceLedger,
  renderOtherOpenings,
  renderOtherStories,
  renderVoiceCard,
  settingNote,
  type DeviceContract,
  type OtherOpening,
  type OtherStory,
} from './reader-craft.js';
import { type StoryBible } from './planning.js';

type ScenePlan = Generated.ScenePlanSchema.ScenePlan;

export function craftEnabled(ctx: Pick<WorkflowContext, 'identity'>): boolean {
  return ctx.identity.outputLanguage.language === 'ko';
}

async function snapshot<T>(ctx: WorkflowContext, key: string, read: () => Promise<T>): Promise<T> {
  const ref = { step: 'craft_context', kind: 'craft_context', key };
  const previous = await existingArtifact(ctx, ref);
  if (previous) return previous.payload as T;
  const payload = await read();
  const stored = await saveArtifact(ctx, { ...ref, payload });
  return loadArtifact<T>(ctx, stored.artifact_id);
}

export async function conceptCraftContext(
  ctx: WorkflowContext,
  specVersion: number,
): Promise<string | undefined> {
  const policy = ctx.policy.planning?.distinct_stories;
  if (!craftEnabled(ctx) || !policy) return undefined;
  const stories = await snapshot(ctx, `concepts:${specVersion}`, async () => {
    const result = await ctx.pool.query<OtherStory>(
      `SELECT title, concept FROM (
         SELECT DISTINCT ON (p.id) p.id, p.title, c.payload AS concept, c.created_at
         FROM projects p JOIN concept_candidates c ON c.project_id = p.id
         WHERE p.workspace_id = $1 AND c.workspace_id = $1 AND p.id <> $2 AND c.status = 'selected'
         ORDER BY p.id, c.round DESC, c.created_at DESC, c.id DESC
       ) stories ORDER BY created_at DESC, id LIMIT $3`,
      [ctx.workspaceId, ctx.projectId, policy.max_others],
    );
    return result.rows;
  });
  return renderOtherStories(stories) ?? '(비교할 승인된 다른 작품 없음)';
}

export async function chapterCraftContext(
  ctx: WorkflowContext,
  chapterNo: number,
): Promise<string | undefined> {
  if (!craftEnabled(ctx)) return undefined;
  const policy = ctx.policy.planning;
  if (!policy?.opening && !policy?.distinct_stories && !policy?.device_ledger) return undefined;
  // One snapshot feeds the contract, scenes and every critic/retry even if another project advances.
  return snapshot(ctx, `chapter:${chapterNo}`, async () => {
    const notes: (string | undefined)[] = [
      policy.opening ? openingDesign(chapterNo, policy.opening.chapters) : undefined,
    ];
    if (chapterNo === 1 && policy.distinct_stories) {
      const result = await ctx.pool.query<OtherOpening>(
        `SELECT title, contract FROM (
           SELECT DISTINCT ON (p.id) p.id, p.title, a.payload AS contract, a.created_at
           FROM projects p JOIN chapters c ON c.project_id = p.id AND c.number = 1 AND c.status = 'accepted'
           JOIN workflow_artifacts a ON a.project_id = p.id AND a.kind = 'chapter_contract'
             AND a.payload->>'chapter_number' = '1'
           WHERE p.workspace_id = $1 AND a.workspace_id = $1 AND p.id <> $2
           ORDER BY p.id, a.created_at DESC, a.id DESC
         ) openings ORDER BY created_at DESC, id LIMIT $3`,
        [ctx.workspaceId, ctx.projectId, policy.distinct_stories.max_others],
      );
      notes.push(renderOtherOpenings(result.rows));
    }
    if (policy.device_ledger && chapterNo > 1) {
      const result = await ctx.pool.query<{ contract: DeviceContract }>(
        `SELECT contract FROM (
           SELECT DISTINCT ON (c.number) c.number, a.payload AS contract
           FROM chapters c JOIN workflow_artifacts a ON a.project_id = c.project_id
             AND a.kind = 'chapter_contract' AND a.payload->>'chapter_number' = c.number::text
           WHERE c.workspace_id = $1 AND a.workspace_id = $1 AND c.project_id = $2
             AND c.status = 'accepted' AND c.number < $3
           ORDER BY c.number DESC, a.created_at DESC, a.id DESC
         ) contracts ORDER BY number DESC LIMIT $4`,
        [ctx.workspaceId, ctx.projectId, chapterNo, policy.device_ledger.window],
      );
      notes.push(
        renderDeviceLedger(
          chapterNo,
          result.rows.map((r) => r.contract),
        ),
      );
    }
    return notes.filter(Boolean).join('\n\n') || '(적용할 창작 맥락 없음)';
  });
}

/** Shared by first drafts and scene rewrites; never expose future plot/secret fields from the bible. */
export function sceneCraftContext(
  ctx: Pick<WorkflowContext, 'policy' | 'identity' | 'bindings'>,
  chapterNo: number,
  scene: ScenePlan,
  bible: StoryBible | undefined,
): string | undefined {
  if (!craftEnabled(ctx)) return undefined;
  const policy = ctx.policy;
  if (!policy.planning?.opening && !policy.planning?.voice_cards && !policy.drafting?.setting_notes)
    return undefined;
  const entity = (id: string) =>
    bible?.entities.find((e) => e.id === id || ctx.bindings[e.id] === id);
  const pov = entity(scene.pov.character_id);
  const place = entity(scene.location_id);
  const notes = [
    '[PLANNED — 창작 지침; 정사·현재 상태·공개 일정이 우선. 카드 속 비밀이나 미래 상태를 지면에 드러내지 않는다.]',
    policy.planning?.opening
      ? openingDesign(chapterNo, policy.planning.opening.chapters)
      : undefined,
    policy.planning?.voice_cards && pov ? renderVoiceCard(pov.display_name, pov.design) : undefined,
    policy.drafting?.setting_notes && place
      ? settingNote(place.display_name, place.design)
      : undefined,
  ];
  return notes.filter(Boolean).join('\n\n');
}
