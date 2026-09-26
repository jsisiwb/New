/**
 * ADR-0116 (`standard@35`, live defect G21-1): the reviser's escalation per finding. G21r's confirmation found a real
 * slip; two patch rounds left the quoted sentence in place (the reviser rewrote elsewhere) and the chapter ended at the
 * cap. A finding that survives a kept patch round is patched again with that failure named; one that survived
 * `escalate_after_patches` rounds is answered by drafting its scene again.
 */
import type { Generated } from '@yeonjae/domain';
import { segmentParagraphs, toNfcText } from '@yeonjae/prose';
import { isHeavy, spanParagraphIds } from './consensus.js';

type Issue = Generated.IssueSchema.Issue;

/**
 * A finding's identity across versions: its evaluator and the text of the paragraphs it quotes (readings quote one slip
 * with different words and kinds; a paragraph a patch did not change keeps its text). An unquoted finding is its
 * evaluator and kind.
 */
export function findingKey(issue: Issue, text: string): string {
  const span = issue.chapter_span;
  if (!span) return `${issue.source}|${issue.kind}`;
  const paragraphs = segmentParagraphs(toNfcText(text));
  const ids = new Set(spanParagraphIds(span, paragraphs));
  const body = paragraphs
    .filter((p) => ids.has(p.id))
    .map((p) => p.text)
    .join('\n');
  return `${issue.source}|${body || (span.quote ?? issue.kind)}`;
}

/** The same finding on two versions: one evaluator, and the same quoted paragraphs or overlapping quotes. */
function sameFinding(a: Issue, aText: string, b: Issue, bText: string): boolean {
  if (a.source !== b.source) return false;
  if (findingKey(a, aText) === findingKey(b, bText)) return true;
  const qa = a.chapter_span?.quote;
  const qb = b.chapter_span?.quote;
  return Boolean(qa && qb && (qa.includes(qb) || qb.includes(qa)));
}

/**
 * After a kept round: a targeted finding still open on the new version (a patch may have edited its paragraph and left
 * the slip) has survived one more patch round, and its tally moves to its key on the new version; one no longer open
 * leaves the tally.
 */
export function updateSurvival(
  survived: ReadonlyMap<string, number>,
  targeted: readonly Issue[],
  parentText: string,
  after: readonly Issue[],
  childText: string,
): Map<string, number> {
  const open = after.filter((i) => i.status === 'open' && isHeavy(i));
  const next = new Map(survived);
  for (const t of targeted) {
    const key = findingKey(t, parentText);
    const count = survived.get(key) ?? 0;
    next.delete(key);
    const still = open.find((a) => sameFinding(t, parentText, a, childText));
    if (still) next.set(findingKey(still, childText), count + 1);
  }
  return next;
}

/** The targets that survived at least `after` kept patch rounds. */
export function stuckTargets(
  targets: readonly Issue[],
  survived: ReadonlyMap<string, number>,
  text: string,
  after: number,
): Issue[] {
  return targets.filter((i) => (survived.get(findingKey(i, text)) ?? 0) >= after);
}

/** A target that survived a patch round tells the reviser so, and what to change this time. */
export function withSurvivalNotes(
  targets: readonly Issue[],
  survived: ReadonlyMap<string, number>,
  text: string,
  ko: boolean,
): Issue[] {
  const note = ko
    ? ' (지난 수정 뒤에도 이 결함이 그대로 남았다. 인용한 문장 자체를 고치고, 두 곳이 서로 어긋나는 결함이면 어긋나는 다른 곳도 함께 고친다.)'
    : ' (this finding survived the last patch: change the quoted sentence itself, and for a contradiction between two places change the other place too.)';
  return targets.map((i) =>
    (survived.get(findingKey(i, text)) ?? 0) > 0 ? { ...i, claim: `${i.claim}${note}` } : i,
  );
}
