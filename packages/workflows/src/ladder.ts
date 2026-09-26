/**
 * ADR-0092 (STEP 3, live defects G9-4, G9-5): pure helpers of the escalation ladder — where a finding without a
 * quote belongs, and when a round would only repeat a round the regression check already quarantined.
 */
import { segmentParagraphs, toNfcText } from '@yeonjae/prose';

/** A finding as the ladder reads it. */
export interface LadderFinding {
  readonly id: string;
  readonly dimension: string;
  readonly kind: string;
  readonly claim: string;
  readonly source?: string | undefined;
  readonly chapter_span?: { readonly start?: number | undefined } | null | undefined;
}

const OPENING =
  /첫\s?(?:[0-9]+|한|두|세|네)?\s?(?:문장|문단|줄|화면|장면)|도입|오프닝|시작 부분|초반부/u;
const ENDING = /절단|마지막\s?(?:문장|문단|장면|비트|줄)|결말|엔딩|끝 문장|말미/u;

/**
 * The code-point offset a quoteless finding points at: the first paragraph its claim names (`[p14]`, `p1~p3`), else
 * the chapter's start for a claim about the opening, else its last paragraph for a claim about the cut or ending.
 */
export function claimAnchor(claim: string, text: string): number | undefined {
  const paragraphs = segmentParagraphs(toNfcText(text));
  if (paragraphs.length === 0) return undefined;
  const ref = /\bp(\d{1,4})\b/u.exec(claim.replace(/\[|\]/gu, ' '));
  if (ref) {
    const n = Number(ref[1]);
    const p = paragraphs[n - 1];
    if (p) return p.start;
  }
  if (OPENING.test(claim)) return paragraphs[0]?.start;
  if (ENDING.test(claim)) return paragraphs.at(-1)?.start;
  return undefined;
}

/**
 * The code-point span ({ start, end }) a quoteless finding points at:
 * paragraph range (e.g. `p1~p3` -> start of p1 to end of p3, `[p14]` -> p14),
 * opening claims -> start of p1 to end of p3 (or p1),
 * ending claims -> start to end of last paragraph.
 */
export function claimSpan(claim: string, text: string): { start: number; end: number } | undefined {
  const paragraphs = segmentParagraphs(toNfcText(text));
  if (paragraphs.length === 0) return undefined;
  const cleaned = claim.replace(/\[|\]/gu, ' ');
  const rangeRef = /\bp(\d{1,4})\s*[~-]\s*p?(\d{1,4})\b/u.exec(cleaned);
  if (rangeRef) {
    const sIdx = Number(rangeRef[1]) - 1;
    const eIdx = Number(rangeRef[2]) - 1;
    const pStart = paragraphs[sIdx];
    const pEnd = paragraphs[eIdx] ?? paragraphs[paragraphs.length - 1];
    if (pStart && pEnd && pStart.start < pEnd.end) return { start: pStart.start, end: pEnd.end };
    if (pStart) return { start: pStart.start, end: pStart.end };
  }
  const singleRef = /\bp(\d{1,4})\b/u.exec(cleaned);
  if (singleRef) {
    const n = Number(singleRef[1]);
    const p = paragraphs[n - 1];
    if (p) return { start: p.start, end: p.end };
  }
  if (OPENING.test(claim)) {
    const pStart = paragraphs[0];
    if (!pStart) return undefined;
    const endIdx = /첫\s*(?:[33]|세)\s*(?:문장|문단|줄)/u.test(claim) ? Math.min(2, paragraphs.length - 1) : 0;
    const pEnd = paragraphs[endIdx] ?? pStart;
    return { start: pStart.start, end: pEnd.end };
  }
  if (ENDING.test(claim)) {
    const last = paragraphs.at(-1);
    if (last) return { start: last.start, end: last.end };
  }
  return undefined;
}

/** A judge's blocking or major finding with no quote: the ones `spanless_to_scene` sends to a scene rewrite. */
export function isSpanlessJudgeFinding(f: LadderFinding): boolean {
  return (
    typeof f.chapter_span?.start !== 'number' &&
    (f.source === undefined || f.source.startsWith('judge:')) &&
    f.claim.trim().length > 0
  );
}

/** Whether a finding lies in a scene's range (by its quote, or with `anchorSpanless` by where its claim points). */
export function findingInRange(
  f: LadderFinding,
  range: { readonly start: number; readonly end: number },
  text: string,
  anchorSpanless: boolean,
): boolean {
  const at = f.chapter_span?.start ?? (anchorSpanless ? claimAnchor(f.claim, text) : undefined);
  return typeof at === 'number' && at >= range.start && at < range.end;
}

/** A stable key of a round's targets: dimension, kind and quoted position, sorted. */
export function targetsKey(findings: readonly LadderFinding[]): string {
  return findings
    .map(
      (f) =>
        `${f.dimension}|${f.kind}|${typeof f.chapter_span?.start === 'number' ? String(f.chapter_span.start) : '-'}`,
    )
    .sort()
    .join(';');
}

export type Rung = 'patch' | 'scene';

export interface QuarantinedAttempt {
  readonly parentId: string;
  readonly targets: string;
  readonly rung: Rung;
  /** Korean reasons for the rejection, for the next attempt's note. */
  readonly reasons: readonly string[];
}

/**
 * ADR-0092 (`no_repeat`): what a round does when the last quarantined attempt had the same parent and targets: repeat
 * (nothing matched), escalate a patch round to a scene rewrite, or stop the loop.
 */
export function repeatDecision(
  last: QuarantinedAttempt | undefined,
  next: {
    readonly parentId: string;
    readonly targets: string;
    readonly rung: Rung;
    readonly rewritesLeft: boolean;
  },
): 'repeat' | 'escalate' | 'stop' {
  if (last?.parentId !== next.parentId || last.targets !== next.targets) return 'repeat';
  if (last.rung === 'patch' && next.rewritesLeft) return 'escalate';
  return 'stop';
}

const FAILURE_KO: Readonly<Record<string, string>> = {
  targeted_not_improved: '겨냥한 결함이 고쳐지지 않았다',
  targeted_worsened: '겨냥한 차원의 점수가 떨어졌다',
  protected_dimension_regressed: '다른 차원의 점수가 기준 아래로 떨어졌다',
  new_blocking_or_major_issue: '새 결함이 생겼다',
  protection_failed: '보호 기준을 어겼다',
  gated_dimension_missing: '판정 근거가 빠졌다',
  dimension_dropped: '판정 근거가 빠졌다',
};

/** The rejected attempt's reasons in Korean: its failure codes and the claims of the findings it introduced. */
export function rejectionReasons(
  failures: readonly string[],
  introducedClaims: readonly string[],
): string[] {
  const out = [...new Set(failures.map((f) => FAILURE_KO[f]).filter((x): x is string => !!x))];
  for (const c of introducedClaims.slice(0, 3)) out.push(c.replace(/\s+/gu, ' ').trim());
  return out;
}

/**
 * A finding's claim as a Korean writer reads it: a failed contract criterion's English prefix
 * (`acceptance criterion AC-1 failed: …`, written by the evaluator) becomes `계약 기준 AC-1 미충족: …`.
 */
export function claimForKoreanNote(claim: string): string {
  return claim
    .replace(
      /^acceptance criterion (\S+) failed(?:: deterministic)?(:?)\s*/u,
      (_m, id: string, colon: string) =>
        colon ? `계약 기준 ${id} 미충족: ` : `계약 기준 ${id} 미충족`,
    )
    .trim();
}

/**
 * ADR-0093 (live defect G10-4, `ladder.switch_rung`): the rungs already quarantined on one parent and one target set
 * decide the next rung — the planned one while it is untried, else the other one (a patch after a failed scene
 * rewrite, a scene rewrite after a failed patch round while rewrites remain); the loop stops only when both failed.
 */
export function nextRung(
  tried: ReadonlySet<Rung>,
  planned: Rung,
  sceneFeasible: boolean,
): Rung | 'stop' {
  if (!tried.has(planned)) return planned;
  const other: Rung = planned === 'scene' ? 'patch' : 'scene';
  if (tried.has(other)) return 'stop';
  if (other === 'scene' && !sceneFeasible) return 'stop';
  return other;
}
