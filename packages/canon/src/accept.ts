/**
 * Chapter acceptance orchestration: the last mile from an approval-locked manuscript version and a verified
 * delta to the atomic commit. Steps are idempotent by construction: re-running with the same parent version
 * either commits once or fails with STALE_CANON.
 */
import {
  commitDelta,
  getManuscriptVersion,
  getProject,
  type CommitResult,
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
  const verdict = verifyDelta(input.delta, {
    source: 'chapter_acceptance',
    manuscripts,
    manuscriptStatus: statuses,
    timelines: input.timelines,
    mainTimelineId: input.mainTimelineId,
    clockMax: input.clockMax,
    knownEntityIds: input.knownEntityIds,
  });
  if (!verdict.ok) throw new DeltaRejectedError(verdict.issues);
  const project = await getProject(pool, input.projectId);
  return commitDelta(pool, {
    projectId: input.projectId,
    parentVersion: project.canon_version,
    source: 'chapter_acceptance',
    delta: input.delta,
    actor: input.actor ?? {},
    chapterId: input.chapterId,
    manuscriptVersionId: input.manuscriptVersionId,
    clockMax: input.clockMax,
  });
}
