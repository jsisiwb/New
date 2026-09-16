/**
 * Screen 4 — Directions and concept comparison (Checkpoint 7, UI plan §2).
 *
 * The one thing this screen must never do is present a losing concept as the chosen one. Losing
 * alternatives are RETAINED and shown — they are the evidence that a decision was made, and hiding them
 * would make the comparison unreviewable — but every candidate carries its persisted status in words, the
 * winner is labelled explicitly, and the selection control disappears once a round is decided. All three
 * come from the server's state, never from anything this component computed.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { useAppState } from '../components/app-state';
import { newIdempotencyKey, useMutation, useResource } from '../lib/use-resource';
import {
  AsyncRegion,
  ErrorSummary,
  Field,
  Form,
  LiveRegion,
  StatusBadge,
} from '../components/primitives';

interface Concept {
  readonly id: string;
  readonly round: number;
  readonly label: string;
  readonly status: 'candidate' | 'selected' | 'rejected';
  readonly is_selected: boolean;
  readonly payload: Record<string, unknown>;
}

interface ConceptsResponse {
  readonly items: readonly Concept[];
  readonly selection: {
    readonly round: number;
    readonly winner_concept_id: string;
    readonly loser_concept_ids: readonly string[];
    readonly rationale: string | null;
  } | null;
}

interface Direction {
  readonly id: string;
  readonly text: string;
  readonly language: string;
  readonly scope_level: string;
  readonly status: string;
}

export function DirectionsAndConceptsScreen({ projectId }: { projectId: string }): ReactNode {
  return (
    <section aria-labelledby="concepts-heading">
      <h1 id="concepts-heading">Directions and concepts</h1>
      <DirectionsPanel projectId={projectId} />
      <ConceptComparison projectId={projectId} round={1} />
    </section>
  );
}

export function DirectionsPanel({ projectId }: { projectId: string }): ReactNode {
  const { api, can } = useAppState();
  const directions = useResource<{ items: readonly Direction[] }>(
    () => api.get(`/v1/projects/${projectId}/directions`),
    [projectId],
  );
  const add = useMutation();
  const [text, setText] = useState('');
  const [announcement, setAnnouncement] = useState('');

  return (
    <section aria-labelledby="directions-heading">
      <h2 id="directions-heading">Running directions</h2>
      <LiveRegion message={announcement} />
      {add.error ? <ErrorSummary message={add.error} /> : null}
      <AsyncRegion
        loading={directions.loading}
        error={directions.error}
        empty={(directions.data?.items.length ?? 0) === 0}
        emptyMessage="No directions have been given yet."
        label="directions"
      >
        <ul className="card-list">
          {(directions.data?.items ?? []).map((direction) => (
            <li key={direction.id}>
              {/* lang is set from the stored language: an instruction may be authored in any language. */}
              <p lang={direction.language}>{direction.text}</p>
              <StatusBadge label={direction.status} detail={direction.scope_level} />
            </li>
          ))}
        </ul>
      </AsyncRegion>
      {can('editor') ? (
        <Form
          label="Add a direction"
          onSubmit={() => {
            add.run(async () => {
              await api.post(
                `/v1/projects/${projectId}/directions`,
                { text, scope_level: 'series' },
                newIdempotencyKey(),
              );
              setText('');
              setAnnouncement('Direction added.');
              directions.reload();
            });
          }}
        >
          <Field path="direction-text" label="New direction">
            {(props) => (
              <textarea
                {...props}
                rows={3}
                required
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
            )}
          </Field>
          <button type="submit" disabled={add.busy}>
            Add direction
          </button>
        </Form>
      ) : null}
    </section>
  );
}

export function ConceptComparison({
  projectId,
  round,
}: {
  projectId: string;
  round: number;
}): ReactNode {
  const { api, can } = useAppState();
  const concepts = useResource<ConceptsResponse>(
    () => api.get(`/v1/projects/${projectId}/concepts?round=${round}`),
    [projectId, round],
  );
  const select = useMutation();
  const [announcement, setAnnouncement] = useState('');

  const decided = Boolean(concepts.data?.selection);

  return (
    <section aria-labelledby="concept-compare-heading">
      <h2 id="concept-compare-heading">Concept comparison — round {round}</h2>
      <LiveRegion message={announcement} />
      {select.error ? <ErrorSummary message={select.error} /> : null}
      <AsyncRegion
        loading={concepts.loading}
        error={concepts.error}
        empty={(concepts.data?.items.length ?? 0) === 0}
        emptyMessage="No concepts have been generated for this round."
        label="concepts"
      >
        <ul className="compare-grid">
          {(concepts.data?.items ?? []).map((concept) => (
            <li key={concept.id} data-status={concept.status}>
              <article aria-labelledby={`concept-${concept.id}`}>
                <h3 id={`concept-${concept.id}`}>
                  Concept {concept.label}{' '}
                  {/* The word, not a colour, is what says whether this one was chosen. */}
                  <StatusBadge
                    label={
                      concept.is_selected
                        ? 'selected'
                        : concept.status === 'rejected'
                          ? 'not selected'
                          : 'candidate'
                    }
                    tone={
                      concept.is_selected
                        ? 'good'
                        : concept.status === 'rejected'
                          ? 'neutral'
                          : 'progress'
                    }
                  />
                </h3>
                <p>{typeof concept.payload.logline === 'string' ? concept.payload.logline : ''}</p>
                {can('editor') && !decided ? (
                  <button
                    type="button"
                    onClick={() => {
                      select.run(async () => {
                        await api.post(
                          `/v1/projects/${projectId}/concepts/${concept.id}/select`,
                          { rationale: 'Selected during operator review.' },
                          newIdempotencyKey(),
                        );
                        setAnnouncement(`Concept ${concept.label} selected.`);
                        concepts.reload();
                      });
                    }}
                  >
                    Select concept {concept.label}
                  </button>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
        {decided ? (
          <p className="note" data-testid="concept-decision">
            Round {round} is decided. The alternatives below the winner are retained for review and
            are not used in planning or canon.
          </p>
        ) : null}
      </AsyncRegion>
    </section>
  );
}
