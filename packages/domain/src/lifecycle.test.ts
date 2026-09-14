import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  isCanonReadable,
  isExtractable,
  transitionChapter,
  transitionContract,
  transitionManuscript,
} from './lifecycle.js';

describe('manuscript lifecycle (ADR-0037)', () => {
  it('working → approved → accepted is the only forward path', () => {
    expect(transitionManuscript('working', 'approved')).toBe('approved');
    expect(transitionManuscript('approved', 'accepted')).toBe('accepted');
    expect(() => transitionManuscript('working', 'accepted')).toThrow(IllegalTransitionError);
  });

  it('only approved versions are extractable; only accepted versions are canon-readable', () => {
    expect(isExtractable('working')).toBe(false);
    expect(isExtractable('approved')).toBe(true);
    expect(isExtractable('accepted')).toBe(false);
    expect(isCanonReadable('approved')).toBe(false);
    expect(isCanonReadable('accepted')).toBe(true);
  });

  it('an approved version never returns to working; a change request makes a new version', () => {
    expect(() => transitionManuscript('approved', 'working')).toThrow(IllegalTransitionError);
  });

  it('accepted → approved only through a rollback commit (ADR-0038)', () => {
    expect(() => transitionManuscript('accepted', 'approved')).toThrow(/rollback/);
    expect(transitionManuscript('accepted', 'approved', true)).toBe('approved');
  });

  it('terminal statuses do not move', () => {
    for (const s of ['superseded', 'retconned', 'rejected'] as const) {
      expect(() => transitionManuscript(s, 'working')).toThrow(IllegalTransitionError);
    }
  });
});

describe('chapter lifecycle', () => {
  it('follows planned → … → approved → extracting → … → committing → accepted', () => {
    const path = [
      'drafting',
      'drafted',
      'evaluating',
      'revising',
      'evaluating',
      'review_pending',
      'approved',
      'extracting',
      'reconciling',
      'verifying',
      'committing',
      'accepted',
    ] as const;
    let s: Parameters<typeof transitionChapter>[0] = 'planned';
    for (const next of path) s = transitionChapter(s, next);
    expect(s).toBe('accepted');
  });

  it('a failed commit returns to approved with canon untouched; acceptance never precedes extraction', () => {
    expect(transitionChapter('committing', 'approved')).toBe('approved');
    expect(() => transitionChapter('review_pending', 'accepted')).toThrow(IllegalTransitionError);
    expect(() => transitionChapter('approved', 'accepted')).toThrow(IllegalTransitionError);
  });

  it('needs_attention is reachable from production states and rejected is terminal', () => {
    expect(transitionChapter('drafting', 'needs_attention')).toBe('needs_attention');
    expect(transitionChapter('needs_attention', 'revising')).toBe('revising');
    expect(() => transitionChapter('rejected', 'planned')).toThrow(IllegalTransitionError);
  });
});

describe('contract lifecycle', () => {
  it('uses locked (not approved) and realizes on acceptance', () => {
    expect(transitionContract('validated', 'locked')).toBe('locked');
    expect(transitionContract('locked', 'realized')).toBe('realized');
    expect(() => transitionContract('draft', 'locked')).toThrow(IllegalTransitionError);
  });
});
