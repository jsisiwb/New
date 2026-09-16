/**
 * Screen 2 — Workspace and project selection (Checkpoint 7, UI plan §1).
 *
 * The active workspace is a *server-verified membership*, not a client preference: selecting one here sets
 * the `X-Workspace-Id` header that the API checks against the membership table. A workspace the operator
 * is not a member of cannot be reached by editing this state, because the header only names a candidate.
 *
 * The project list, creation and overview all go through the real `/v1` API.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { useAppState } from '../components/app-state';
import { useMutation, useResource, newIdempotencyKey } from '../lib/use-resource';
import {
  AsyncRegion,
  ErrorSummary,
  Field,
  Form,
  StatusBadge,
  type StatusTone,
} from '../components/primitives';

export interface ProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly canon_version: number;
  readonly quality_tier: string;
  readonly operating_mode: string;
}

export function projectTone(status: string): StatusTone {
  if (status === 'failed') return 'bad';
  if (status === 'producing') return 'progress';
  if (status === 'needs_attention') return 'attention';
  if (status === 'complete') return 'good';
  return 'neutral';
}

export function WorkspaceScreen({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}): ReactNode {
  const { api, memberships, workspaceId, selectWorkspace, can } = useAppState();
  const projects = useResource<{ items: readonly ProjectSummary[] }>(
    () => api.get('/v1/projects'),
    [workspaceId],
    { enabled: Boolean(workspaceId) },
  );
  const create = useMutation();
  const [title, setTitle] = useState('');

  return (
    <section aria-labelledby="workspace-heading">
      <h1 id="workspace-heading">Workspaces and projects</h1>

      <section aria-labelledby="workspace-picker-heading">
        <h2 id="workspace-picker-heading">Active workspace</h2>
        <p className="field">
          <label htmlFor="workspace-select">Workspace</label>
          <select
            id="workspace-select"
            value={workspaceId ?? ''}
            onChange={(e) => {
              selectWorkspace(e.target.value);
            }}
          >
            {memberships.map((m) => (
              <option key={m.workspaceId} value={m.workspaceId}>
                {m.name} — {m.role}
              </option>
            ))}
          </select>
        </p>
      </section>

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading">Projects</h2>
        <AsyncRegion
          loading={projects.loading}
          error={projects.error}
          empty={(projects.data?.items.length ?? 0) === 0}
          emptyMessage="No projects in this workspace yet."
          label="projects"
        >
          <table>
            <caption>Projects in the active workspace</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Canon version</th>
                <th scope="col">Tier</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {(projects.data?.items ?? []).map((project) => (
                <tr key={project.id}>
                  <th scope="row">{project.title}</th>
                  <td>
                    <StatusBadge label={project.status} tone={projectTone(project.status)} />
                  </td>
                  <td>{project.canon_version}</td>
                  <td>{project.quality_tier}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenProject(project.id);
                      }}
                    >
                      Open {project.title}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncRegion>
      </section>

      {can('editor') ? (
        <section aria-labelledby="create-project-heading">
          <h2 id="create-project-heading">Create a project</h2>
          {create.error ? <ErrorSummary message={create.error} /> : null}
          <Form
            label="Create project"
            onSubmit={() => {
              create.run(async () => {
                await api.post('/v1/projects', { title }, newIdempotencyKey());
                setTitle('');
                projects.reload();
              });
            }}
          >
            <Field path="title" label="Project title">
              {(props) => (
                <input
                  {...props}
                  type="text"
                  required
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                  }}
                />
              )}
            </Field>
            <button type="submit" disabled={create.busy}>
              {create.busy ? 'Creating…' : 'Create project'}
            </button>
          </Form>
        </section>
      ) : (
        // Truthful about why an action is absent rather than silently hiding it.
        <p className="note">Your role does not allow creating projects.</p>
      )}
    </section>
  );
}

/** Project overview: status, canon version and spend, all read from the API. */
export function ProjectOverviewScreen({ projectId }: { projectId: string }): ReactNode {
  const { api } = useAppState();
  const project = useResource<ProjectSummary & { accepted_chapters: number; spend_cents: number }>(
    () => api.get(`/v1/projects/${projectId}`),
    [projectId],
  );

  return (
    <section aria-labelledby="overview-heading">
      <h1 id="overview-heading">Project overview</h1>
      <AsyncRegion loading={project.loading} error={project.error} label="the project">
        {project.data ? (
          <dl className="summary">
            <dt>Title</dt>
            <dd>{project.data.title}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge label={project.data.status} tone={projectTone(project.data.status)} />
            </dd>
            <dt>Canon version</dt>
            <dd>{project.data.canon_version}</dd>
            <dt>Accepted chapters</dt>
            <dd>{project.data.accepted_chapters}</dd>
            <dt>Spend</dt>
            <dd>{(project.data.spend_cents / 100).toFixed(2)} USD</dd>
          </dl>
        ) : null}
      </AsyncRegion>
    </section>
  );
}
