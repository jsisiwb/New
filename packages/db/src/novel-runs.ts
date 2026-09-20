/**
 * Novel runs (migration 0019): the durable, queue-driven state of "write this whole novel".
 *
 * A run is one row per project. The API moves it through intake → suggesting → awaiting_approval →
 * planning → producing → completed; the runner claims `planning`/`producing` rows with a fenced lease and
 * advances `next_chapter` as chapter jobs are accepted. Every transition appends a `novel_run_events` row,
 * so what the UI shows is history the database recorded rather than a status a process remembered.
 */
import { type Client, type Pool, rethrowCanon, withTransaction } from './client.js';

type Queryable = Pool | Client;

export type NovelRunStatus =
  | 'intake'
  | 'suggesting'
  | 'awaiting_approval'
  | 'planning'
  | 'producing'
  | 'paused'
  | 'needs_attention'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NovelRunRow {
  id: string;
  workspace_id: string;
  project_id: string;
  status: NovelRunStatus;
  intake_artifact_id: string | null;
  spec_version: number;
  approved_concept_id: string | null;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  target_chapters: number;
  next_chapter: number;
  auto_continue: boolean;
  stop_after_chapter: number | null;
  runner_id: string | null;
  runner_fence: string | number;
  lease_expires_at: Date | null;
  last_error: Record<string, unknown> | null;
  attempts: number;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NovelRunEventRow {
  id: string;
  run_id: string;
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export const NOVEL_RUN_LEASE_SECONDS = 120;

export interface NovelRunLease {
  runner: string;
  fence: string | number;
}

export interface NovelRunTransitionInput {
  runId: string;
  to: NovelRunStatus;
  expectFrom?: readonly NovelRunStatus[] | undefined;
  patch?:
    | {
        approvedConceptId?: string | undefined;
        approvedByUserId?: string | undefined;
        nextChapter?: number | undefined;
        autoContinue?: boolean | undefined;
        stopAfterChapter?: number | null | undefined;
        lastError?: Record<string, unknown> | null | undefined;
        specVersion?: number | undefined;
        targetChapters?: number | undefined;
      }
    | undefined;
  event?: { kind: string; payload?: Record<string, unknown> | undefined } | undefined;
  additionalEvents?: readonly { kind: string; payload?: Record<string, unknown> | undefined }[];
  lease?: NovelRunLease | undefined;
}

export async function getNovelRun(
  db: Queryable,
  projectId: string,
): Promise<NovelRunRow | undefined> {
  const r = await db.query<NovelRunRow>('SELECT * FROM novel_runs WHERE project_id = $1', [
    projectId,
  ]);
  return r.rows[0];
}

export async function getNovelRunById(
  db: Queryable,
  runId: string,
): Promise<NovelRunRow | undefined> {
  const r = await db.query<NovelRunRow>('SELECT * FROM novel_runs WHERE id = $1', [runId]);
  return r.rows[0];
}

/** Create the run for a project (idempotent: an existing run is returned unchanged). */
export async function ensureNovelRun(
  db: Queryable,
  input: {
    workspaceId: string;
    projectId: string;
    intakeArtifactId: string;
    targetChapters: number;
    createdByUserId?: string | undefined;
  },
): Promise<{ run: NovelRunRow; created: boolean }> {
  const existing = await getNovelRun(db, input.projectId);
  if (existing) return { run: existing, created: false };
  const r = await db
    .query<NovelRunRow>(
      `INSERT INTO novel_runs (workspace_id, project_id, status, intake_artifact_id, target_chapters, created_by_user_id)
       VALUES ($1, $2, 'intake', $3, $4, $5)
       ON CONFLICT (project_id) DO NOTHING
       RETURNING *`,
      [
        input.workspaceId,
        input.projectId,
        input.intakeArtifactId,
        input.targetChapters,
        input.createdByUserId ?? null,
      ],
    )
    .catch(rethrowCanon);
  const row = r.rows[0] ?? (await getNovelRun(db, input.projectId));
  if (!row) throw new Error('novel run insert returned no row');
  await emitNovelRunEvent(db, {
    runId: row.id,
    kind: 'run.created',
    payload: { target_chapters: input.targetChapters },
  });
  return { run: row, created: r.rows.length > 0 };
}

export async function emitNovelRunEvent(
  db: Queryable,
  input: {
    runId: string;
    kind: string;
    payload?: Record<string, unknown> | undefined;
    lease?: NovelRunLease | undefined;
  },
): Promise<NovelRunEventRow> {
  // Pool callers need a private transaction so the run-row lock serializes event sequence allocation.
  // Client callers (notably transitionNovelRun) already own the surrounding transaction.
  if ('release' in db) return emitNovelRunEventOnClient(db, input);
  return withTransaction(db, (client) => emitNovelRunEventOnClient(client, input));
}

async function emitNovelRunEventOnClient(
  db: Client,
  input: {
    runId: string;
    kind: string;
    payload?: Record<string, unknown> | undefined;
    lease?: NovelRunLease | undefined;
  },
): Promise<NovelRunEventRow> {
  const run = await db.query<{ workspace_id: string; project_id: string; id: string }>(
    `SELECT workspace_id, project_id, id
       FROM novel_runs
      WHERE id = $1
        AND ($2::text IS NULL OR (runner_id = $2 AND runner_fence = $3::bigint
          AND lease_expires_at > now()))
      FOR UPDATE`,
    [input.runId, input.lease?.runner ?? null, input.lease ? String(input.lease.fence) : null],
  );
  const lockedRun = run.rows[0];
  if (!lockedRun) throw new Error(`novel run ${input.runId} does not exist for event emission`);

  const r = await db
    .query<NovelRunEventRow>(
      `INSERT INTO novel_run_events (workspace_id, project_id, run_id, seq, kind, payload)
       VALUES ($1, $2, $3,
               (SELECT coalesce(max(seq), 0) + 1 FROM novel_run_events WHERE run_id = $3),
               $4, $5::jsonb)
       RETURNING id, run_id, seq, kind, payload, created_at`,
      [
        lockedRun.workspace_id,
        lockedRun.project_id,
        lockedRun.id,
        input.kind,
        JSON.stringify(input.payload ?? {}),
      ],
    )
    .catch(rethrowCanon);
  const row = r.rows[0];
  if (!row) throw new Error(`novel run ${input.runId} does not exist for event emission`);
  return row;
}

export async function listNovelRunEvents(
  db: Queryable,
  runId: string,
  afterSeq = 0,
  limit = 200,
): Promise<NovelRunEventRow[]> {
  const r = await db.query<NovelRunEventRow>(
    `SELECT id, run_id, seq, kind, payload, created_at FROM novel_run_events
      WHERE run_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [runId, afterSeq, limit],
  );
  return r.rows;
}

/**
 * Change the run's status (and optionally other fields) and record the transition. `expectFrom` makes the
 * transition conditional, so two operators racing the same button cannot both win.
 */
export async function transitionNovelRun(
  db: Queryable,
  input: NovelRunTransitionInput,
): Promise<{ run: NovelRunRow; applied: boolean }> {
  // The transition and its audit event must commit together. Client callers are already scoped to a
  // transaction (for example resumeNovelRun), while pool callers get a private transaction here.
  if ('release' in db) return transitionNovelRunOnClient(db, input);
  return withTransaction(db, (client) => transitionNovelRunOnClient(client, input));
}

async function transitionNovelRunOnClient(
  db: Queryable,
  input: NovelRunTransitionInput,
): Promise<{ run: NovelRunRow; applied: boolean }> {
  const p = input.patch ?? {};
  const r = await db
    .query<NovelRunRow>(
      `UPDATE novel_runs SET
         status = $2,
         approved_concept_id = coalesce($3, approved_concept_id),
         approved_by_user_id = coalesce($4::uuid, approved_by_user_id),
         approved_at = CASE WHEN $3::uuid IS NOT NULL THEN now() ELSE approved_at END,
         next_chapter = coalesce($5, next_chapter),
         auto_continue = coalesce($6, auto_continue),
         stop_after_chapter = CASE WHEN $7::boolean THEN $8 ELSE stop_after_chapter END,
         last_error = CASE WHEN $9::boolean THEN $10::jsonb ELSE last_error END,
         spec_version = coalesce($11, spec_version),
         target_chapters = coalesce($12, target_chapters),
         -- Leaving the queue clears the lease so a later claim starts fresh.
         runner_id = CASE WHEN $2 IN ('planning', 'producing') THEN runner_id ELSE NULL END,
         lease_expires_at = CASE WHEN $2 IN ('planning', 'producing') THEN lease_expires_at ELSE NULL END,
         updated_at = now()
       WHERE id = $1 AND ($13::text[] IS NULL OR status = ANY($13::text[]))
         AND ($14::text IS NULL OR (runner_id = $14 AND runner_fence = $15::bigint
           AND lease_expires_at > now()))
       RETURNING *`,
      [
        input.runId,
        input.to,
        p.approvedConceptId ?? null,
        p.approvedByUserId ?? null,
        p.nextChapter ?? null,
        p.autoContinue ?? null,
        p.stopAfterChapter !== undefined,
        p.stopAfterChapter ?? null,
        p.lastError !== undefined,
        p.lastError === undefined || p.lastError === null ? null : JSON.stringify(p.lastError),
        p.specVersion ?? null,
        p.targetChapters ?? null,
        input.expectFrom ? [...input.expectFrom] : null,
        input.lease?.runner ?? null,
        input.lease ? String(input.lease.fence) : null,
      ],
    )
    .catch(rethrowCanon);
  const row = r.rows[0];
  if (!row) {
    const current = await getNovelRunById(db, input.runId);
    if (!current) throw new Error(`novel run ${input.runId} does not exist`);
    return { run: current, applied: false };
  }
  await emitNovelRunEvent(db, {
    runId: row.id,
    kind: input.event?.kind ?? `run.${input.to}`,
    payload: { status: input.to, next_chapter: row.next_chapter, ...(input.event?.payload ?? {}) },
  });
  for (const event of input.additionalEvents ?? [])
    await emitNovelRunEvent(db, {
      runId: row.id,
      kind: event.kind,
      payload: { status: row.status, next_chapter: row.next_chapter, ...(event.payload ?? {}) },
    });
  return { run: row, applied: true };
}

/** Claim one claimable run for this runner, or return undefined when there is none. */
export async function claimNovelRun(
  db: Queryable,
  runner: string,
  ttlSeconds = NOVEL_RUN_LEASE_SECONDS,
): Promise<NovelRunRow | undefined> {
  const r = await db.query<NovelRunRow>('SELECT * FROM canon.claim_novel_run($1, $2)', [
    runner,
    ttlSeconds,
  ]);
  return r.rows[0];
}

export async function renewNovelRun(
  db: Queryable,
  input: { runId: string; runner: string; fence: string | number; ttlSeconds?: number | undefined },
): Promise<boolean> {
  const r = await db.query<{ renewed: boolean }>(
    'SELECT canon.renew_novel_run($1, $2, $3, $4) AS renewed',
    [input.runId, input.runner, String(input.fence), input.ttlSeconds ?? NOVEL_RUN_LEASE_SECONDS],
  );
  return r.rows[0]?.renewed ?? false;
}

/** Release the runner lease without changing status (the run stays claimable). */
export async function releaseNovelRun(
  db: Queryable,
  input: { runId: string; runner: string; fence: string | number },
): Promise<void> {
  await db.query(
    `UPDATE novel_runs SET runner_id = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1 AND runner_id = $2 AND runner_fence = $3`,
    [input.runId, input.runner, String(input.fence)],
  );
}
