/**
 * Screens 5 and 6 — Bible / register profiles, and narrative identity / terminology (Checkpoint 7).
 *
 * The property both screens turn on is that a FROZEN version is visibly frozen. The API reports `editable`
 * for identity documents and plans, derived from the database's own `pinned`/`locked` state, and these
 * screens render an edit form only when that flag is true. Offering an edit box for a pinned version would
 * promise something the database will refuse — the operator would write, submit, and be told no.
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
} from '../components/primitives';

interface EntityRow {
  readonly id: string;
  readonly display_name: string;
  readonly type: string;
}

interface RegisterProfile {
  readonly entity_id: string;
  readonly version: number;
  readonly payload: Record<string, unknown>;
}

interface IdentityDocument {
  readonly kind: string;
  readonly version: number;
  readonly pinned: boolean;
  readonly editable: boolean;
  readonly payload: Record<string, unknown>;
}

interface IdentityResponse {
  readonly current: IdentityDocument;
  readonly pinned: IdentityDocument | null;
  readonly versions: readonly { version: number; pinned: boolean }[];
}

export function BibleScreen({ projectId }: { projectId: string }): ReactNode {
  const { api } = useAppState();
  const entities = useResource<{ items: readonly EntityRow[] }>(
    () => api.get(`/v1/projects/${projectId}/canon/entities`),
    [projectId],
  );
  const profiles = useResource<{ items: readonly RegisterProfile[] }>(
    () => api.get(`/v1/projects/${projectId}/bible/register-profiles`),
    [projectId],
  );

  return (
    <section aria-labelledby="bible-heading">
      <h1 id="bible-heading">Bible and register profiles</h1>

      <section aria-labelledby="entities-heading">
        <h2 id="entities-heading">Entities</h2>
        <AsyncRegion
          loading={entities.loading}
          error={entities.error}
          empty={(entities.data?.items.length ?? 0) === 0}
          emptyMessage="No entities exist for this project yet."
          label="entities"
        >
          <table>
            <caption>Entities, aliases and relationships come from accepted canon</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
              </tr>
            </thead>
            <tbody>
              {(entities.data?.items ?? []).map((entity) => (
                <tr key={entity.id}>
                  <th scope="row">{entity.display_name}</th>
                  <td>{entity.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncRegion>
      </section>

      <section aria-labelledby="register-heading">
        <h2 id="register-heading">Register and voice profiles</h2>
        <AsyncRegion
          loading={profiles.loading}
          error={profiles.error}
          empty={(profiles.data?.items.length ?? 0) === 0}
          emptyMessage="No register profiles have been authored yet."
          label="register profiles"
        >
          <ul className="card-list">
            {(profiles.data?.items ?? []).map((profile) => (
              <li key={profile.entity_id}>
                <RegisterProfileEditor
                  projectId={projectId}
                  entityId={profile.entity_id}
                  version={profile.version}
                  payload={profile.payload}
                  onSaved={() => {
                    profiles.reload();
                  }}
                />
              </li>
            ))}
          </ul>
        </AsyncRegion>
      </section>
    </section>
  );
}

export function RegisterProfileEditor({
  projectId,
  entityId,
  version,
  payload,
  onSaved,
}: {
  projectId: string;
  entityId: string;
  version: number;
  payload: Record<string, unknown>;
  onSaved: () => void;
}): ReactNode {
  const { api, can } = useAppState();
  const save = useMutation();
  const [draft, setDraft] = useState(() => JSON.stringify(payload, null, 2));

  return (
    <article aria-labelledby={`profile-${entityId}`}>
      <h3 id={`profile-${entityId}`}>
        Register profile <StatusBadge label={`version ${version}`} />
      </h3>
      {save.error ? <ErrorSummary message={save.error} /> : null}
      {can('editor') ? (
        <Form
          label={`Edit register profile for ${entityId}`}
          onSubmit={() => {
            save.run(async () => {
              await api.put(
                `/v1/projects/${projectId}/bible/register-profiles/${entityId}`,
                { expected_version: version, payload: JSON.parse(draft) as unknown },
                newIdempotencyKey(),
              );
              onSaved();
            });
          }}
        >
          <Field path={`register-${entityId}`} label="Profile (JSON)">
            {(props) => (
              <textarea
                {...props}
                rows={6}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
              />
            )}
          </Field>
          <button type="submit" disabled={save.busy}>
            Save profile version
          </button>
        </Form>
      ) : (
        <pre>{draft}</pre>
      )}
    </article>
  );
}

const IDENTITY_KINDS = ['narrative_identity', 'naming_registry', 'terminology_policy'] as const;

export function NarrativeIdentityScreen({ projectId }: { projectId: string }): ReactNode {
  return (
    <section aria-labelledby="identity-heading">
      <h1 id="identity-heading">Narrative identity and terminology</h1>
      {IDENTITY_KINDS.map((kind) => (
        <IdentityPanel key={kind} projectId={projectId} kind={kind} />
      ))}
    </section>
  );
}

export function IdentityPanel({
  projectId,
  kind,
}: {
  projectId: string;
  kind: (typeof IDENTITY_KINDS)[number];
}): ReactNode {
  const { api, can } = useAppState();
  const document = useResource<IdentityResponse>(
    () => api.get(`/v1/projects/${projectId}/identity/${kind}`),
    [projectId, kind],
  );
  const save = useMutation();
  const [draft, setDraft] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (document.data) setDraft(JSON.stringify(document.data.current.payload, null, 2));
  }, [document.data]);

  const current = document.data?.current;
  const readableKind = kind.replace(/_/g, ' ');

  return (
    <section aria-labelledby={`identity-${kind}`}>
      <h2 id={`identity-${kind}`}>{readableKind}</h2>
      <LiveRegion message={announcement} />
      <AsyncRegion
        loading={document.loading}
        error={document.error}
        label={readableKind}
        empty={!document.loading && !document.error && !current}
        emptyMessage={`No ${readableKind} document exists yet.`}
      >
        {current ? (
          <>
            <dl className="summary">
              <dt>Current version</dt>
              <dd>{current.version}</dd>
              <dt>Pinned version</dt>
              <dd>{document.data.pinned ? document.data.pinned.version : 'none'}</dd>
              <dt>State</dt>
              <dd>
                <StatusBadge
                  label={current.pinned ? 'pinned — immutable' : 'editable'}
                  tone={current.pinned ? 'good' : 'neutral'}
                />
              </dd>
            </dl>
            {save.error ? <ErrorSummary message={save.error} /> : null}
            {current.pinned ? (
              <p className="note">
                This version is pinned and cannot be changed. Saving an edit creates a new version;
                the pinned one stays exactly as production read it.
              </p>
            ) : null}
            {can('editor') && current.editable ? (
              <Form
                label={`Edit ${readableKind}`}
                onSubmit={() => {
                  save.run(async () => {
                    await api.put(
                      `/v1/projects/${projectId}/identity/${kind}`,
                      { expected_version: current.version, payload: JSON.parse(draft) as unknown },
                      newIdempotencyKey(),
                    );
                    setAnnouncement(`${readableKind} saved as a new version.`);
                    document.reload();
                  });
                }}
              >
                <Field path={`identity-${kind}`} label={`${readableKind} document (JSON)`}>
                  {(props) => (
                    <textarea
                      {...props}
                      rows={8}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                      }}
                    />
                  )}
                </Field>
                <button type="submit" disabled={save.busy}>
                  Save new version
                </button>
              </Form>
            ) : null}
          </>
        ) : null}
      </AsyncRegion>
    </section>
  );
}
