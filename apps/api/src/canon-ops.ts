/**
 * Canon operator endpoints: correction, retcon, regeneration preview and rollback (Checkpoint 7).
 *
 * The services these call already exist and are already tested (`packages/canon/src/correction.ts`). This
 * module adds only the HTTP surface the API plan §1 "Canon & inspectors" specifies, and it is deliberately
 * thin: validation, authorization, an audit record and a safe serialization. Every invariant that matters —
 * mandatory justification, evidence resolution, the change-class rules, atomic commits against an expected
 * canon version, latest-only rollback, explicit retcon confirmation, material-vs-contextual consequences —
 * is enforced inside the service and the SQL functions beneath it. Re-implementing any of that here would
 * create a second, weaker enforcement path, which is exactly what the API plan's thin-adapter rule forbids.
 *
 * Two design points worth stating, because they are easy to get subtly wrong:
 *
 *  * DRY RUN IS A GET-SHAPED POST. The plan specifies `:correct` with `dry_run` producing an impact report
 *    "then commit". A dry run writes nothing, so it does not consume an `Idempotency-Key` and does not
 *    produce an audit record of a change — it is a read expressed as a POST because it takes a body. Only
 *    the committing form is idempotency-protected and audited.
 *
 *  * THE EXPECTED VERSION IS THE OPERATOR'S CONSENT. A correction commit carries the canon version its
 *    impact report was computed at. If canon moved in between, the service raises `CANON_STALE` rather than
 *    applying a change whose consequences the operator never saw. The API therefore REQUIRES
 *    `expected_canon_version` on every committing call instead of defaulting it to "current", because a
 *    convenient default would silently destroy that guarantee.
 */
import {
  correctCanonItem,
  CorrectionError,
  regenerationPreview,
  retconCanonItem,
  rollbackLatestCommit,
  type CanonItemKind,
  type CorrectionResult,
  type ImpactReport,
  type Pool,
} from './canon-deps.js';
import { ApiError } from './problem.js';
import { asObject, requireEnum, requireInt, requireString, requireUuid } from './validate.js';

/**
 * Canon item kinds an operator may correct or retcon over HTTP.
 *
 * Enumerated explicitly rather than derived from the service's wider union: this is the public contract, so
 * adding a kind must be a deliberate, reviewable change here rather than a side effect of a domain edit.
 */
export const CORRECTABLE_KINDS: readonly CanonItemKind[] = [
  'fact',
  'event',
  'knowledge_state',
  'relationship_state',
  'proposition',
  'proposition_truth',
  'promise',
  'promise_event',
];

/** The safe public view of an impact report. Contains references and counts, never manuscript prose. */
export function impactView(report: ImpactReport): Record<string, unknown> {
  return {
    project_id: report.projectId,
    // The version the report was computed at. A client must echo this back as `expected_canon_version`,
    // which is what makes a concurrent commit detectable rather than silently overwritten.
    canon_version: report.canonVersion,
    items: report.items,
    isolated: report.isolated,
    affected_accepted_chapters: report.affectedAcceptedChapters,
    material: report.material.map(dependentView),
    contextual: report.contextual.map(dependentView),
    material_count: report.material.length,
    contextual_count: report.contextual.length,
  };
}

/**
 * A dependent, as an operator needs to see it.
 *
 * `dependent_id` is an in-workspace identifier the RLS-scoped request could already read, so exposing it
 * discloses nothing across tenants. No text is included: a dependent is identified, never quoted.
 */
function dependentView(d: ImpactReport['material'][number]): Record<string, unknown> {
  return {
    dependent_kind: d.dependentKind,
    dependent_id: d.dependentId,
    canon_item_kind: d.canonItemKind,
    canon_item_ref: d.canonItemRef,
    basis: d.basis,
    canon_version_read: d.canonVersionRead,
    chapter_no: d.chapterNo ?? null,
  };
}

/** The safe public view of a correction/retcon/rollback outcome. */
export function correctionView(result: CorrectionResult): Record<string, unknown> {
  return {
    committed: result.committed,
    canon_version: result.canonVersion,
    commit_id: result.commitId ?? null,
    // Material dependents are now STALE; contextual ones are review suggestions and were NOT invalidated.
    // Keeping the two lists separate in the response is what lets a UI show the distinction the data
    // architecture draws, instead of flattening both into an alarming single count.
    stale_marked: result.staleMarked,
    review_suggested: result.reviewSuggested,
    impact: impactView(result.impact),
  };
}

export interface CorrectionRequest {
  readonly itemKind: CanonItemKind;
  readonly itemId: string;
  readonly newValue: Record<string, unknown>;
  readonly frame: string | undefined;
  readonly evidence: readonly Record<string, unknown>[] | undefined;
  readonly justification: string;
  readonly expectedCanonVersion: number | undefined;
  readonly dryRun: boolean;
  readonly confirmed: boolean;
}

/**
 * Parse and validate a correction or retcon body.
 *
 * `expected_canon_version` is optional ONLY for a dry run, where there is nothing to commit against; the
 * committing path requires it (see `requireExpectedVersion`). That asymmetry is the point: an operator
 * asking "what would this affect?" has not yet seen a report to consent to.
 */
export function parseCorrectionBody(raw: unknown): CorrectionRequest {
  const body = asObject(raw);
  const itemKind = requireEnum(body.item_kind, CORRECTABLE_KINDS, 'body.item_kind');
  const itemId = requireUuid(
    typeof body.item_id === 'string' ? body.item_id : undefined,
    'body.item_id',
  );
  const newValue = asObject(body.new_value, 'body.new_value');
  const justification = requireString(body, 'justification', { max: 2_000 });
  const frame = typeof body.frame === 'string' ? body.frame : undefined;
  const evidence = parseEvidence(body.evidence);
  const expectedCanonVersion = parseExpectedVersion(body.expected_canon_version);
  return {
    itemKind,
    itemId,
    newValue,
    frame,
    evidence,
    justification,
    expectedCanonVersion,
    dryRun: body.dry_run === true,
    confirmed: body.confirmed === true,
  };
}

/**
 * Evidence spans, passed through to the service unchanged.
 *
 * Deliberately NOT validated in detail here: the evidence trigger in migration 0001 verifies every span
 * against the accepted NFC text at code-point offsets, which is a check this layer cannot reproduce and
 * must not approximate. What is checked is only the shape — an array of objects — so a malformed body is a
 * 422 rather than a database error.
 */
function parseEvidence(value: unknown): readonly Record<string, unknown>[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value))
    throw new ApiError('VALIDATION_FAILED', 'body.evidence must be an array of evidence spans.', {
      errors: [{ path: 'body.evidence', message: 'must be an array' }],
    });
  if (value.length > 100)
    throw new ApiError('VALIDATION_FAILED', 'body.evidence may contain at most 100 spans.', {
      errors: [{ path: 'body.evidence', message: 'at most 100 entries' }],
    });
  return (value as unknown[]).map((entry, i) => asObject(entry, `body.evidence[${i}]`));
}

/**
 * The expected canon version for a committing call.
 *
 * Absent is a client error, never "use current": defaulting it would turn the optimistic check into a
 * comparison of a value with itself and let a commit that landed between the report and the decision be
 * absorbed silently — the same defect the acceptance path was repaired for in Checkpoint 6 (B-6-2).
 */
export function requireExpectedVersion(value: number | undefined): number {
  if (value === undefined)
    throw new ApiError(
      'VALIDATION_FAILED',
      'body.expected_canon_version is required when committing; it is the canon version your impact report was computed at.',
      {
        errors: [
          { path: 'body.expected_canon_version', message: 'required for a committing request' },
        ],
      },
    );
  return value;
}

/**
 * Parse an optional `expected_canon_version`.
 *
 * The type guard is not decoration: `requireInt` coerces with `Number()`, and `Number({})` is `NaN` while
 * `Number([])` is `0` — so an object or empty array reaching it would either produce a confusing error or,
 * worse, silently become version 0. Rejecting a non-number shape here keeps the optimistic-version check
 * honest about what the client actually sent.
 */
function parseExpectedVersion(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new ApiError(
      'VALIDATION_FAILED',
      '"body.expected_canon_version" must be an integer canon version.',
      { errors: [{ path: 'body.expected_canon_version', message: 'must be an integer' }] },
    );
  return requireInt(value, 'body.expected_canon_version', { min: 0, max: 1_000_000 });
}

/** Parse the rollback body: only the expected version and the dry-run flag. */
export function parseRollbackBody(raw: unknown): {
  expectedCanonVersion: number | undefined;
  dryRun: boolean;
} {
  const body = asObject(raw);
  return {
    expectedCanonVersion: parseExpectedVersion(body.expected_canon_version),
    dryRun: body.dry_run === true,
  };
}

/**
 * Translate a `CorrectionError` into the API's problem vocabulary.
 *
 * Each code maps to a distinct operator action, and the mapping is explicit so a new service code cannot
 * silently degrade into a generic 500. `EVIDENCE_REQUIRED` and `CONFIRMATION_REQUIRED` in particular must
 * stay distinguishable from ordinary validation failures: they mean "your request was understood and
 * refused on policy grounds", which is a different instruction to the operator.
 */
export function asApiError(err: unknown): unknown {
  if (!(err instanceof CorrectionError)) return err;
  switch (err.code) {
    case 'JUSTIFICATION_REQUIRED':
    case 'EVIDENCE_REQUIRED':
    case 'CONFIRMATION_REQUIRED':
      return new ApiError('VALIDATION_FAILED', err.detail, { data: { reason: err.code } });
    case 'CANON_STALE':
      // The operator's report is out of date. A retry is meaningful only after re-reading the report, so
      // the data carries both versions.
      return new ApiError('CANON_STALE', err.detail, { data: err.data });
    case 'NOT_FOUND':
      return new ApiError('NOT_FOUND', err.detail);
    case 'ILLEGAL_OP':
      return new ApiError('CONFLICT', err.detail, { data: err.data });
    default:
      return err;
  }
}

/** Run a canon-operator service call, mapping its typed failures to problem documents. */
export async function runCanonOp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asApiError(err);
  }
}

export interface CanonOpDeps {
  readonly pool: Pool;
}

/**
 * Correct a canon item (dry run or commit).
 *
 * The pool is passed rather than the RLS-scoped client because `correctCanonItem` manages its own
 * transaction around `canon.commit_delta` — the atomic canon boundary. Workspace authorization has already
 * been established by the caller, and the project id was resolved through an RLS-scoped read, so the
 * operation cannot reach another tenant's project.
 */
export async function correct(
  deps: CanonOpDeps,
  input: {
    projectId: string;
    request: CorrectionRequest;
    actor: { userId: string; via: string };
  },
): Promise<CorrectionResult> {
  const { request } = input;
  return runCanonOp(() =>
    correctCanonItem(deps.pool, {
      projectId: input.projectId,
      itemKind: request.itemKind,
      itemId: request.itemId,
      newValue: request.newValue,
      ...(request.frame ? { frame: request.frame } : {}),
      ...(request.evidence ? { evidence: request.evidence } : {}),
      justification: request.justification,
      actor: input.actor,
      // A dry run never commits, so its expected version is irrelevant; the committing path demands one.
      expectedCanonVersion: request.dryRun
        ? 0
        : requireExpectedVersion(request.expectedCanonVersion),
      dryRun: request.dryRun,
    }),
  );
}

/** Retcon a canon item (dry run or confirmed commit). */
export async function retcon(
  deps: CanonOpDeps,
  input: {
    projectId: string;
    request: CorrectionRequest;
    actor: { userId: string; via: string };
  },
): Promise<CorrectionResult> {
  const { request } = input;
  return runCanonOp(() =>
    retconCanonItem(deps.pool, {
      projectId: input.projectId,
      itemKind: request.itemKind,
      itemId: request.itemId,
      newValue: request.newValue,
      ...(request.frame ? { frame: request.frame } : {}),
      ...(request.evidence ? { evidence: request.evidence } : {}),
      justification: request.justification,
      actor: input.actor,
      expectedCanonVersion: request.dryRun
        ? 0
        : requireExpectedVersion(request.expectedCanonVersion),
      // Confirmation is the service's requirement, not this layer's: it refuses an unconfirmed retcon with
      // `CONFIRMATION_REQUIRED`, which becomes a 422 naming the reason.
      confirmed: request.confirmed,
      dryRun: request.dryRun,
    }),
  );
}

/** Roll back the latest canon commit (dry run or commit). MVP policy is latest-only, enforced in SQL. */
export async function rollback(
  deps: CanonOpDeps,
  input: {
    projectId: string;
    expectedCanonVersion: number | undefined;
    dryRun: boolean;
    actor: { userId: string; via: string };
  },
): Promise<CorrectionResult & { rollbackable: boolean; reason?: string | undefined }> {
  return runCanonOp(() =>
    rollbackLatestCommit(deps.pool, {
      projectId: input.projectId,
      actor: input.actor,
      expectedCanonVersion: input.dryRun ? 0 : requireExpectedVersion(input.expectedCanonVersion),
      dryRun: input.dryRun,
    }),
  );
}

/** Report what regenerating a chapter would affect. Read-only: it marks nothing. */
export async function regeneration(
  deps: CanonOpDeps,
  input: { projectId: string; chapterNo: number },
): Promise<ImpactReport> {
  return runCanonOp(() => regenerationPreview(deps.pool, input));
}
