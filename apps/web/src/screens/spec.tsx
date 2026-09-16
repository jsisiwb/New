/**
 * Screen 3 — Story specification and assumption review (Checkpoint 7, UI plan §2).
 *
 * Two things this screen is careful about, both of which are product invariants rather than presentation
 * choices:
 *
 *  * A STALE EDIT IS SHOWN AS A CONFLICT, NOT SWALLOWED. The editor submits the `expected_version` it
 *    loaded. When the API answers 409 the operator is told someone else changed the spec and is offered a
 *    reload — the edit is never silently retried against the newer version, which would overwrite work the
 *    operator never saw.
 *  * A DECISION IS NOT A PROMOTION. The API records an assumption decision without rewriting the spec, and
 *    this screen says so in as many words, because an operator who believes "confirm" edited the
 *    requirement would stop before doing the edit that actually applies it.
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useAppState } from '../components/app-state';
import { newIdempotencyKey, useMutation, useResource } from '../lib/use-resource';
import {
  AsyncRegion,
  ErrorSummary,
  Field,
  Form,
  LiveRegion,
  StatusBadge,
  type StatusTone,
} from '../components/primitives';

interface SpecResponse {
  readonly project_id: string;
  readonly version: number;
  readonly source: string;
  readonly payload: Record<string, unknown>;
  readonly counts: { readonly total: number; readonly assumptions: number };
}

interface AssumptionItem {
  readonly id: string;
  readonly category: string;
  readonly text: string;
  readonly language: string;
  readonly rationale?: string;
  readonly review_status: 'pending' | 'confirm' | 'edit' | 'reject';
}

export function reviewTone(status: AssumptionItem['review_status']): StatusTone {
  if (status === 'confirm') return 'good';
  if (status === 'reject') return 'bad';
  if (status === 'edit') return 'attention';
  return 'neutral';
}

export function SpecScreen({ projectId }: { projectId: string }): ReactNode {
  const { api, can } = useAppState();
  const spec = useResource<SpecResponse>(
    () => api.get(`/v1/projects/${projectId}/spec`),
    [projectId],
  );
  const save = useMutation();
  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');

  // The editor is seeded from whatever version loaded, so an edit always starts from the current document.
  useEffect(() => {
    if (spec.data) setDraft(JSON.stringify(spec.data.payload, null, 2));
  }, [spec.data]);

  const conflicted = save.problem?.code === 'CONFLICT';

  return (
    <section aria-labelledby="spec-heading">
      <h1 id="spec-heading">Story specification</h1>
      <LiveRegion message={announcement} />
      <AsyncRegion loading={spec.loading} error={spec.error} label="the story specification">
        {spec.data ? (
          <>
            <dl className="summary">
              <dt>Version</dt>
              <dd data-testid="spec-version">{spec.data.version}</dd>
              <dt>Source</dt>
              <dd>{spec.data.source}</dd>
              <dt>Requirements</dt>
              <dd>{spec.data.counts.total}</dd>
              <dt>Assumptions</dt>
              <dd>{spec.data.counts.assumptions}</dd>
            </dl>

            {save.error ? (
              <>
                <ErrorSummary
                  title={
                    conflicted
                      ? 'This specification changed while you were editing'
                      : 'Could not save'
                  }
                  message={save.error}
                  fields={save.problem?.fieldErrors ?? []}
                />
                {conflicted ? (
                  <button
                    type="button"
                    onClick={() => {
                      save.clear();
                      spec.reload();
                    }}
                  >
                    Reload the current version
                  </button>
                ) : null}
              </>
            ) : null}

            {can('editor') ? (
              <Form
                label="Edit story specification"
                onSubmit={() => {
                  save.run(async () => {
                    let payload: unknown;
                    try {
                      payload = JSON.parse(draft);
                    } catch {
                      throw new Error('invalid json');
                    }
                    await api.put(
                      `/v1/projects/${projectId}/spec`,
                      // The version the operator actually looked at; the server arbitrates the race.
                      { expected_version: spec.data?.version ?? 0, payload },
                      newIdempotencyKey(),
                    );
                    setAnnouncement('Story specification saved as a new version.');
                    spec.reload();
                  });
                }}
              >
                <Field
                  path="payload"
                  label="Specification document (JSON)"
                  hint="Validated against the same schema the production loop uses."
                >
                  {(props) => (
                    <textarea
                      {...props}
                      rows={12}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                      }}
                    />
                  )}
                </Field>
                <button type="submit" disabled={save.busy}>
                  {save.busy ? 'Saving…' : 'Save new version'}
                </button>
              </Form>
            ) : (
              <p className="note">
                Your role allows viewing this specification but not editing it.
              </p>
            )}
          </>
        ) : null}
      </AsyncRegion>

      <AssumptionReview projectId={projectId} />
    </section>
  );
}

export function AssumptionReview({ projectId }: { projectId: string }): ReactNode {
  const { api, can } = useAppState();
  const assumptions = useResource<{ spec_version: number; items: readonly AssumptionItem[] }>(
    () => api.get(`/v1/projects/${projectId}/spec/assumptions`),
    [projectId],
  );
  const decide = useMutation();
  const [announcement, setAnnouncement] = useState('');

  return (
    <section aria-labelledby="assumptions-heading">
      <h2 id="assumptions-heading">Assumption review</h2>
      <LiveRegion message={announcement} />
      <p className="note">
        Recording a decision does not rewrite the specification. Applying a confirmed assumption is
        a specification edit, saved as a new version.
      </p>
      {decide.error ? <ErrorSummary message={decide.error} /> : null}
      <AsyncRegion
        loading={assumptions.loading}
        error={assumptions.error}
        empty={(assumptions.data?.items.length ?? 0) === 0}
        emptyMessage="This specification has no assumptions to review."
        label="assumptions"
      >
        <ul className="card-list">
          {(assumptions.data?.items ?? []).map((item) => (
            <li key={item.id}>
              <article aria-labelledby={`assumption-${item.id}`}>
                <h3 id={`assumption-${item.id}`}>
                  {item.id}{' '}
                  <StatusBadge label={item.review_status} tone={reviewTone(item.review_status)} />
                </h3>
                <p lang={item.language}>{item.text}</p>
                {item.rationale ? <p className="note">Why: {item.rationale}</p> : null}
                {can('editor') && item.review_status === 'pending' ? (
                  <div className="actions">
                    <button
                      type="button"
                      onClick={() => {
                        decide.run(async () => {
                          await api.post(
                            `/v1/projects/${projectId}/spec/assumptions/${item.id}/decision`,
                            { decision: 'confirm', promoted_kind: 'hard' },
                            newIdempotencyKey(),
                          );
                          setAnnouncement(`${item.id} confirmed as a hard requirement.`);
                          assumptions.reload();
                        });
                      }}
                    >
                      Confirm {item.id} as hard
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        decide.run(async () => {
                          await api.post(
                            `/v1/projects/${projectId}/spec/assumptions/${item.id}/decision`,
                            {
                              decision: 'reject',
                              rationale: 'Rejected during operator review.',
                            },
                            newIdempotencyKey(),
                          );
                          setAnnouncement(`${item.id} rejected.`);
                          assumptions.reload();
                        });
                      }}
                    >
                      Reject {item.id}
                    </button>
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </AsyncRegion>
    </section>
  );
}
