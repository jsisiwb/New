/**
 * Lifecycle state machines (ADR-0037). Transitions are the only way status changes; illegal moves throw so a
 * bug cannot silently skip approval-lock or acceptance.
 */
export type ManuscriptStatus =
  'working' | 'approved' | 'accepted' | 'superseded' | 'retconned' | 'rejected';
export type ManuscriptOrigin = 'assembled' | 'revision' | 'candidate' | 'retcon' | 'imported';

const MANUSCRIPT_TRANSITIONS: Readonly<Record<ManuscriptStatus, readonly ManuscriptStatus[]>> = {
  working: ['approved', 'rejected'],
  // An approved version never returns to working: a change request produces a NEW version.
  approved: ['accepted', 'rejected'],
  // `approved` is reachable from `accepted` only through a rollback commit (ADR-0038).
  accepted: ['superseded', 'retconned', 'approved'],
  superseded: [],
  retconned: [],
  rejected: [],
};

export function canTransitionManuscript(from: ManuscriptStatus, to: ManuscriptStatus): boolean {
  return MANUSCRIPT_TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function transitionManuscript(
  from: ManuscriptStatus,
  to: ManuscriptStatus,
  viaRollback = false,
): ManuscriptStatus {
  if (from === 'accepted' && to === 'approved' && !viaRollback) {
    throw new IllegalTransitionError(
      'manuscript',
      from,
      `${to} (only a rollback commit may re-open an accepted version)`,
    );
  }
  if (!canTransitionManuscript(from, to)) throw new IllegalTransitionError('manuscript', from, to);
  return to;
}

/** Statuses whose text is immutable and may be referenced by evidence spans. */
export const IMMUTABLE_MANUSCRIPT_STATUSES: readonly ManuscriptStatus[] = [
  'approved',
  'accepted',
  'superseded',
  'retconned',
];
export function isExtractable(status: ManuscriptStatus): boolean {
  return status === 'approved';
}
export function isCanonReadable(status: ManuscriptStatus): boolean {
  return status === 'accepted';
}

export type ChapterState =
  | 'planned'
  | 'drafting'
  | 'drafted'
  | 'evaluating'
  | 'revising'
  | 'review_pending'
  | 'approved'
  | 'extracting'
  | 'reconciling'
  | 'verifying'
  | 'committing'
  | 'accepted'
  | 'stale'
  | 'superseded'
  | 'retconned'
  | 'needs_attention'
  | 'rejected';

const CHAPTER_TRANSITIONS: Readonly<Record<ChapterState, readonly ChapterState[]>> = {
  planned: ['drafting', 'rejected'],
  drafting: ['drafted', 'needs_attention', 'rejected'],
  drafted: ['evaluating', 'needs_attention', 'rejected'],
  evaluating: ['revising', 'review_pending', 'needs_attention', 'rejected'],
  revising: ['evaluating', 'needs_attention', 'rejected'],
  review_pending: ['approved', 'revising', 'needs_attention', 'rejected'],
  approved: ['extracting', 'needs_attention', 'rejected'],
  extracting: ['reconciling', 'approved', 'needs_attention'],
  reconciling: ['verifying', 'approved', 'needs_attention'],
  verifying: ['committing', 'approved', 'needs_attention'],
  committing: ['accepted', 'approved'], // tx failure → back to approved, canon untouched
  accepted: ['stale', 'superseded', 'retconned', 'approved'], // approved only via rollback
  stale: ['accepted', 'superseded', 'retconned'],
  superseded: [],
  retconned: [],
  needs_attention: ['drafting', 'evaluating', 'revising', 'review_pending', 'approved', 'rejected'],
  rejected: [],
};

export function transitionChapter(
  from: ChapterState,
  to: ChapterState,
  viaRollback = false,
): ChapterState {
  if (from === 'accepted' && to === 'approved' && !viaRollback) {
    throw new IllegalTransitionError(
      'chapter',
      from,
      `${to} (only a rollback commit may re-open an accepted chapter)`,
    );
  }
  if (!CHAPTER_TRANSITIONS[from].includes(to))
    throw new IllegalTransitionError('chapter', from, to);
  return to;
}

export type ContractStatus = 'draft' | 'validated' | 'locked' | 'stale' | 'superseded' | 'realized';
const CONTRACT_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  draft: ['validated', 'superseded'],
  validated: ['locked', 'draft', 'stale', 'superseded'],
  locked: ['realized', 'stale', 'superseded'],
  stale: ['validated', 'superseded'],
  superseded: [],
  realized: [],
};
export function transitionContract(from: ContractStatus, to: ContractStatus): ContractStatus {
  if (!CONTRACT_TRANSITIONS[from].includes(to))
    throw new IllegalTransitionError('contract', from, to);
  return to;
}
