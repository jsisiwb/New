/** Read-only overlap preflight; only an evidence-backed explicit transition may close history. */
import {
  narrativeOrd,
  type Generated,
  type StoryClock,
  type ValidationFailure,
} from '@yeonjae/domain';

type CanonDelta = Generated.CanonDeltaSchema.CanonDelta;
export interface RelationshipInterval {
  readonly id: string;
  readonly timeline_id: string;
  readonly from_entity_id: string;
  readonly to_entity_id: string;
  readonly type: string;
  readonly valid_from: StoryClock;
  readonly valid_to: StoryClock | null;
}

export function relationshipOverlapErrors(
  delta: CanonDelta,
  existing: readonly RelationshipInterval[],
  mainTimelineId: string,
): ValidationFailure[] {
  const errors: ValidationFailure[] = [];
  const intervals = existing.map((r) => ({ ...r }));
  delta.items.forEach((item, index) => {
    if (item.type !== 'relationship_state') return;
    const p = item.payload as unknown as {
      from_entity_id: string;
      to_entity_id: string;
      timeline_id?: string;
      type: string;
      valid_from: StoryClock;
      valid_to?: StoryClock;
    };
    // Follow proposal order, just like commit_delta. A later close cannot excuse an earlier overlap.
    if (item.op === 'close' || item.op === 'supersede') {
      const prior = intervals.find((r) => r.id === item.supersedes_ref);
      const end = item.op === 'close' ? item.story_clock : p.valid_from;
      if (prior && end) prior.valid_to = end;
    }
    if (!['assert', 'create', 'supersede'].includes(item.op)) return;
    const from = narrativeOrd(p.valid_from);
    const to = p.valid_to ? narrativeOrd(p.valid_to) : Number.POSITIVE_INFINITY;
    const timeline = p.timeline_id ?? mainTimelineId;
    for (const prior of intervals) {
      if (
        prior.timeline_id !== timeline ||
        prior.from_entity_id !== p.from_entity_id ||
        prior.to_entity_id !== p.to_entity_id
      )
        continue;
      const priorTo = prior.valid_to ? narrativeOrd(prior.valid_to) : Number.POSITIVE_INFINITY;
      if (from < priorTo && narrativeOrd(prior.valid_from) < to) {
        errors.push({
          path: `/items/${String(index)}`,
          keyword: 'relationship_overlap',
          message: `relationship assertion overlaps state ${JSON.stringify(prior)}. Use an explicit supersede/close with supersedes_ref only when the manuscript establishes a transition; omit an unsupported or redundant assertion. Do not rewrite earlier history.`,
        });
      }
    }
    intervals.push({
      id: `proposed:${item.local_id}`,
      timeline_id: timeline,
      from_entity_id: p.from_entity_id,
      to_entity_id: p.to_entity_id,
      type: p.type,
      valid_from: p.valid_from,
      valid_to: p.valid_to ?? null,
    });
  });
  return errors;
}
