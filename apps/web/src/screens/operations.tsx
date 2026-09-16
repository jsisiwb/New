/**
 * Screen 11 — Operations: jobs, live progress, costs, budgets and export (Checkpoint 7).
 *
 * The live progress here is the SSE stream, and the honesty rules it follows are worth naming because each
 * one corresponds to an operator mistake it prevents:
 *
 *  * A REPLAYED EVENT NEVER MOVES A JOB BACKWARDS. `foldJobEvent` refuses to relabel a terminal status from
 *    a non-terminal replayed event, so a reconnect cannot make a completed run look running — and an
 *    operator cannot then "cancel" something that already accepted canon.
 *  * `too_late` IS A REAL OUTCOME, NOT AN ERROR. A cancel that loses the race with acceptance is reported
 *    as such, because telling the operator it failed would invite a retry against a finished job.
 *  * DISCONNECTED IS VISIBLE. The connection state is rendered in words; a silently dead stream that looks
 *    idle is the difference between "nothing is happening" and "I cannot see what is happening".
 *  * HEARTBEATS ARE NOT ANNOUNCED. Only meaningful transitions reach the live region.
 */
'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import {
  foldJobEvent,
  JobEventStream,
  type EventSourceFactory,
  type JobStreamState,
  type JobView,
} from '../lib/job-events';
import { chapterTone, statusExplanation } from './chapters';

interface JobRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly control: string;
  readonly current_step: string | null;
  readonly spend_cents: number;
}

interface ExportRow {
  readonly id: string;
  readonly format: string;
  readonly status: string;
  readonly download_path: string | null;
  readonly byte_size: number | null;
}

/**
 * The browser's own EventSource, which restores `Last-Event-ID` on its internal retries.
 *
 * Tests inject a fake instead, which is why this is a parameter rather than a hard-coded global: the replay
 * semantics have to be provable without a live server.
 */
export const browserEventSource: EventSourceFactory = (url, lastEventId) => {
  const withCursor = lastEventId
    ? `${url}${url.includes('?') ? '&' : '?'}last_event_id=${encodeURIComponent(lastEventId)}`
    : url;
  return new EventSource(withCursor, {
    withCredentials: true,
  }) as unknown as ReturnType<EventSourceFactory>;
};

export function OperationsScreen({
  projectId,
  eventSourceFactory = browserEventSource,
}: {
  projectId: string;
  eventSourceFactory?: EventSourceFactory;
}): ReactNode {
  return (
    <section aria-labelledby="operations-heading">
      <h1 id="operations-heading">Operations</h1>
      <JobsPanel projectId={projectId} eventSourceFactory={eventSourceFactory} />
      <CostsPanel projectId={projectId} />
      <ExportPanel projectId={projectId} />
    </section>
  );
}

export function JobsPanel({
  projectId,
  eventSourceFactory,
}: {
  projectId: string;
  eventSourceFactory: EventSourceFactory;
}): ReactNode {
  const { api, can } = useAppState();
  const jobs = useResource<{ items: readonly JobRow[] }>(
    () => api.get(`/v1/projects/${projectId}/jobs`),
    [projectId],
  );
  const control = useMutation();
  const confirm = useConfirm();
  const [announcement, setAnnouncement] = useState('');
  const [followed, setFollowed] = useState<string | undefined>(undefined);

  const act = (jobId: string, action: 'pause' | 'resume' | 'cancel') => {
    control.run(async () => {
      const result = await api.post<{ status?: string; outcome?: string }>(
        `/v1/jobs/${jobId}:${action}`,
        {},
        newIdempotencyKey(),
      );
      // `too_late` is an OUTCOME: the job finished before the cancel landed, and accepted work stays
      // accepted. Reporting it as a failure would invite a pointless retry.
      setAnnouncement(
        result.outcome === 'too_late'
          ? 'That job had already finished, so the cancel had no effect. Its result stands.'
          : `Job ${action} requested.`,
      );
      jobs.reload();
    });
  };

  return (
    <section aria-labelledby="jobs-heading">
      <h2 id="jobs-heading">Jobs</h2>
      <LiveRegion message={announcement} />
      {control.error ? <ErrorSummary message={control.error} /> : null}
      <AsyncRegion
        loading={jobs.loading}
        error={jobs.error}
        empty={(jobs.data?.items.length ?? 0) === 0}
        emptyMessage="No jobs have run for this project."
        label="jobs"
      >
        <table>
          <caption>Jobs, their control state and spend</caption>
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Status</th>
              <th scope="col">Step</th>
              <th scope="col">Spend</th>
              <th scope="col">Controls</th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data?.items ?? []).map((job) => (
              <tr key={job.id}>
                <th scope="row">{job.kind}</th>
                <td>
                  <StatusBadge
                    label={job.status}
                    tone={chapterTone(job.status)}
                    detail={statusExplanation(job.status)}
                  />
                </td>
                <td>{job.current_step ?? '—'}</td>
                <td>{(job.spend_cents / 100).toFixed(2)} USD</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      setFollowed(job.id);
                    }}
                  >
                    Follow progress of {job.kind}
                  </button>
                  {can('editor') ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          act(job.id, 'pause');
                        }}
                      >
                        Pause
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          act(job.id, 'resume');
                        }}
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          confirm.request(event.currentTarget);
                          setFollowed(job.id);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AsyncRegion>

      {followed ? <JobProgress jobId={followed} eventSourceFactory={eventSourceFactory} /> : null}

      <ConfirmDialog
        open={confirm.open}
        title="Cancel this job?"
        impact={
          <p>
            The run stops at its next checkpoint. Work already accepted into canon is not undone,
            and if the job finishes first the cancel has no effect.
          </p>
        }
        confirmLabel="Cancel the job"
        onCancel={() => {
          confirm.resolve(false);
        }}
        onConfirm={() => {
          confirm.resolve(true, () => {
            if (followed) act(followed, 'cancel');
          });
        }}
      />
    </section>
  );
}

const STREAM_LABEL: Record<JobStreamState, string> = {
  connecting: 'Connecting to live progress…',
  open: 'Live progress connected.',
  reconnecting: 'Disconnected — reconnecting and replaying missed events…',
  closed: 'Live progress finished.',
};

/**
 * Follow one job's events.
 *
 * The rendered status starts from nothing and is only advanced by events above the applied watermark, so a
 * replay cannot move it backwards. Connection state is separate from job state, because "I lost the
 * connection" and "the job stopped" are different facts and conflating them misleads.
 */
export function JobProgress({
  jobId,
  eventSourceFactory,
}: {
  jobId: string;
  eventSourceFactory: EventSourceFactory;
}): ReactNode {
  const [view, setView] = useState<JobView>({
    status: 'unknown',
    step: undefined,
    seenSeq: 0,
    terminal: false,
  });
  const [streamState, setStreamState] = useState<JobStreamState>('connecting');
  const streamRef = useRef<JobEventStream | undefined>(undefined);

  const onEvent = useCallback((event: Parameters<typeof foldJobEvent>[1]) => {
    setView((current) => foldJobEvent(current, event));
  }, []);

  useEffect(() => {
    const stream = new JobEventStream(`/v1/jobs/${jobId}/events`, eventSourceFactory, {
      onEvent,
      onStateChange: setStreamState,
    });
    streamRef.current = stream;
    stream.start();
    return () => {
      stream.close();
    };
  }, [jobId, eventSourceFactory, onEvent]);

  return (
    <section aria-labelledby={`progress-${jobId}`}>
      <h3 id={`progress-${jobId}`}>Live progress</h3>
      {/* Connection state is a status, not an alert, and heartbeats never reach it. */}
      <p role="status" data-testid="stream-state">
        {STREAM_LABEL[streamState]}
      </p>
      <dl className="summary">
        <dt>Status</dt>
        <dd data-testid="job-status">
          <StatusBadge
            label={view.status}
            tone={chapterTone(view.status)}
            detail={statusExplanation(view.status)}
          />
        </dd>
        <dt>Step</dt>
        <dd data-testid="job-step">{view.step ?? '—'}</dd>
      </dl>
    </section>
  );
}

export function CostsPanel({ projectId }: { projectId: string }): ReactNode {
  const { api } = useAppState();
  const costs = useResource<{
    total_cents: number;
    items: readonly { group: string; cents: number }[];
  }>(() => api.get(`/v1/projects/${projectId}/costs`), [projectId]);
  const budgets = useResource<{ limit_cents: number | null; spent_cents: number }>(
    () => api.get(`/v1/projects/${projectId}/budgets`),
    [projectId],
  );

  return (
    <section aria-labelledby="costs-heading">
      <h2 id="costs-heading">Costs and budgets</h2>
      <AsyncRegion loading={costs.loading} error={costs.error} label="costs">
        <p>Total spend: {((costs.data?.total_cents ?? 0) / 100).toFixed(2)} USD</p>
      </AsyncRegion>
      <AsyncRegion loading={budgets.loading} error={budgets.error} label="budgets">
        <p>
          Budget:{' '}
          {budgets.data?.limit_cents === null || budgets.data?.limit_cents === undefined
            ? 'no limit set'
            : `${(budgets.data.limit_cents / 100).toFixed(2)} USD`}
        </p>
      </AsyncRegion>
    </section>
  );
}

export function ExportPanel({ projectId }: { projectId: string }): ReactNode {
  const { api, can } = useAppState();
  const create = useMutation();
  const [created, setCreated] = useState<ExportRow | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');

  return (
    <section aria-labelledby="export-heading">
      <h2 id="export-heading">Export</h2>
      <LiveRegion message={announcement} />
      <p className="note">Exports contain accepted chapters only.</p>
      {create.error ? <ErrorSummary message={create.error} /> : null}
      {can('editor') ? (
        <div className="actions">
          {(['txt', 'docx'] as const).map((format) => (
            <button
              key={format}
              type="button"
              disabled={create.busy}
              onClick={() => {
                create.run(async () => {
                  const row = await api.post<ExportRow>(
                    `/v1/projects/${projectId}/exports`,
                    { format },
                    newIdempotencyKey(),
                  );
                  setCreated(row);
                  setAnnouncement(`Export requested as ${format.toUpperCase()}.`);
                });
              }}
            >
              Create {format.toUpperCase()} export
            </button>
          ))}
        </div>
      ) : null}
      {created ? (
        <div data-testid="export-result">
          <StatusBadge
            label={created.status}
            tone={created.status === 'ready' ? 'good' : 'progress'}
          />
          {created.download_path ? (
            // A download link, not a filesystem path: the server streams authorized bytes.
            <a href={created.download_path} download>
              Download the {created.format.toUpperCase()} export
            </a>
          ) : (
            <p>The export is not ready to download yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
