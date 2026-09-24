/**
 * Compile a regular expression that a model wrote (contract `must_not_happen.lexical_patterns`, ADR-0057).
 * Model text is untrusted: an invalid or oversized pattern must become a recorded finding, never a crash,
 * and the guard it expressed must still run. Such a pattern is matched as a literal string instead.
 */
export interface ModelPattern {
  readonly re: RegExp;
  /** False when the pattern could not be used as a regex and is matched literally. */
  readonly valid: boolean;
  readonly reason?: 'invalid_syntax' | 'too_long' | undefined;
}

/** Longer patterns are matched literally: a model has no business writing a 256-character regex. */
export const MAX_MODEL_PATTERN_LENGTH = 256;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileModelPattern(pattern: string, flags = ''): ModelPattern {
  if (pattern.length > MAX_MODEL_PATTERN_LENGTH)
    return { re: new RegExp(escapeRegExp(pattern), flags), valid: false, reason: 'too_long' };
  try {
    return { re: new RegExp(pattern, flags), valid: true };
  } catch {
    return { re: new RegExp(escapeRegExp(pattern), flags), valid: false, reason: 'invalid_syntax' };
  }
}
