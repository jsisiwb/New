/**
 * Multi-patch revision helpers (ADR-0077, V1). A round used to send the reviser the union of every targeted
 * issue's span — on a live Korean chapter that is most of a scene, and the reviser rewrote the scene, which
 * then failed its regression check. Here the targeted spans are clustered, each cluster gets its own patch,
 * and the usable patches are merged into one revision. Pure functions: code-point offsets into NFC text.
 */

export interface SpanIssue {
  readonly id: string;
  readonly chapter_span?: { readonly start?: number; readonly end?: number } | undefined;
}

export interface IssueCluster<T extends SpanIssue> {
  readonly start: number;
  readonly end: number;
  readonly issues: readonly T[];
}

/**
 * Cluster issues by span: sorted by start, an issue within `gap` code points of the cluster before it joins
 * it. Issues without a usable span join no cluster; when no issue has one, the whole text is one cluster.
 */
export function clusterIssueSpans<T extends SpanIssue>(
  issues: readonly T[],
  total: number,
  gap: number,
): IssueCluster<T>[] {
  const spanned = issues
    .map((i) => ({ i, s: i.chapter_span?.start, e: i.chapter_span?.end }))
    .filter(
      (x): x is { i: T; s: number; e: number } =>
        x.s !== undefined && x.e !== undefined && x.s < x.e && x.s >= 0 && x.e <= total,
    )
    .sort((a, b) => a.s - b.s || a.e - b.e || (a.i.id < b.i.id ? -1 : 1));
  if (spanned.length === 0) return issues.length ? [{ start: 0, end: total, issues }] : [];
  const out: { start: number; end: number; issues: T[] }[] = [];
  for (const x of spanned) {
    const last = out[out.length - 1];
    if (last && x.s <= last.end + gap) {
      last.end = Math.max(last.end, x.e);
      last.issues.push(x.i);
    } else out.push({ start: x.s, end: x.e, issues: [x.i] });
  }
  return out;
}

export interface AppliedPatch {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/**
 * Apply non-overlapping patches to `parent` (offsets in code points of `parent`). Returns the revised text and
 * the envelope — from the first patch's start to the last patch's end in the parent, and the text that
 * replaces it — so the round is still recorded as one schema-valid patch.
 */
export function mergePatches(
  parent: string,
  patches: readonly AppliedPatch[],
): { revised: string; envelope: { start: number; end: number }; middle: string } {
  if (patches.length === 0) throw new RangeError('no patches to merge');
  const cps = Array.from(parent);
  const sorted = [...patches].sort((a, b) => a.start - b.start);
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1];
    const cur = sorted[k];
    if (prev && cur && cur.start < prev.end)
      throw new RangeError(`patches overlap at ${cur.start} (previous ends at ${prev.end})`);
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) throw new RangeError('no patches to merge');
  if (first.start < 0 || last.end > cps.length) throw new RangeError('patch outside the text');
  const pieces: string[] = [];
  let at = first.start;
  for (const p of sorted) {
    pieces.push(cps.slice(at, p.start).join(''), p.newText);
    at = p.end;
  }
  const middle = pieces.join('');
  return {
    revised: cps.slice(0, first.start).join('') + middle + cps.slice(last.end).join(''),
    envelope: { start: first.start, end: last.end },
    middle,
  };
}

const SCOPE_WIDTH: Readonly<Record<string, number>> = {
  seam: 0,
  sentence: 1,
  dialogue: 2,
  paragraph: 3,
  scene: 4,
};

/** The widest scope among the merged patches: a scene rewrite anywhere makes the round a scene rewrite. */
export function widestScope(scopes: readonly string[]): string {
  return scopes.reduce(
    (w, s) => ((SCOPE_WIDTH[s] ?? 0) > (SCOPE_WIDTH[w] ?? 0) ? s : w),
    scopes[0] ?? 'sentence',
  );
}
