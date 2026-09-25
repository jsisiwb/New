/**
 * Refusal detection (ADR-0080).
 *
 * A model can decline a request in words instead of a status: a short apology where a scene, a patch or a
 * JSON verdict should be. Passed through, such a reply becomes a "scene" of two sentences or burns the
 * bounded schema repair on a request the model will not answer. The detector is deliberately narrow: it
 * looks only at SHORT replies (a real scene or verdict is far longer than any refusal), and only at the
 * phrasing models use to decline, in Korean and in English.
 */

/** Replies longer than this are real output, whatever they contain (a scene may quote an apology). */
export const REFUSAL_MAX_CHARS = 600;

const KO_REFUSALS: readonly RegExp[] = [
  /죄송(하지만|합니다|하게도)[^\n]{0,60}(도와\s*드릴|도움을\s*드릴|제공(해\s*드릴|할)|작성(해\s*드릴|할)|응(할|해\s*드릴)|수행할|생성할)\s*수\s*(가\s*)?없/,
  /(요청|내용|주제)[^\n]{0,40}(처리|수행|응답|작성|생성|도와\s*드리기)(할|하기)?\s*(수\s*(가\s*)?없|어렵)/,
  /(안전|정책|가이드라인|지침|이용\s*약관)[^\n]{0,40}(위반|때문에|상|에\s*따라)[^\n]{0,40}(없습니다|어렵습니다|불가합니다)/,
  /도와\s*드리기\s*어렵/,
];

const EN_REFUSALS: readonly RegExp[] = [
  /\bI(?:'m| am)? (?:sorry|unable)\b[^\n]{0,80}\b(?:help|assist|create|write|provide|comply|continue|generate)\b/i,
  /\bI can(?:not|'t) (?:help|assist|create|write|provide|comply|fulfil|fulfill|generate|continue)\b/i,
  /\b(?:against|violates?) (?:my|the|our) (?:guidelines|policy|policies|usage policies)\b/i,
];

/** True when `text` reads as a refusal rather than the requested output. */
export function looksLikeRefusal(text: string | undefined): boolean {
  if (text === undefined) return false;
  const t = text.trim();
  if (t.length === 0 || t.length > REFUSAL_MAX_CHARS) return false;
  return KO_REFUSALS.some((r) => r.test(t)) || EN_REFUSALS.some((r) => r.test(t));
}

/**
 * True when a JSON answer was cut off rather than malformed: it opens an object or array and the text
 * ends with brackets still open (outside strings). Flagged `truncated_json` on the attempt; the repair path is the
 * same as for any invalid answer.
 */
export function looksTruncatedJson(text: string | undefined): boolean {
  if (text === undefined) return false;
  const body = text.replace(/^\s*```(?:json)?\s*/i, '').trim();
  if (!body.startsWith('{') && !body.startsWith('[')) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth > 0 || inString;
}
