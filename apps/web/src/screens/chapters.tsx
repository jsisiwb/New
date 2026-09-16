/**
 * Screens 8 and 9 — Chapter list / production, and candidate & scorecard review (Checkpoint 7).
 *
 * The invariant these two screens exist to make visible is ACCEPTED-ONLY, WINNER-ONLY. A chapter's accepted
 * version is whatever the server says `accepted_version_id` is, and every other draft — working, losing,
 * rejected, quarantined — is rendered with its own status word and is never styled or labelled as accepted.
 * Nothing here computes acceptance; it only displays what the canon path already decided.
 *
 * Production status covers the full set the job layer can report — provider-waiting, budget-blocked,
 * paused, cancelled, failed, completed and needs-attention — because an operator who cannot distinguish
 * "blocked on budget" from "failed" will retry the wrong thing and spend money doing it.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { useAppState } from '../components/app-state';
import { newIdempotencyKey, useMutation, useResource } from '../lib/use-resource';
import {
  AsyncRegion,
  ConfirmDialog,
  ErrorSummary,
  Field,
  Form,
  LiveRegion,
  StatusBadge,
  useConfirm,
  type StatusTone,
} from '../components/primitives';

interface ChapterRow {
  readonly number: number;
  readonly status: string;
  readonly accepted_version_id: string | null;
}

interface CandidateRow {
  readonly id: string;
  readonly version_no: number;
  readonly status: string;
  readonly origin: string;
  readonly is_accepted: boolean;
  readonly is_winner: boolean;
  readonly is_loser: boolean;
}

interface CandidatesResponse {
  readonly chapter_no: number;
  readonly accepted_version_id: string | null;
  readonly selection: {
    readonly status: string;
    readonly winner_manuscript_version_id: string | null;
    readonly selection_required: boolean;
  } | null;
  readonly items: readonly CandidateRow[];
}

/** Status → tone. Tone is decoration; the label always carries the meaning. */
export function chapterTone(status: string): StatusTone {
  switch (status) {
    case 'accepted':
      return 'good';
    case 'failed':
      return 'bad';
    case 'cancelled':
      return 'bad';
    case 'needs_attention':
    case 'waiting_review':
    case 'paused_budget':
    case 'paused':
      return 'attention';
    case 'running':
    case 'producing':
      return 'progress';
    default:
      return 'neutral';
  }
}

/** A plain-English gloss so a status word is never the only explanation an operator gets. */
export function statusExplanation(status: string): string {
  switch (status) {
    case 'paused_budget':
      return 'blocked by the project budget; nothing was spent';
    case 'waiting_review':
      return 'waiting for an operator decision';
    case 'needs_attention':
      return 'stopped and needs a decision';
    case 'paused':
      return 'paused by an operator; resumable';
    case 'cancelled':
      return 'cancelled; artifacts are not canon';
    case 'failed':
      return 'failed; see the trace';
    case 'running':
      return 'in progress';
    case 'completed':
      return 'finished';
    case 'accepted':
      return 'accepted into canon';
    default:
      return status;
  }
}

export function ChaptersScreen({
  projectId,
  onOpenChapter,
}: {
  projectId: string;
  onOpenChapter: (chapterNo: number) => void;
}): ReactNode {
  const { api, can } = useAppState();
  const chapters = useResource<{ items: readonly ChapterRow[] }>(
    () => api.get(`/v1/projects/${projectId}/chapters`),
    [projectId],
  );
  const start = useMutation();
  const [announcement, setAnnouncement] = useState('');
  const [chapterNo, setChapterNo] = useState('1');

  return (
    <section aria-labelledby="chapters-heading">
      <h1 id="chapters-heading">Chapters</h1>
      <LiveRegion message={announcement} />
      {start.error ? (
        <ErrorSummary
          title={
            start.problem?.code === 'BUDGET_EXHAUSTED'
              ? 'Production was refused before any spend'
              : 'Could not start production'
          }
          message={start.error}
        />
      ) : null}
      <AsyncRegion
        loading={chapters.loading}
        error={chapters.error}
        empty={(chapters.data?.items.length ?? 0) === 0}
        emptyMessage="No chapters exist yet."
        label="chapters"
      >
        <table>
          <caption>Chapter status. Only an accepted chapter is part of canon.</caption>
          <thead>
            <tr>
              <th scope="col">Chapter</th>
              <th scope="col">Status</th>
              <th scope="col">Accepted</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody>
            {(chapters.data?.items ?? []).map((chapter) => (
              <tr key={chapter.number}>
                <th scope="row">Chapter {chapter.number}</th>
                <td>
                  <StatusBadge
                    label={chapter.status}
                    tone={chapterTone(chapter.status)}
                    detail={statusExplanation(chapter.status)}
                  />
                </td>
                <td>{chapter.accepted_version_id ? 'yes' : 'no'}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChapter(chapter.number);
                    }}
                  >
                    Review chapter {chapter.number}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </AsyncRegion>

      {can('editor') ? (
        <section aria-labelledby="start-production-heading">
          <h2 id="start-production-heading">Start production</h2>
          <Form
            label="Start chapter production"
            onSubmit={() => {
              start.run(async () => {
                await api.post(
                  `/v1/projects/${projectId}/chapters/${chapterNo}/production`,
                  {},
                  // A stable key per chapter: a duplicate start is absorbed rather than double-spending.
                  `start:${projectId}:${chapterNo}`,
                );
                setAnnouncement(`Production requested for chapter ${chapterNo}.`);
                chapters.reload();
              });
            }}
          >
            <Field path="chapter-no" label="Chapter number">
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={1}
                  value={chapterNo}
                  onChange={(e) => {
                    setChapterNo(e.target.value);
                  }}
                />
              )}
            </Field>
            <button type="submit" disabled={start.busy}>
              Start production
            </button>
          </Form>
        </section>
      ) : null}
    </section>
  );
}

export function CandidateReviewScreen({
  projectId,
  chapterNo,
}: {
  projectId: string;
  chapterNo: number;
}): ReactNode {
  const { api, can } = useAppState();
  const candidates = useResource<CandidatesResponse>(
    () => api.get(`/v1/projects/${projectId}/chapters/${chapterNo}/candidates`),
    [projectId, chapterNo],
  );
  const scorecards = useResource<{ items: readonly { artifact_id: string; scorecard: unknown }[] }>(
    () => api.get(`/v1/projects/${projectId}/chapters/${chapterNo}/scorecards`),
    [projectId, chapterNo],
  );
  const review = useMutation();
  const [announcement, setAnnouncement] = useState('');
  const [note, setNote] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<string | undefined>(undefined);
  const confirm = useConfirm();

  const versionId = selectedVersion ?? candidates.data?.items[0]?.id;

  const submit = (decision: 'request_changes' | 'reject' | 'approve') => {
    review.run(async () => {
      await api.post(
        `/v1/projects/${projectId}/chapters/${chapterNo}/reviews`,
        {
          decision,
          manuscript_version_id: versionId,
          ...(decision === 'approve' ? {} : { note: note || 'Operator review.' }),
        },
        newIdempotencyKey(),
      );
      setAnnouncement(`Chapter ${chapterNo}: ${decision.replace('_', ' ')} recorded.`);
      setNote('');
      candidates.reload();
    });
  };

  return (
    <section aria-labelledby="candidates-heading">
      <h1 id="candidates-heading">Chapter {chapterNo} — candidates and scorecards</h1>
      <LiveRegion message={announcement} />
      {review.error ? <ErrorSummary message={review.error} /> : null}

      <AsyncRegion
        loading={candidates.loading}
        error={candidates.error}
        empty={(candidates.data?.items.length ?? 0) === 0}
        emptyMessage="This chapter has no drafts yet."
        label="candidates"
      >
        <ul className="compare-grid">
          {(candidates.data?.items ?? []).map((candidate) => (
            <li
              key={candidate.id}
              data-status={candidate.status}
              data-accepted={candidate.is_accepted ? 'true' : 'false'}
            >
              <article aria-labelledby={`candidate-${candidate.id}`}>
                <h2 id={`candidate-${candidate.id}`}>
                  Version {candidate.version_no}{' '}
                  {/* Explicit words for every lifecycle state: accepted, winner, not selected, draft. */}
                  <StatusBadge
                    label={
                      candidate.is_accepted
                        ? 'accepted'
                        : candidate.is_winner
                          ? 'selected winner'
                          : candidate.is_loser
                            ? 'not selected'
                            : candidate.status
                    }
                    tone={
                      candidate.is_accepted
                        ? 'good'
                        : candidate.is_winner
                          ? 'progress'
                          : candidate.is_loser
                            ? 'neutral'
                            : 'neutral'
                    }
                  />
                </h2>
                <p>Origin: {candidate.origin}</p>
                <p>
                  <label>
                    <input
                      type="radio"
                      name="review-version"
                      value={candidate.id}
                      checked={versionId === candidate.id}
                      onChange={() => {
                        setSelectedVersion(candidate.id);
                      }}
                    />{' '}
                    Review version {candidate.version_no}
                  </label>
                </p>
              </article>
            </li>
          ))}
        </ul>
      </AsyncRegion>

      <section aria-labelledby="scorecards-heading">
        <h2 id="scorecards-heading">Evaluator scorecards</h2>
        <AsyncRegion
          loading={scorecards.loading}
          error={scorecards.error}
          empty={(scorecards.data?.items.length ?? 0) === 0}
          emptyMessage="No scorecards have been produced for this chapter."
          label="scorecards"
        >
          <ul className="card-list">
            {(scorecards.data?.items ?? []).map((card) => (
              <li key={card.artifact_id}>
                <pre>{JSON.stringify(card.scorecard, null, 2)}</pre>
              </li>
            ))}
          </ul>
        </AsyncRegion>
      </section>

      {can('editor') ? (
        <section aria-labelledby="review-actions-heading">
          <h2 id="review-actions-heading">Review decision</h2>
          <Field
            path="review-note"
            label="Note for the author (required to request changes or reject)"
          >
            {(props) => (
              <textarea
                {...props}
                rows={3}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            )}
          </Field>
          <div className="actions">
            <button
              type="button"
              disabled={review.busy}
              onClick={() => {
                submit('request_changes');
              }}
            >
              Request changes
            </button>
            <button
              type="button"
              disabled={review.busy}
              onClick={(event) => {
                // Rejection is destructive to work in progress, so it confirms with its consequence.
                confirm.request(event.currentTarget);
              }}
            >
              Reject
            </button>
            {can('owner') ? (
              <button
                type="button"
                disabled={review.busy}
                onClick={() => {
                  submit('approve');
                }}
              >
                Approve
              </button>
            ) : null}
          </div>
          <ConfirmDialog
            open={confirm.open}
            title={`Reject chapter ${chapterNo}?`}
            impact={
              <p>
                The draft is recorded as rejected and will not be used. It is retained for review
                and does not enter canon.
              </p>
            }
            confirmLabel="Reject this draft"
            onCancel={() => {
              confirm.resolve(false);
            }}
            onConfirm={() => {
              confirm.resolve(true, () => {
                submit('reject');
              });
            }}
          />
        </section>
      ) : null}
    </section>
  );
}
