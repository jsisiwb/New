/**
 * Screen 7 — Planning: series blueprint, arcs, chapter contracts and scene plans (Checkpoint 7).
 *
 * Locking is the property worth showing carefully. A locked plan version is frozen by a database trigger,
 * so this screen renders the lock state in words, suppresses the edit form for a locked version, and
 * explains that revising means a new version. A stale edit surfaces as an explicit conflict with a reload
 * rather than being retried against a version the operator never read.
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

const PLAN_KINDS = ['series_blueprint', 'arc_plan', 'chapter_contract', 'scene_plan'] as const;

export type PlanKind = (typeof PLAN_KINDS)[number];

interface PlanDocument {
  readonly kind: string;
  readonly plan_key: string;
  readonly version: number;
  readonly locked: boolean;
  readonly editable: boolean;
  readonly source: string;
  readonly payload: Record<string, unknown>;
}

export function PlanningScreen({ projectId }: { projectId: string }): ReactNode {
  return (
    <section aria-labelledby="planning-heading">
      <h1 id="planning-heading">Planning</h1>
      {PLAN_KINDS.map((kind) => (
        <PlanList key={kind} projectId={projectId} kind={kind} />
      ))}
    </section>
  );
}

export function PlanList({ projectId, kind }: { projectId: string; kind: PlanKind }): ReactNode {
  const { api, can } = useAppState();
  const plans = useResource<{ items: readonly PlanDocument[] }>(
    () => api.get(`/v1/projects/${projectId}/plans/${kind}`),
    [projectId, kind],
  );
  const mutate = useMutation();
  const [announcement, setAnnouncement] = useState('');
  const readableKind = kind.replace(/_/g, ' ');

  return (
    <section aria-labelledby={`plans-${kind}`}>
      <h2 id={`plans-${kind}`}>{readableKind}</h2>
      <LiveRegion message={announcement} />
      {mutate.error ? (
        <>
          <ErrorSummary
            title={mutate.problem?.code === 'CONFLICT' ? 'This plan changed' : 'Could not save'}
            message={mutate.error}
          />
          {mutate.problem?.code === 'CONFLICT' ? (
            <button
              type="button"
              onClick={() => {
                mutate.clear();
                plans.reload();
              }}
            >
              Reload the current plan
            </button>
          ) : null}
        </>
      ) : null}
      <AsyncRegion
        loading={plans.loading}
        error={plans.error}
        empty={(plans.data?.items.length ?? 0) === 0}
        emptyMessage={`No ${readableKind} exists yet.`}
        label={readableKind}
      >
        <ul className="card-list">
          {(plans.data?.items ?? []).map((plan) => (
            <li key={`${plan.kind}:${plan.plan_key}`}>
              <article aria-labelledby={`plan-${kind}-${plan.plan_key || 'series'}`}>
                <h3 id={`plan-${kind}-${plan.plan_key || 'series'}`}>
                  {plan.plan_key || 'series'}{' '}
                  <StatusBadge
                    label={plan.locked ? 'locked' : 'editable'}
                    tone={plan.locked ? 'good' : 'neutral'}
                    detail={`version ${plan.version}`}
                  />
                </h3>
                {plan.locked ? (
                  <p className="note">
                    This version is locked. Downstream planning read it, so revising means saving a
                    new version rather than changing this one.
                  </p>
                ) : null}
                <PlanEditor
                  projectId={projectId}
                  plan={plan}
                  onSaved={(message) => {
                    setAnnouncement(message);
                    plans.reload();
                  }}
                  mutate={mutate}
                />
                {can('owner') && !plan.locked ? (
                  <button
                    type="button"
                    onClick={() => {
                      mutate.run(async () => {
                        await api.post(
                          `/v1/projects/${projectId}/plans/${kind}/${plan.plan_key || '-'}/lock`,
                          { version: plan.version },
                          newIdempotencyKey(),
                        );
                        setAnnouncement(
                          `${readableKind} ${plan.plan_key} locked at version ${plan.version}.`,
                        );
                        plans.reload();
                      });
                    }}
                  >
                    Lock version {plan.version}
                  </button>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </AsyncRegion>
    </section>
  );
}

function PlanEditor({
  projectId,
  plan,
  onSaved,
  mutate,
}: {
  projectId: string;
  plan: PlanDocument;
  onSaved: (message: string) => void;
  mutate: ReturnType<typeof useMutation>;
}): ReactNode {
  const { api, can } = useAppState();
  const [draft, setDraft] = useState(() => JSON.stringify(plan.payload, null, 2));
  // A locked version is frozen by a database trigger, so no edit form is offered for one: rendering a
  // form the server will refuse would promise an edit that cannot happen.
  if (!can('editor') || plan.locked) return <pre>{draft}</pre>;
  return (
    <Form
      label={`Edit ${plan.kind} ${plan.plan_key || 'series'}`}
      onSubmit={() => {
        mutate.run(async () => {
          await api.put(
            `/v1/projects/${projectId}/plans/${plan.kind}/${plan.plan_key || '-'}`,
            { expected_version: plan.version, payload: JSON.parse(draft) as unknown },
            newIdempotencyKey(),
          );
          onSaved(`${plan.kind} saved as version ${plan.version + 1}.`);
        });
      }}
    >
      <Field path={`plan-${plan.kind}-${plan.plan_key}`} label="Plan document (JSON)">
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
      <button type="submit" disabled={mutate.busy}>
        Save new version
      </button>
    </Form>
  );
}
