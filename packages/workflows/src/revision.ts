/**
 * One bounded, dimension-targeted revision path (ADR-0014). The reviser receives exactly the issues of one
 * dimension and the span they anchor; its patch is validated (schema, span anchored to the parent's NFC
 * code points, preserved facts acknowledged, English), applied deterministically and stored as a NEW immutable
 * working version whose parent_version_id is the revised version. Rounds are bounded by the pinned policy.
 * Candidate comparison and broad patch calibration are Checkpoint 6.
 */
import {
  createManuscriptVersion,
  manuscriptVersionsOf,
  setChapterStatus,
  type ManuscriptVersionRow,
} from '@yeonjae/db';
import { type Generated, recordNormalization, validatorFor } from '@yeonjae/domain';
import {
  checkOutputLanguage,
  codePointLength,
  sliceCodePoints,
  toNfcText,
  type NfcText,
} from '@yeonjae/prose';
import { locateQuote } from './anchoring.js';
import { contentHashOf, koQuoteMarks } from './drafting.js';
import { type Issue } from './evaluation.js';
import { WorkflowError } from './errors.js';
import { compileFor } from './planning.js';
import { bind, modelCall, runStep, saveArtifact, type WorkflowContext } from './runtime.js';

export type Patch = Generated.PatchSchema.Patch;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Anchor a reviser's span to the parent's exact code points (ADR-0051 §6, ADR-0056 §11).
 *
 * The reviser sees only the window it is asked to revise and cannot count code points, so the quote is the
 * anchor: offsets are kept only when the parent text at them equals the quote; otherwise the quote's
 * occurrence (inside the window first, then anywhere) supplies them. A patch without a span rewrites the
 * whole window it was shown. `undefined` means the quote does not occur in the text.
 */
export function anchorPatchSpan(
  text: NfcText,
  window: { readonly start: number; readonly end: number },
  raw: unknown,
): Patch['span'] | undefined {
  if (raw === undefined || raw === null) return { start: window.start, end: window.end };
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const ids =
    Array.isArray(s.paragraph_ids) && s.paragraph_ids.every((x) => typeof x === 'string')
      ? { paragraph_ids: s.paragraph_ids }
      : {};
  const start = Number.isInteger(s.start) ? (s.start as number) : undefined;
  const end = Number.isInteger(s.end) ? (s.end as number) : undefined;
  const quote =
    typeof s.original_quote === 'string' && s.original_quote.trim().length > 0
      ? s.original_quote
      : undefined;
  if (quote === undefined) {
    if (start === undefined && end === undefined)
      return { ...ids, start: window.start, end: window.end };
    // Offsets without a quote cannot be verified; they are range-checked by the caller as before.
    return { ...ids, start: start ?? -1, end: end ?? -1 };
  }
  const total = codePointLength(text.text);
  if (
    start !== undefined &&
    end !== undefined &&
    start >= 0 &&
    start < end &&
    end <= total &&
    sliceCodePoints(text, start, end) === toNfcText(quote).text
  )
    return { ...ids, start, end, original_quote: quote };
  const inWindow = locateQuote(toNfcText(sliceCodePoints(text, window.start, window.end)), quote);
  const found = inWindow
    ? {
        start: window.start + inWindow.start,
        end: window.start + inWindow.end,
        quote: inWindow.quote,
      }
    : locateQuote(text, quote, window.start);
  return found
    ? { ...ids, start: found.start, end: found.end, original_quote: found.quote }
    : undefined;
}

/**
 * Live-model near-misses of the patch fields, rewritten only where the raw value cannot validate: claim
 * pairs become `before → after` lines, a boolean `regression` (the workflow's report, not the model's) is
 * dropped, and prose written where fact ids belong is dropped so the acknowledgement check still decides.
 */
export function normalizePatchFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  const claims = raw.changed_claims;
  if (typeof claims === 'string') out.changed_claims = claims.trim() ? [claims] : [];
  else if (Array.isArray(claims))
    out.changed_claims = claims.flatMap((c: unknown) => {
      if (typeof c === 'string') return [c];
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        if (typeof o.before === 'string' && typeof o.after === 'string')
          return [`${o.before} → ${o.after}`];
        const parts = Object.values(o).filter((v): v is string => typeof v === 'string');
        return parts.length ? [parts.join(' → ')] : [];
      }
      return [];
    });
  if ('regression' in raw && (typeof raw.regression !== 'object' || raw.regression === null))
    delete out.regression;
  if (Array.isArray(raw.preserved_facts_ack))
    out.preserved_facts_ack = raw.preserved_facts_ack.filter(
      (x: unknown) => typeof x === 'string' && UUID_RE.test(x),
    );
  return out;
}

export interface RevisionResult {
  readonly version: ManuscriptVersionRow;
  readonly patch: Patch;
  readonly patchArtifactId: string;
  readonly dimension: Issue['dimension'];
  readonly issueIds: readonly string[];
}

/** Choose the dimension to target: the one with the most blocking/major issues that carry a span. */
export function pickRevisionDimension(issues: readonly Issue[]): Issue['dimension'] | undefined {
  const counts = new Map<Issue['dimension'], number>();
  for (const i of issues) {
    if (i.severity !== 'blocking' && i.severity !== 'major') continue;
    counts.set(i.dimension, (counts.get(i.dimension) ?? 0) + (i.chapter_span ? 2 : 1));
  }
  let best: Issue['dimension'] | undefined;
  let bestN = 0;
  for (const [d, n] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

export async function reviseVersion(
  ctx: WorkflowContext,
  input: {
    version: ManuscriptVersionRow;
    chapterId: string;
    chapterNo: number;
    issues: readonly Issue[];
    dimension: Issue['dimension'];
    round: number;
    registerDigests: string;
  },
): Promise<RevisionResult> {
  const maxRounds = ctx.policy.revision.max_rounds;
  if (input.round > maxRounds)
    throw new WorkflowError(
      'REVISION_LIMIT',
      `revision round ${input.round} exceeds policy.revision.max_rounds = ${maxRounds} (${ctx.pins.productionPolicyVersion})`,
      { step: 'revise', recommendedActions: ['regenerate', 'edit_manually'] },
    );
  return runStep(
    ctx,
    'revise',
    async () => {
      const targeted = input.issues.filter(
        (i) =>
          i.dimension === input.dimension && (i.severity === 'blocking' || i.severity === 'major'),
      );
      if (targeted.length === 0)
        throw new WorkflowError(
          'INTERNAL',
          `no blocking/major issues on dimension ${input.dimension}`,
          {
            step: 'revise',
          },
        );
      const nfc = toNfcText(input.version.text);
      const total = codePointLength(nfc.text);
      // Span = union of the targeted issues' spans; issues without a span widen to the whole text.
      let start = total;
      let end = 0;
      for (const i of targeted) {
        const s = i.chapter_span;
        if (s?.start !== undefined && s.end !== undefined) {
          start = Math.min(start, s.start);
          end = Math.max(end, s.end);
        } else {
          start = 0;
          end = total;
        }
      }
      if (start >= end) {
        start = 0;
        end = total;
      }
      const spanText = sliceCodePoints(nfc, start, end);
      const before = sliceCodePoints(nfc, Math.max(0, start - 600), start);
      const after = sliceCodePoints(nfc, end, Math.min(total, end + 600));
      const mustPreserve = [
        ...new Set(targeted.flatMap((i) => i.repair?.must_preserve_fact_ids ?? [])),
      ];
      await bind(ctx, {
        [`patch.${input.chapterNo}.r${input.round}`]: patchId(ctx, input.version.id, input.round),
        [`version.${input.chapterNo}.current`]: input.version.id,
        ...Object.fromEntries(targeted.map((i, n) => [`issue.${input.dimension}.${n}`, i.id])),
      });
      const call = await modelCall<Partial<Patch>>(ctx, {
        step: 'revise',
        family: 'targeted_reviser',
        activityId: `revise:${input.chapterNo}:${input.dimension}:r${input.round}`,
        variables: {
          dimension: input.dimension,
          issues: JSON.stringify(
            targeted.map((i) => ({
              id: i.id,
              kind: i.kind,
              severity: i.severity,
              claim: i.claim,
              repair: i.repair,
            })),
          ),
          span_text: spanText,
          context_before: before,
          context_after: after,
          must_preserve: mustPreserve.length
            ? mustPreserve.join('\n')
            : ctx.identity.outputLanguage.language === 'ko'
              ? '(없음)'
              : '(none)',
          register_digests: input.registerDigests,
          length_budget_words: String(spanText.split(/\s+/).filter(Boolean).length),
        },
        block: compileFor(ctx, 'editor_full'),
      });
      // The model's output is untrusted JSON whatever the call's type parameter says.
      const output: unknown = call.output;
      const fields = normalizePatchFields(
        output && typeof output === 'object' ? (output as Record<string, unknown>) : {},
      );
      if (JSON.stringify(fields) !== JSON.stringify(output)) recordNormalization('patch_fields');
      // Replacement text follows the manuscript's quotation marks, like a drafted scene (ADR-0056 §13).
      const raw =
        ctx.identity.outputLanguage.language === 'ko' && typeof fields.new_text === 'string'
          ? { ...fields, new_text: koQuoteMarks(fields.new_text) }
          : fields;
      const anchored = anchorPatchSpan(nfc, { start, end }, raw.span);
      const rawSpan = raw.span as { start?: unknown; end?: unknown } | undefined;
      if (anchored && rawSpan && (rawSpan.start !== anchored.start || rawSpan.end !== anchored.end))
        recordNormalization('patch_quote_anchor');
      if (!anchored)
        throw new WorkflowError(
          'PATCH_UNANCHORED',
          'patch original_quote does not occur in the parent text',
          { step: 'revise', recommendedActions: ['regenerate'] },
        );
      if (
        raw.span === undefined &&
        typeof raw.new_text === 'string' &&
        codePointLength(toNfcText(raw.new_text).text) < (end - start) / 2
      )
        throw new WorkflowError(
          'PATCH_UNANCHORED',
          'a patch without a span rewrites the whole window, but its text is less than half of it',
          { step: 'revise', recommendedActions: ['regenerate'] },
        );
      const candidate: Patch = {
        ...(raw as unknown as Patch),
        span: anchored,
        // The patch targets exactly the dimension this round selected; the model's echo is not authority.
        dimension: input.dimension,
        id: patchId(ctx, input.version.id, input.round),
        from_version_id: input.version.id,
        issue_ids: targeted.map((i) => i.id),
        reviser_call_id: call.llmCallId,
      };
      const v = validatorFor<Patch>('patch.schema.json')(candidate);
      if (!v.ok)
        throw new WorkflowError(
          'PATCH_UNANCHORED',
          `patch does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
          { step: 'revise', recommendedActions: ['regenerate'] },
        );
      const patch = v.value;
      // Anchor the patch to the parent's exact code points; original_quote, when given, must match.
      if (patch.span.start < 0 || patch.span.end > total || patch.span.start >= patch.span.end)
        throw new WorkflowError(
          'PATCH_UNANCHORED',
          `patch span ${patch.span.start}–${patch.span.end} is outside the ${total}-code-point text`,
          {
            step: 'revise',
          },
        );
      const original = sliceCodePoints(nfc, patch.span.start, patch.span.end);
      if (
        patch.span.original_quote !== undefined &&
        toNfcText(patch.span.original_quote).text !== original
      )
        throw new WorkflowError(
          'PATCH_UNANCHORED',
          'patch original_quote does not equal the parent text at the span',
          {
            step: 'revise',
            data: { expected: original.slice(0, 80), got: patch.span.original_quote.slice(0, 80) },
          },
        );
      for (const id of mustPreserve)
        if (!patch.preserved_facts_ack.includes(id))
          throw new WorkflowError(
            'PATCH_UNANCHORED',
            `patch does not acknowledge must-preserve fact ${id}`,
            {
              step: 'revise',
            },
          );
      const newText = toNfcText(patch.new_text).text;
      const language: 'en' | 'ko' = ctx.identity.outputLanguage.language ?? 'en';
      const lang = checkOutputLanguage(toNfcText(newText), {
        minConfidence: ctx.policy.output_language.min_english_confidence,
        language,
      });
      if (!lang.passed)
        throw new WorkflowError(
          'OUTPUT_LANGUAGE_FAILED',
          `patch text is not ${language === 'ko' ? 'Korean' : 'English'} (confidence ${lang.english_confidence})`,
          {
            step: 'revise',
            recommendedActions: ['regenerate'],
          },
        );
      const revised = toNfcText(
        sliceCodePoints(nfc, 0, patch.span.start) +
          newText +
          sliceCodePoints(nfc, patch.span.end, total),
      ).text;
      if (revised === nfc.text)
        throw new WorkflowError('PATCH_UNANCHORED', 'patch changes nothing', { step: 'revise' });
      const hash = contentHashOf(revised);
      const existing = (await manuscriptVersionsOf(ctx.pool, input.chapterId)).find(
        (x) =>
          x.origin === 'revision' &&
          x.content_hash === hash &&
          x.parent_version_id === input.version.id,
      );
      let version: ManuscriptVersionRow;
      if (existing) {
        const row = await ctx.pool.query<ManuscriptVersionRow>(
          'SELECT * FROM manuscript_versions WHERE id = $1',
          [existing.id],
        );
        const found = row.rows[0];
        if (!found)
          throw new WorkflowError('INTERNAL', 'revised version vanished', { step: 'revise' });
        version = found;
      } else {
        await setChapterStatus(ctx.pool, input.chapterId, 'revising');
        version = await createManuscriptVersion(ctx.pool, {
          workspaceId: ctx.workspaceId,
          projectId: ctx.projectId,
          chapterId: input.chapterId,
          origin: 'revision',
          text: revised,
          parentVersionId: input.version.id,
          createdByJobId: ctx.job.id,
        });
      }
      await bind(ctx, { [`version.${input.chapterNo}.round${input.round}`]: version.id });
      const stored: Patch = { ...patch, to_version_id: version.id };
      const ref = await saveArtifact(ctx, {
        step: 'revise',
        kind: 'patch',
        key: `${input.version.id}:r${input.round}`,
        schema: 'patch.schema.json',
        payload: stored,
      });
      return {
        version,
        patch: stored,
        patchArtifactId: ref.artifact_id,
        dimension: input.dimension,
        issueIds: targeted.map((i) => i.id),
      };
    },
    `${input.version.id}:r${input.round}`,
  );
}

function patchId(ctx: WorkflowContext, versionId: string, round: number): string {
  const hex = createHash('sha256')
    .update(`${ctx.workflowId}|patch|${versionId}|${round}`)
    .digest('hex')
    .slice(0, 32);
  const b = Buffer.from(hex, 'hex');
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
import { createHash } from 'node:crypto';
