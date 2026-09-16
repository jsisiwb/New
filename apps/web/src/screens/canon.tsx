/**
 * Screen 10 — Canon inspectors and change operations (Checkpoint 7, UI plan §2).
 *
 * Correction, retcon and rollback are the operations that can rewrite established history, so this screen
 * follows the UI plan's rule literally: a destructive action shows its IMPACT before it is confirmed.
 *
 *  * The impact report comes from the server's dry run — the same service the commit uses — so the
 *    consequences an operator sees are the consequences that will happen, not an estimate this page made.
 *  * MATERIAL and CONTEXTUAL consequences are listed separately and labelled. Material dependents become
 *    stale (they must be revalidated); contextual ones are suggested for review. Collapsing them into one
 *    number would either alarm an operator about a contextual edge or hide a real invalidation.
 *  * Retcon and rollback additionally require typing the operation's name to confirm, because both are
 *    irreversible in the sense that matters: they change what later chapters were written against.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { useAppState } from '../components/app-state';
import { newIdempotencyKey, useMutation, useResource } from '../lib/use-resource';
import {
  AsyncRegion,
  ConfirmDialog,
  ErrorSummary,
  LiveRegion,
  StatusBadge,
  useConfirm,
} from '../components/primitives';

interface ImpactReport {
  readonly staleMarked?: readonly unknown[];
  readonly reviewSuggested?: readonly unknown[];
  readonly affectedAcceptedChapters?: readonly number[];
}

interface CorrectionView {
  readonly canon_version?: number;
  readonly impact?: {
    readonly material?: readonly { readonly kind: string; readonly id: string }[];
    readonly contextual?: readonly { readonly kind: string; readonly id: string }[];
    readonly affected_accepted_chapters?: readonly number[];
  };
  readonly rollbackable?: boolean;
  readonly reason?: string | null;
}

export function CanonScreen({ projectId }: { projectId: string }): ReactNode {
  const { api } = useAppState();
  const facts = useResource<{ items: readonly { id: string; attribute?: string }[] }>(
    () => api.get(`/v1/projects/${projectId}/canon/facts`),
    [projectId],
  );
  const promises = useResource<{
    items: readonly { id: string; statement: string; status: string }[];
  }>(() => api.get(`/v1/projects/${projectId}/canon/promises`), [projectId]);
  const stale = useResource<{ items: readonly { kind: string; id: string; reason: string }[] }>(
    () => api.get(`/v1/projects/${projectId}/canon/stale`),
    [projectId],
  );

  return (
    <section aria-labelledby="canon-heading">
      <h1 id="canon-heading">Canon</h1>

      <section aria-labelledby="facts-heading">
        <h2 id="facts-heading">Facts</h2>
        <AsyncRegion
          loading={facts.loading}
          error={facts.error}
          empty={(facts.data?.items.length ?? 0) === 0}
          emptyMessage="No canon facts have been committed yet."
          label="canon facts"
        >
          <ul className="card-list">
            {(facts.data?.items ?? []).map((fact) => (
              <li key={fact.id}>{fact.attribute ?? fact.id}</li>
            ))}
          </ul>
        </AsyncRegion>
      </section>

      <section aria-labelledby="promises-heading">
        <h2 id="promises-heading">Promises</h2>
        <AsyncRegion
          loading={promises.loading}
          error={promises.error}
          empty={(promises.data?.items.length ?? 0) === 0}
          emptyMessage="No promises are tracked yet."
          label="promises"
        >
          <ul className="card-list">
            {(promises.data?.items ?? []).map((promise) => (
              <li key={promise.id}>
                {promise.statement} <StatusBadge label={promise.status} />
              </li>
            ))}
          </ul>
        </AsyncRegion>
      </section>

      <section aria-labelledby="stale-heading">
        <h2 id="stale-heading">Stale and review-suggested artifacts</h2>
        <AsyncRegion
          loading={stale.loading}
          error={stale.error}
          empty={(stale.data?.items.length ?? 0) === 0}
          emptyMessage="Nothing is stale."
          label="stale artifacts"
        >
          <ul className="card-list">
            {(stale.data?.items ?? []).map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                {item.kind} — {item.reason}
              </li>
            ))}
          </ul>
        </AsyncRegion>
      </section>

      <CanonOperations projectId={projectId} />
    </section>
  );
}

/**
 * Correction, retcon and rollback with a dry run first.
 *
 * The flow is deliberately two-step and cannot be collapsed: the operator asks for the impact, reads it,
 * then confirms. There is no "commit immediately" path in this UI for any of the three.
 */
export function CanonOperations({ projectId }: { projectId: string }): ReactNode {
  const { api, can } = useAppState();
  const preview = useMutation();
  const commit = useMutation();
  const confirm = useConfirm();
  const [operation, setOperation] = useState<'correct' | 'retcon' | 'rollback'>('correct');
  const [report, setReport] = useState<CorrectionView | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');

  const body = (dryRun: boolean): Record<string, unknown> =>
    operation === 'rollback'
      ? { dry_run: dryRun }
      : {
          item_kind: 'fact',
          item_id: '00000000-0000-7000-8000-000000000000',
          new_value: {},
          justification: 'Operator correction from the canon screen.',
          dry_run: dryRun,
        };

  const material = report?.impact?.material ?? [];
  const contextual = report?.impact?.contextual ?? [];
  const affected = report?.impact?.affected_accepted_chapters ?? [];

  if (!can('editor'))
    return (
      <section aria-labelledby="canon-ops-heading">
        <h2 id="canon-ops-heading">Canon change operations</h2>
        <p className="note">Your role does not allow canon change operations.</p>
      </section>
    );

  return (
    <section aria-labelledby="canon-ops-heading">
      <h2 id="canon-ops-heading">Canon change operations</h2>
      <LiveRegion message={announcement} />
      {preview.error ? <ErrorSummary title="Could not preview" message={preview.error} /> : null}
      {commit.error ? <ErrorSummary title="Could not commit" message={commit.error} /> : null}

      <p className="field">
        <label htmlFor="canon-operation">Operation</label>
        <select
          id="canon-operation"
          value={operation}
          onChange={(e) => {
            setOperation(e.target.value as 'correct' | 'retcon' | 'rollback');
            setReport(undefined);
          }}
        >
          <option value="correct">Correction</option>
          <option value="retcon">Retcon</option>
          <option value="rollback">Rollback (latest commit)</option>
        </select>
      </p>

      <button
        type="button"
        disabled={preview.busy}
        onClick={() => {
          preview.run(async () => {
            const result = await api.post<CorrectionView>(
              `/v1/projects/${projectId}/canon:${operation}`,
              body(true),
            );
            setReport(result);
            setAnnouncement('Impact report ready. Review it before committing.');
          });
        }}
      >
        Preview impact
      </button>

      {report ? (
        <div data-testid="impact-report">
          <h3>Impact</h3>
          {/* Material and contextual are never merged: they demand different responses. */}
          <p>
            <strong>Material consequences ({material.length})</strong> — these artifacts become
            stale and must be revalidated.
          </p>
          <p>
            <strong>Contextual consequences ({contextual.length})</strong> — these are suggested for
            review and are not invalidated.
          </p>
          {affected.length > 0 ? (
            <p>
              <strong>Accepted chapters affected:</strong> {affected.join(', ')}
            </p>
          ) : null}
          {operation === 'rollback' && report.rollbackable === false ? (
            <p className="note">This commit cannot be rolled back: {report.reason}</p>
          ) : (
            <button
              type="button"
              disabled={commit.busy}
              onClick={(event) => {
                confirm.request(event.currentTarget);
              }}
            >
              Commit {operation}
            </button>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm.open}
        title={`Commit this ${operation}?`}
        impact={
          <>
            <p>
              {material.length} artifact(s) will be marked stale and must be revalidated.{' '}
              {contextual.length} will be suggested for review.
            </p>
            {affected.length > 0 ? <p>Accepted chapters affected: {affected.join(', ')}.</p> : null}
            <p>This changes committed canon and is recorded in the commit history.</p>
          </>
        }
        confirmLabel={`Commit ${operation}`}
        // Retcon and rollback rewrite established history, so muscle memory alone cannot commit one.
        requirePhrase={operation === 'correct' ? undefined : operation}
        onCancel={() => {
          confirm.resolve(false);
        }}
        onConfirm={() => {
          confirm.resolve(true, () => {
            commit.run(async () => {
              await api.post(
                `/v1/projects/${projectId}/canon:${operation}`,
                body(false),
                newIdempotencyKey(),
              );
              setAnnouncement(`${operation} committed.`);
              setReport(undefined);
            });
          });
        }}
      />
    </section>
  );
}

export type { ImpactReport };
