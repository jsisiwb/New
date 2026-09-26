/**
 * Chapter acceptance orchestration: the last mile from an approval-locked manuscript version and a verified
 * delta to the atomic commit. Steps are idempotent by construction: re-running with the same parent version
 * either commits once or fails with STALE_CANON.
 *
 * The commit's parent version is the delta's own `base_canon_version` — the version the extraction was
 * performed against — never the project's current version. Re-reading the current version would make the
 * optimistic check compare a value with itself, so a commit that landed between extraction and acceptance
 * would be absorbed silently instead of raising STALE_CANON (found by the B-6-2 racing-commit test).
 */
import {
  commitDelta,
  getManuscriptVersion,
  type CommitResult,
  type LeaseClaim,
  type Pool,
} from '@yeonjae/db';
import { type StoryClock } from '@yeonjae/domain';
import { toNfcText } from '@yeonjae/prose';
import { verifyDelta, type VerificationIssue, type VerifyContext } from './verify.js';

export class DeltaRejectedError extends Error {
  constructor(readonly issues: readonly VerificationIssue[]) {
    super(
      `canon delta rejected: ${issues.map((i) => `${i.code}${i.item ? `[${i.item}]` : ''} ${i.detail}`).join('; ')}`,
    );
    this.name = 'DeltaRejectedError';
  }
}

export interface AcceptChapterInput {
  readonly projectId: string;
  readonly chapterId: string;
  readonly manuscriptVersionId: string;
  readonly delta: unknown;
  readonly actor?: Record<string, unknown> | undefined;
  readonly clockMax?: StoryClock | undefined;
  readonly timelines: VerifyContext['timelines'];
  readonly mainTimelineId: string;
  readonly knownEntityIds?: ReadonlySet<string> | undefined;
  /**
   * The target lease the accepting run holds, when it has one. Threaded straight through to `commitDelta`
   * so the fence is asserted in the commit's own transaction — the only placement that actually prevents a
   * fenced-out worker from accepting, since any earlier check can be overtaken before the commit runs.
   */
  readonly lease?: LeaseClaim | undefined;
}

/** Verify (deterministically) then commit atomically. Acceptance is set by the commit, never here. */
export async function acceptChapter(pool: Pool, input: AcceptChapterInput): Promise<CommitResult> {
  const version = await getManuscriptVersion(pool, input.manuscriptVersionId);
  if (!version) throw new Error(`manuscript version ${input.manuscriptVersionId} not found`);
  if (version.status !== 'approved') {
    throw new DeltaRejectedError([
      {
        code: 'ILLEGAL_OP',
        detail: `extraction reads only approval-locked versions; this one is ${version.status}`,
      },
    ]);
  }
  const manuscripts = new Map([[version.id, toNfcText(version.text)]]);
  const statuses = new Map([[version.id, version.status]]);
  const delta = withFactClocks(input.delta);
  const verdict = verifyDelta(delta, {
    source: 'chapter_acceptance',
    manuscripts,
    manuscriptStatus: statuses,
    timelines: input.timelines,
    mainTimelineId: input.mainTimelineId,
    clockMax: input.clockMax,
    knownEntityIds: input.knownEntityIds,
  });
  if (!verdict.ok) throw new DeltaRejectedError(verdict.issues);
  const base = (delta as { base_canon_version?: unknown }).base_canon_version;
  if (typeof base !== 'number' || !Number.isInteger(base) || base < 0)
    throw new DeltaRejectedError([
      {
        code: 'ILLEGAL_OP',
        detail: `delta carries no integer base_canon_version; acceptance cannot pin the optimistic version check`,
      },
    ]);
  return commitDelta(pool, {
    projectId: input.projectId,
    parentVersion: base,
    source: 'chapter_acceptance',
    delta,
    actor: input.actor ?? {},
    chapterId: input.chapterId,
    manuscriptVersionId: input.manuscriptVersionId,
    clockMax: input.clockMax,
    ...(input.lease ? { lease: input.lease } : {}),
  });
}

/**
 * ADR-0105 (G17-5): an asserted fact without its own `valid_from` is valid from its item's `story_clock`, as a closed fact
 * is closed at its item's clock (`factProposal`). A stored fact requires the clock and the proposal does not, so G17a's
 * two facts reached the insert without one.
 */
export function withFactClocks(delta: unknown): unknown {
  const items = (delta as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return delta;
  const out = items.map((raw: unknown): unknown => {
    const item = raw as { type?: unknown; op?: unknown; story_clock?: unknown; payload?: unknown };
    const payload = item.payload as Record<string, unknown> | undefined;
    if (item.type !== 'fact' || (item.op !== 'assert' && item.op !== 'supersede')) return raw;
    if (!payload || payload.valid_from !== undefined || item.story_clock === undefined) return raw;
    return { ...item, payload: { ...payload, valid_from: item.story_clock } };
  });
  return out.some((x, i) => x !== items[i]) ? { ...(delta as object), items: out } : delta;
}
