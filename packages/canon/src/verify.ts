/**
 * Deterministic delta verification (docs/04-memory-canon/02 §5.3). Runs before the database so that a bad
 * proposal is rejected with a precise, item-level diagnosis instead of a rolled-back transaction. The
 * database enforces the same rules again; this layer never replaces that boundary.
 */
import { narrativeOrd, type StoryClock, validatorFor, type Generated } from '@yeonjae/domain';

type CanonDelta = Generated.CanonDeltaSchema.CanonDelta;
import { type NfcText, verifyEvidence } from '@yeonjae/prose';

export type CommitSource =
  | 'bible'
  | 'chapter_acceptance'
  | 'user_correction'
  | 'retcon'
  | 'rollback'
  | 'merge_entities'
  | 'regeneration';

export interface VerifyContext {
  readonly source: CommitSource;
  /** NFC text per manuscript_version_id the delta may cite; versions not present cannot be verified. */
  readonly manuscripts: ReadonlyMap<string, NfcText>;
  /** Statuses per manuscript version id; evidence may cite only immutable statuses. */
  readonly manuscriptStatus?: ReadonlyMap<string, string> | undefined;
  /** timeline id → kind; default timeline is `main`. */
  readonly timelines: ReadonlyMap<string, 'main' | 'prior_loop' | 'alternate' | 'source_story'>;
  readonly mainTimelineId: string;
  /** Latest story clock of the chapter: no validity may start after it (planned ≠ happened). */
  readonly clockMax?: StoryClock | undefined;
  /** Known entity ids; unknown ids must be introduced by an `entity/create` item in the same delta. */
  readonly knownEntityIds?: ReadonlySet<string> | undefined;
}

export interface VerificationIssue {
  readonly code:
    | 'SCHEMA_INVALID'
    | 'EVIDENCE_MISMATCH'
    | 'EVIDENCE_REQUIRED'
    | 'EVIDENCE_UNVERIFIABLE'
    | 'ILLEGAL_OP'
    | 'FRAME_VIOLATION'
    | 'FUTURE_VALIDITY'
    | 'UNKNOWN_ENTITY'
    | 'PLAN_FRAME';
  readonly item?: string | undefined;
  readonly detail: string;
}

export interface VerificationResult {
  readonly ok: boolean;
  readonly issues: readonly VerificationIssue[];
}

const FACT_BEARING_FRAMES = new Set([
  'canonical',
  'flashback',
  'prior_loop',
  'alternate_timeline',
  'source_story',
]);
const FRAME_FOR_KIND: Record<string, string> = {
  prior_loop: 'prior_loop',
  alternate: 'alternate_timeline',
  source_story: 'source_story',
};

export function verifyDelta(input: unknown, ctx: VerifyContext): VerificationResult {
  const issues: VerificationIssue[] = [];
  const schema = validatorFor<CanonDelta>('canon-delta.schema.json')(input);
  if (!schema.ok) {
    for (const e of schema.errors)
      issues.push({ code: 'SCHEMA_INVALID', detail: `${e.path}: ${e.message}` });
    return { ok: false, issues };
  }
  const delta = schema.value;
  const transitionOnly = ctx.source === 'chapter_acceptance' || ctx.source === 'bible';
  const introduced = new Set<string>();
  const clockMax = ctx.clockMax ? narrativeOrd(ctx.clockMax) : undefined;

  for (const item of delta.items) {
    const id = item.local_id;
    const payload = item.payload as unknown as Record<string, unknown>;

    if (item.op === 'retract' && transitionOnly) {
      issues.push({
        code: 'ILLEGAL_OP',
        item: id,
        detail: `retract is not a story transition; ${ctx.source} commits may only assert/close/supersede (ADR-0038)`,
      });
    }
    if (item.frame === 'plan' || item.frame === 'non_canonical_draft') {
      issues.push({
        code: 'PLAN_FRAME',
        item: id,
        detail: `frame ${item.frame} never enters canon`,
      });
    }
    if (item.type === 'fact' && !FACT_BEARING_FRAMES.has(item.frame)) {
      issues.push({
        code: 'FRAME_VIOLATION',
        item: id,
        detail: `facts cannot come from frame ${item.frame}`,
      });
    }
    if (item.type === 'fact' || item.type === 'event') {
      const timeline =
        typeof payload.timeline_id === 'string' ? payload.timeline_id : ctx.mainTimelineId;
      const kind = ctx.timelines.get(timeline);
      if (!kind) {
        issues.push({ code: 'FRAME_VIOLATION', item: id, detail: `unknown timeline ${timeline}` });
      } else {
        const required = FRAME_FOR_KIND[kind];
        if (
          required &&
          item.frame !== required &&
          item.type === 'fact' &&
          item.frame !== 'canonical' &&
          item.frame !== 'flashback'
        ) {
          issues.push({
            code: 'FRAME_VIOLATION',
            item: id,
            detail: `frame ${item.frame} on a ${kind} timeline`,
          });
        }
        if (
          ['prior_loop', 'alternate_timeline', 'source_story'].includes(item.frame) &&
          required !== item.frame
        ) {
          issues.push({
            code: 'FRAME_VIOLATION',
            item: id,
            detail: `frame ${item.frame} is legal only on a ${item.frame === 'alternate_timeline' ? 'alternate' : item.frame} timeline (this one is ${kind})`,
          });
        }
      }
    }
    if (clockMax !== undefined && (item.op === 'assert' || item.op === 'supersede')) {
      const vf = payload.valid_from as StoryClock | undefined;
      if (vf && narrativeOrd(vf) > clockMax) {
        issues.push({
          code: 'FUTURE_VALIDITY',
          item: id,
          detail: `valid_from ${vf.chapter_no}.${vf.ordinal} is after the chapter's story time (planned ≠ happened)`,
        });
      }
    }
    // ADR-0105: a stored fact needs its clock; acceptance fills it from the item's, so only a fact with neither lands here.
    if (
      item.type === 'fact' &&
      (item.op === 'assert' || item.op === 'supersede') &&
      payload.valid_from === undefined
    )
      issues.push({
        code: 'SCHEMA_INVALID',
        item: id,
        detail: 'an asserted fact needs valid_from (or a story_clock to take it from)',
      });
    if (item.type === 'entity' && item.op === 'create') introduced.add(id);
    if (ctx.knownEntityIds) {
      for (const key of ['entity_id', 'from_entity_id', 'to_entity_id', 'location_id']) {
        const v = payload[key];
        if (typeof v === 'string' && !ctx.knownEntityIds.has(v)) {
          issues.push({
            code: 'UNKNOWN_ENTITY',
            item: id,
            detail: `${key} ${v} is not a known entity and no entity/create item introduces it`,
          });
        }
      }
    }
    // Evidence: extracted rows need ≥ 1 span; each span must verify against the cited immutable version.
    const needsEvidence =
      (ctx.source === 'chapter_acceptance' || ctx.source === 'retcon') &&
      (item.op === 'assert' || item.op === 'supersede' || item.op === 'pay');
    if (needsEvidence && item.evidence.length === 0) {
      issues.push({
        code: 'EVIDENCE_REQUIRED',
        item: id,
        detail: 'extracted items need at least one evidence span',
      });
    }
    for (const [i, ev] of item.evidence.entries()) {
      const status = ctx.manuscriptStatus?.get(ev.manuscript_version_id);
      if (
        status !== undefined &&
        !['approved', 'accepted', 'superseded', 'retconned'].includes(status)
      ) {
        issues.push({
          code: 'EVIDENCE_MISMATCH',
          item: id,
          detail: `evidence[${i}] cites a ${status} version; only immutable versions may be cited`,
        });
        continue;
      }
      const text = ctx.manuscripts.get(ev.manuscript_version_id);
      if (!text) {
        issues.push({
          code: 'EVIDENCE_UNVERIFIABLE',
          item: id,
          detail: `evidence[${i}] cites manuscript ${ev.manuscript_version_id} which was not supplied`,
        });
        continue;
      }
      const verdict = verifyEvidence(text, {
        start: ev.start,
        end: ev.end,
        quote: ev.quote,
        quoteHash: ev.quote_hash,
      });
      if (!verdict.ok)
        issues.push({
          code: 'EVIDENCE_MISMATCH',
          item: id,
          detail: `evidence[${i}] ${verdict.reason}: ${verdict.detail}`,
        });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function summarizeItems(delta: CanonDelta): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of delta.items) out[item.type] = (out[item.type] ?? 0) + 1;
  return out;
}
