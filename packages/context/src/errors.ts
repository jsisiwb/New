/**
 * Context-pack errors. Every code is actionable: the message names what overflowed or what is missing and
 * what the operator can change (budget, model, constraint consolidation, chapter acceptance). Nothing here
 * ever degrades silently — silent trimming of a governing contract or a hard requirement is the failure
 * these codes exist to prevent (ADR-0010, ADR-0033).
 */
export type ContextErrorCode =
  | 'CONSTRAINTS_OVERFLOW'
  | 'CONSTRAINT_UNRENDERABLE'
  | 'PACK_T0_OVERFLOW'
  | 'PACK_T1_OVERFLOW'
  | 'PREVIOUS_CHAPTER_NOT_ACCEPTED'
  | 'STRUCTURED_RETRIEVAL_UNAVAILABLE'
  | 'PROHIBITED_SOURCE'
  | 'PACK_VALIDATION_FAILED'
  | 'TEMPLATE_ROLE_MISMATCH'
  | 'TASK_INVALID';

export class ContextError extends Error {
  constructor(
    readonly code: ContextErrorCode,
    readonly detail: string,
    readonly data: Readonly<Record<string, unknown>> = {},
  ) {
    super(`${code}: ${detail}`);
    this.name = 'ContextError';
  }
}
