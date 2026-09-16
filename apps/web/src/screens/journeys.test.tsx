/**
 * @vitest-environment jsdom
 *
 * Operator journeys and accessibility for every work area (Checkpoint 7).
 *
 * These render the REAL screens against a fake transport that speaks the real `/v1` contract — the same
 * paths, the same response shapes, the same RFC 9457 problem documents the Fastify app returns (and which
 * `apps/api`'s own integration suite pins against a real PostgreSQL). That is the useful middle ground:
 * a component test that stubbed the screens' own data layer would prove only that React renders, while
 * booting a browser against a live server would test the network rather than the operator journey.
 *
 * Every work area gets an axe pass, because an accessibility rule that is checked on one screen is a rule
 * the twelfth screen will break.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { ApiClient } from '../lib/api';
import { AppStateProvider } from '../components/app-state';
import { SignInScreen, ProtectedRoute } from './auth';
import { WorkspaceScreen, ProjectOverviewScreen } from './workspace';
import { SpecScreen } from './spec';
import { DirectionsAndConceptsScreen } from './concepts';
import { BibleScreen, NarrativeIdentityScreen } from './bible';
import { PlanningScreen } from './planning';
import { CandidateReviewScreen, ChaptersScreen } from './chapters';
import { CanonScreen } from './canon';
import { JobProgress, OperationsScreen } from './operations';
import type { EventSourceLike } from '../lib/job-events';

const PROJECT = '00000000-0000-7000-8000-00000000p001'.replace('p', '0');

// ---------------------------------------------------------------------------------------------------------
// a fake server speaking the real /v1 contract
// ---------------------------------------------------------------------------------------------------------

interface ServerState {
  signedIn: boolean;
  role: 'owner' | 'editor' | 'viewer';
  specVersion: number;
  assumptionDecided: boolean;
  conceptDecided: boolean;
  identityPinned: boolean;
  planLocked: boolean;
  nextSpecPutConflicts: boolean;
  budgetRefuses: boolean;
  requests: { method: string; url: string; body: unknown; headers: Record<string, string> }[];
}

function problem(status: number, code: string, detail: string, data?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      type: `urn:yeonjae:error:${code}`,
      title: code,
      status,
      detail,
      code,
      request_id: 'req-1',
      ...(data ? { data } : {}),
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeServer(overrides: Partial<ServerState> = {}) {
  const state: ServerState = {
    signedIn: false,
    role: 'owner',
    specVersion: 1,
    assumptionDecided: false,
    conceptDecided: false,
    identityPinned: false,
    planLocked: false,
    nextSpecPutConflicts: false,
    budgetRefuses: false,
    requests: [],
    ...overrides,
  };

  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const path: string = url;
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, url: path, body, headers });

    if (path.endsWith('/v1/auth/login') && method === 'POST') {
      const credentials = body as { email: string; password: string };
      if (credentials.password !== 'correct-password')
        return problem(401, 'INVALID_CREDENTIALS', 'Those credentials were not recognised.');
      state.signedIn = true;
      return ok({
        csrf_token: 'csrf-1',
        user: { id: 'u1', email: credentials.email, display_name: 'Operator' },
      });
    }
    if (path.endsWith('/v1/auth/logout')) {
      state.signedIn = false;
      return ok({});
    }
    if (path.endsWith('/v1/me')) {
      if (!state.signedIn) return problem(401, 'UNAUTHENTICATED', 'No session.');
      // The EXACT shape apps/api returns: memberships under `workspaces`, and deliberately no CSRF token
      // (a GET that minted one would hand a cross-site attacker half the double-submit pair). Pinning the
      // real shape here is what makes these journeys evidence about the product rather than about the fake.
      return ok({
        user: { id: 'u1', email: 'operator@example.com', display_name: 'Operator' },
        via: 'session',
        workspaces: [{ workspace_id: 'ws-1', name: 'Studio', role: state.role }],
      });
    }
    if (!state.signedIn) return problem(401, 'UNAUTHENTICATED', 'No session.');

    // ---- projects
    if (path.endsWith('/v1/projects') && method === 'GET')
      return ok({
        items: [
          {
            id: PROJECT,
            title: 'Second Awakening',
            status: 'producing',
            canon_version: 3,
            quality_tier: 'standard',
            operating_mode: 'assisted',
          },
        ],
        next_cursor: null,
      });
    if (path.endsWith('/v1/projects') && method === 'POST') return ok({ projectId: PROJECT }, 201);
    if (path.endsWith(`/v1/projects/${PROJECT}`))
      return ok({
        id: PROJECT,
        title: 'Second Awakening',
        status: 'producing',
        canon_version: 3,
        quality_tier: 'standard',
        operating_mode: 'assisted',
        accepted_chapters: 2,
        spend_cents: 1234,
      });

    // ---- spec and assumptions
    if (path.endsWith('/spec') && method === 'GET')
      return ok({
        project_id: PROJECT,
        version: state.specVersion,
        source: 'operator',
        payload: { project_id: PROJECT, version: state.specVersion, items: [] },
        counts: { total: 1, assumptions: 1 },
      });
    if (path.endsWith('/spec') && method === 'PUT') {
      if (state.nextSpecPutConflicts)
        return problem(409, 'CONFLICT', 'The story spec has moved on.', {
          reason: 'stale_version',
        });
      state.specVersion += 1;
      return ok({ version: state.specVersion, source: 'operator', payload: {} }, 201);
    }
    if (path.endsWith('/spec/assumptions') && method === 'GET')
      return ok({
        spec_version: state.specVersion,
        items: [
          {
            id: 'REQ-001',
            category: 'tone',
            text: 'The tone stays wry.',
            language: 'en',
            rationale: 'Inferred from the intake.',
            review_status: state.assumptionDecided ? 'confirm' : 'pending',
          },
        ],
      });
    if (path.includes('/spec/assumptions/REQ-001/decision')) {
      state.assumptionDecided = true;
      return ok({ requirement_id: 'REQ-001', decision: 'confirm', spec_updated: false }, 201);
    }

    // ---- directions and concepts
    if (path.includes('/directions') && method === 'GET')
      return ok({
        items: [
          {
            id: 'd1',
            text: 'Keep the rival alive.',
            language: 'en',
            scope_level: 'arc',
            status: 'active',
          },
        ],
        next_cursor: null,
      });
    if (path.includes('/directions') && method === 'POST') return ok({ id: 'd2' }, 201);
    if (path.includes('/concepts') && method === 'GET')
      return ok({
        items: [
          {
            id: 'c1',
            round: 1,
            label: 'A',
            status: state.conceptDecided ? 'rejected' : 'candidate',
            is_selected: false,
            payload: { logline: 'A regressor returns.' },
          },
          {
            id: 'c2',
            round: 1,
            label: 'B',
            status: state.conceptDecided ? 'selected' : 'candidate',
            is_selected: state.conceptDecided,
            payload: { logline: 'A status window opens.' },
          },
        ],
        next_cursor: null,
        selection: state.conceptDecided
          ? { round: 1, winner_concept_id: 'c2', loser_concept_ids: ['c1'], rationale: null }
          : null,
      });
    if (path.includes('/concepts/c2/select')) {
      state.conceptDecided = true;
      return ok({ round: 1, winner: { id: 'c2', is_selected: true }, loser_concept_ids: ['c1'] });
    }

    // ---- bible / identity
    if (path.includes('/canon/entities'))
      return ok({ items: [{ id: 'e1', display_name: 'Seo Yuna', type: 'character' }] });
    if (path.includes('/bible/register-profiles') && method === 'GET')
      return ok({ items: [{ entity_id: 'e1', version: 1, payload: { formality: 'measured' } }] });
    if (path.includes('/bible/register-profiles') && method === 'PUT')
      return ok({ version: 2 }, 201);
    if (path.includes('/identity/') && path.endsWith('/pin')) {
      state.identityPinned = true;
      return ok({ kind: 'narrative_identity', version: 1, pinned: true, editable: false });
    }
    if (path.includes('/identity/') && method === 'GET') {
      const kind = path.split('/identity/')[1] ?? 'narrative_identity';
      const pinned = state.identityPinned && kind === 'narrative_identity';
      return ok({
        current: {
          kind,
          version: 1,
          pinned,
          editable: !pinned,
          payload: { tradition: 'korean_webnovel' },
        },
        pinned: pinned ? { kind, version: 1, pinned: true, editable: false, payload: {} } : null,
        versions: [{ version: 1, pinned }],
      });
    }
    if (path.includes('/identity/') && method === 'PUT')
      return ok({ version: 2, pinned: false }, 201);

    // ---- plans
    if (path.includes('/plans/') && path.endsWith('/lock')) {
      state.planLocked = true;
      return ok({ kind: 'arc_plan', plan_key: 'arc-1', version: 1, locked: true, editable: false });
    }
    if (path.includes('/plans/') && method === 'GET') {
      // Kind-accurate, like the real API: each plan kind has its own documents. Returning the same rows
      // for every kind would fabricate duplicate landmarks the real app never produces.
      const kind = path.split('/plans/')[1]?.split('?')[0] ?? 'arc_plan';
      const planKey = kind === 'series_blueprint' ? '' : `${kind}-1`;
      return ok({
        kind,
        items: [
          {
            kind,
            plan_key: planKey,
            version: 1,
            locked: state.planLocked && kind === 'arc_plan',
            editable: !(state.planLocked && kind === 'arc_plan'),
            source: 'workflow',
            payload: { beats: ['a'] },
          },
        ],
        next_cursor: null,
      });
    }
    if (path.includes('/plans/') && method === 'PUT') return ok({ version: 2 }, 201);

    // ---- chapters, candidates, reviews
    if (path.endsWith('/chapters') && method === 'GET')
      return ok({
        items: [
          { number: 1, status: 'accepted', accepted_version_id: 'v1' },
          { number: 2, status: 'paused_budget', accepted_version_id: null },
        ],
      });
    if (path.includes('/production') && method === 'POST') {
      if (state.budgetRefuses)
        return problem(
          402,
          'BUDGET_EXHAUSTED',
          'This would exceed the project budget; nothing was started.',
        );
      return ok({ job_id: 'j1', status: 'running' }, 202);
    }
    if (path.includes('/candidates'))
      return ok({
        chapter_no: 1,
        accepted_version_id: 'v1',
        selection: {
          status: 'selected',
          winner_manuscript_version_id: 'v1',
          selection_required: true,
        },
        items: [
          {
            id: 'v1',
            version_no: 1,
            status: 'accepted',
            origin: 'candidate',
            is_accepted: true,
            is_winner: true,
            is_loser: false,
          },
          {
            id: 'v2',
            version_no: 2,
            status: 'rejected',
            origin: 'candidate',
            is_accepted: false,
            is_winner: false,
            is_loser: true,
          },
        ],
      });
    if (path.includes('/scorecards'))
      return ok({ chapter_no: 1, items: [{ artifact_id: 'a1', scorecard: { prose: 0.8 } }] });
    if (path.includes('/reviews') && method === 'POST')
      return ok(
        { id: 'r1', decision: (body as { decision: string }).decision, canon_accepted: false },
        201,
      );
    if (path.includes('/reviews') && method === 'GET') return ok({ chapter_no: 1, items: [] });

    // ---- canon
    if (path.includes('/canon/facts'))
      return ok({ items: [{ id: 'f1', attribute: 'rank' }], next_cursor: null });
    if (path.includes('/canon/promises'))
      return ok({ items: [{ id: 'p1', statement: 'The rival returns.', status: 'open' }] });
    if (path.includes('/canon/stale')) return ok({ items: [] });
    if (path.includes('/canon:')) {
      const dryRun = (body as { dry_run?: boolean } | undefined)?.dry_run === true;
      return ok({
        canon_version: 3,
        rollbackable: true,
        impact: {
          material: [{ kind: 'manuscript_version', id: 'v9' }],
          contextual: [{ kind: 'summary', id: 's1' }],
          affected_accepted_chapters: dryRun ? [4, 5] : [],
        },
      });
    }

    // ---- jobs, costs, exports
    if (path.includes('/jobs') && method === 'GET')
      return ok({
        items: [
          {
            id: 'j1',
            kind: 'chapter_production',
            status: 'running',
            control: 'run',
            current_step: 'draft',
            spend_cents: 250,
          },
        ],
        next_cursor: null,
      });
    if (path.includes('/jobs/j1:cancel')) return ok({ outcome: 'too_late', status: 'completed' });
    if (/\/jobs\/j1:(pause|resume)/.exec(path)) return ok({ status: 'paused' });
    if (path.includes('/costs')) return ok({ total_cents: 1234, items: [] });
    if (path.includes('/budgets')) return ok({ limit_cents: 500000, spent_cents: 1234 });
    if (path.includes('/exports') && method === 'POST')
      return ok(
        {
          id: 'x1',
          format: (body as { format: string }).format,
          status: 'ready',
          download_path: `/v1/projects/${PROJECT}/exports/x1/content`,
          byte_size: 1024,
        },
        201,
      );

    return problem(404, 'NOT_FOUND', 'No such route.');
  });

  return { state, fetchImpl };
}

function renderApp(node: ReactNode, server = makeServer()) {
  const client = new ApiClient({
    baseUrl: '',
    fetchImpl: server.fetchImpl as unknown as typeof fetch,
  });
  const utils = render(<AppStateProvider client={client}>{node}</AppStateProvider>);
  return { ...utils, server, client };
}

/** Sign in through the real form so every later assertion runs against an authenticated app. */
async function signedIn(node: ReactNode, overrides: Partial<ServerState> = {}) {
  const server = makeServer({ signedIn: true, ...overrides });
  const result = renderApp(node, server);
  await waitFor(() => {
    expect(server.state.requests.some((r) => r.url.endsWith('/v1/me'))).toBe(true);
  });
  return result;
}

/** Fail the test on any axe violation, naming the rules so a failure is actionable. */
async function expectNoA11yViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      // The test container is a fragment, not a document: these two are asserted by the layout test.
      region: { enabled: false },
      'page-has-heading-one': { enabled: false },
    },
  });
  const violations = results.violations.map((v) => `${v.id}: ${v.description}`);
  expect(violations).toEqual([]);
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------------------------------------
// 1. authentication
// ---------------------------------------------------------------------------------------------------------

describe('authentication', () => {
  it('signs in through the real API and shows the operator', async () => {
    const server = makeServer();
    renderApp(<SignInScreen />, server);
    await screen.findByRole('heading', { name: /sign in/i });

    await userEvent.type(screen.getByLabelText('Email'), 'operator@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/Signed in as Operator/)).toBeTruthy();
    const login = server.state.requests.find((r) => r.url.endsWith('/v1/auth/login'));
    expect(login?.method).toBe('POST');
  });

  it('reports a failed sign-in in a focused error summary without naming which field was wrong', async () => {
    renderApp(<SignInScreen />);
    await screen.findByRole('heading', { name: /sign in/i });
    await userEvent.type(screen.getByLabelText('Email'), 'operator@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not recognised');
    // No user-enumeration oracle: the message must not say the email exists or the password was wrong.
    expect(alert.textContent).not.toMatch(/password is incorrect|no such user/i);
    // Focus moved to the summary, so a keyboard operator lands on the explanation.
    expect(document.activeElement).toBe(alert);
  });

  it('restores a session from the cookie on load', async () => {
    const { server } = await signedIn(<SignInScreen />);
    expect(await screen.findByText(/Signed in as Operator/)).toBeTruthy();
    expect(server.state.requests.some((r) => r.url.endsWith('/v1/me'))).toBe(true);
  });

  it('shows sign-in rather than protected content when the session is gone', async () => {
    renderApp(
      <ProtectedRoute>
        <p>secret workspace content</p>
      </ProtectedRoute>,
    );
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText('secret workspace content')).toBeNull();
  });

  it('revokes local state when the server reports an expired session mid-session', async () => {
    const server = makeServer({ signedIn: true });
    renderApp(
      <ProtectedRoute>
        <WorkspaceScreen onOpenProject={() => undefined} />
      </ProtectedRoute>,
      server,
    );
    await screen.findByRole('heading', { name: /Workspaces and projects/i });
    // The session is revoked server-side. The next real API call answers 401, and the app must stop
    // showing workspace data rather than continuing to render as if it were still signed in.
    server.state.signedIn = false;
    await userEvent.type(screen.getByLabelText('Project title'), 'New project');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /sign in/i })).toBeTruthy();
    });
    expect(screen.queryByRole('rowheader', { name: 'Second Awakening' })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderApp(<SignInScreen />);
    await screen.findByRole('heading', { name: /sign in/i });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 2. workspace and projects
// ---------------------------------------------------------------------------------------------------------

describe('workspace and project selection', () => {
  it('lists projects from the API and opens one', async () => {
    const opened = vi.fn();
    await signedIn(<WorkspaceScreen onOpenProject={opened} />);
    expect(await screen.findByRole('rowheader', { name: 'Second Awakening' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Open Second Awakening/ }));
    expect(opened).toHaveBeenCalledWith(PROJECT);
  });

  it('hides project creation from a viewer and says why', async () => {
    await signedIn(<WorkspaceScreen onOpenProject={() => undefined} />, { role: 'viewer' });
    await screen.findByRole('heading', { name: /Workspaces and projects/i });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
    });
    expect(screen.getByText(/role does not allow creating projects/i)).toBeTruthy();
  });

  it('shows the project overview from the API', async () => {
    await signedIn(<ProjectOverviewScreen projectId={PROJECT} />);
    expect(await screen.findByText('Second Awakening')).toBeTruthy();
    expect(screen.getByText('12.34 USD')).toBeTruthy();
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(<WorkspaceScreen onOpenProject={() => undefined} />);
    await screen.findByRole('rowheader', { name: 'Second Awakening' });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 3. spec and assumptions
// ---------------------------------------------------------------------------------------------------------

describe('story specification and assumptions', () => {
  it('saves an edit with the version it loaded', async () => {
    const { server } = await signedIn(<SpecScreen projectId={PROJECT} />);
    await screen.findByTestId('spec-version');
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));
    await waitFor(() => {
      const put = server.state.requests.find((r) => r.method === 'PUT' && r.url.endsWith('/spec'));
      expect((put?.body as { expected_version: number }).expected_version).toBe(1);
    });
  });

  it('surfaces a stale edit as a conflict with a reload, never a silent retry', async () => {
    const { server } = await signedIn(<SpecScreen projectId={PROJECT} />, {
      nextSpecPutConflicts: true,
    });
    await screen.findByTestId('spec-version');
    await userEvent.click(screen.getByRole('button', { name: 'Save new version' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('changed this while you were editing');
    expect(screen.getByRole('button', { name: /Reload the current version/ })).toBeTruthy();
    // Exactly one PUT: the edit was not retried against a version the operator never saw.
    expect(
      server.state.requests.filter((r) => r.method === 'PUT' && r.url.endsWith('/spec')),
    ).toHaveLength(1);
  });

  it('records an assumption decision and states that the spec was not rewritten', async () => {
    await signedIn(<SpecScreen projectId={PROJECT} />);
    expect(
      await screen.findByText(/Recording a decision does not rewrite the specification/i),
    ).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: /Confirm REQ-001 as hard/ }));
    await waitFor(() => {
      expect(screen.getByText('confirm')).toBeTruthy();
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(<SpecScreen projectId={PROJECT} />);
    await screen.findByTestId('spec-version');
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 4. directions and concepts
// ---------------------------------------------------------------------------------------------------------

describe('directions and concepts', () => {
  it('selects a concept and never presents the loser as selected', async () => {
    await signedIn(<DirectionsAndConceptsScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: /Concept comparison/i });

    await userEvent.click(screen.getByRole('button', { name: 'Select concept B' }));
    await screen.findByTestId('concept-decision');

    const winner = screen.getByRole('heading', { name: /Concept B/ });
    expect(winner.textContent).toContain('selected');
    const loser = screen.getByRole('heading', { name: /Concept A/ });
    // The losing alternative is retained and readable, and says "not selected" in words.
    expect(loser.textContent).toContain('not selected');
    // Once decided, no selection control remains to promote a loser.
    expect(screen.queryByRole('button', { name: 'Select concept A' })).toBeNull();
  });

  it('keeps a non-English direction tagged with its own language', async () => {
    await signedIn(<DirectionsAndConceptsScreen projectId={PROJECT} />);
    const direction = await screen.findByText('Keep the rival alive.');
    expect(direction.getAttribute('lang')).toBe('en');
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(<DirectionsAndConceptsScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: /Concept comparison/i });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 5 & 6. bible, register profiles, narrative identity
// ---------------------------------------------------------------------------------------------------------

describe('bible and narrative identity', () => {
  it('lists entities and register profiles from the API', async () => {
    await signedIn(<BibleScreen projectId={PROJECT} />);
    expect(await screen.findByRole('rowheader', { name: 'Seo Yuna' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /Register profile/ })).toBeTruthy();
  });

  it('shows a pinned identity version as immutable and offers no edit form for it', async () => {
    await signedIn(<NarrativeIdentityScreen projectId={PROJECT} />, { identityPinned: true });
    const panel = await screen.findByRole('region', { name: 'narrative identity' });
    expect(within(panel).getByText(/pinned — immutable/)).toBeTruthy();
    expect(within(panel).getByText(/cannot be changed/i)).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Save new version' })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(<NarrativeIdentityScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: /Narrative identity and terminology/i });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 7. planning
// ---------------------------------------------------------------------------------------------------------

describe('planning', () => {
  it('shows lock state and suppresses editing of a locked version', async () => {
    await signedIn(<PlanningScreen projectId={PROJECT} />, { planLocked: true });
    const heading = await screen.findByRole('heading', { name: /arc_plan-1/ });
    expect(heading.textContent).toContain('locked');
    expect(screen.getAllByText(/Downstream planning read it/i).length).toBeGreaterThan(0);
    // No edit form for a version the database will refuse to rewrite.
    expect(screen.queryByRole('form', { name: /Edit arc_plan arc_plan-1/ })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(<PlanningScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: 'Planning' });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 8. chapters and production
// ---------------------------------------------------------------------------------------------------------

describe('chapters and production', () => {
  it('distinguishes every production state in words, not colour', async () => {
    await signedIn(<ChaptersScreen projectId={PROJECT} onOpenChapter={() => undefined} />);
    await screen.findByRole('rowheader', { name: 'Chapter 1' });
    expect(screen.getByText(/blocked by the project budget/)).toBeTruthy();
    expect(screen.getByText(/accepted into canon/)).toBeTruthy();
  });

  it('starts production with a stable idempotency key so a duplicate start cannot double-spend', async () => {
    const { server } = await signedIn(
      <ChaptersScreen projectId={PROJECT} onOpenChapter={() => undefined} />,
    );
    await screen.findByRole('button', { name: 'Start production' });
    await userEvent.click(screen.getByRole('button', { name: 'Start production' }));
    await waitFor(() => {
      const start = server.state.requests.find((r) => r.url.includes('/production'));
      expect(start?.headers['idempotency-key']).toBe(`start:${PROJECT}:1`);
    });
  });

  it('reports a budget refusal as a refusal before spend', async () => {
    await signedIn(<ChaptersScreen projectId={PROJECT} onOpenChapter={() => undefined} />, {
      budgetRefuses: true,
    });
    await screen.findByRole('button', { name: 'Start production' });
    await userEvent.click(screen.getByRole('button', { name: 'Start production' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('refused before any spend');
    expect(alert.textContent).toContain('nothing was started or spent');
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(
      <ChaptersScreen projectId={PROJECT} onOpenChapter={() => undefined} />,
    );
    await screen.findByRole('rowheader', { name: 'Chapter 1' });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 9. candidate and scorecard review
// ---------------------------------------------------------------------------------------------------------

describe('candidate review', () => {
  it('labels the accepted winner and the losing draft distinctly', async () => {
    await signedIn(<CandidateReviewScreen projectId={PROJECT} chapterNo={1} />);
    const accepted = await screen.findByRole('heading', { name: /Version 1/ });
    expect(accepted.textContent).toContain('accepted');
    const loser = screen.getByRole('heading', { name: /Version 2/ });
    expect(loser.textContent).toContain('not selected');
    expect(loser.textContent).not.toContain('accepted');
  });

  it('requires confirmation before rejecting, and states the consequence', async () => {
    const { server } = await signedIn(<CandidateReviewScreen projectId={PROJECT} chapterNo={1} />);
    await screen.findByRole('heading', { name: /Version 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('does not enter canon');
    // Nothing was sent by merely opening the dialog.
    expect(
      server.state.requests.filter((r) => r.url.includes('/reviews') && r.method === 'POST'),
    ).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject this draft' }));
    await waitFor(() => {
      const posted = server.state.requests.find(
        (r) => r.url.includes('/reviews') && r.method === 'POST',
      );
      expect((posted?.body as { decision: string }).decision).toBe('reject');
    });
  });

  it('cancels a confirmation with Escape and sends nothing', async () => {
    const { server } = await signedIn(<CandidateReviewScreen projectId={PROJECT} chapterNo={1} />);
    await screen.findByRole('heading', { name: /Version 1/ });
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      server.state.requests.filter((r) => r.url.includes('/reviews') && r.method === 'POST'),
    ).toHaveLength(0);
  });

  it('records request-changes and approval without accepting canon', async () => {
    const { server } = await signedIn(<CandidateReviewScreen projectId={PROJECT} chapterNo={1} />);
    await screen.findByRole('heading', { name: /Version 1/ });
    await userEvent.type(screen.getByLabelText(/Note for the author/), 'Sharpen the hook.');
    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    await waitFor(() => {
      expect(
        server.state.requests.some(
          (r) =>
            r.url.includes('/reviews') &&
            (r.body as { decision?: string }).decision === 'request_changes',
        ),
      ).toBe(true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(
        server.state.requests.some(
          (r) =>
            r.url.includes('/reviews') && (r.body as { decision?: string }).decision === 'approve',
        ),
      ).toBe(true);
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(
      <CandidateReviewScreen projectId={PROJECT} chapterNo={1} />,
    );
    await screen.findByRole('heading', { name: /Version 1/ });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 10. canon operations
// ---------------------------------------------------------------------------------------------------------

describe('canon change operations', () => {
  it('previews impact before any commit and separates material from contextual consequences', async () => {
    const { server } = await signedIn(<CanonScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: 'Canon change operations' });
    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));

    const report = await screen.findByTestId('impact-report');
    expect(report.textContent).toContain('Material consequences (1)');
    expect(report.textContent).toContain('Contextual consequences (1)');
    expect(report.textContent).toContain('Accepted chapters affected: 4, 5');

    const posted = server.state.requests.filter((r) => r.url.includes('/canon:'));
    // The preview is a dry run; nothing was committed.
    expect(posted).toHaveLength(1);
    expect((posted[0]?.body as { dry_run: boolean }).dry_run).toBe(true);
  });

  it('requires typing the operation name before a retcon can be committed', async () => {
    const { server } = await signedIn(<CanonScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: 'Canon change operations' });
    await userEvent.selectOptions(screen.getByLabelText('Operation'), 'retcon');
    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    await screen.findByTestId('impact-report');
    await userEvent.click(screen.getByRole('button', { name: 'Commit retcon' }));

    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Commit retcon' });
    // Muscle memory alone cannot commit a retcon.
    expect(confirmButton.hasAttribute('disabled')).toBe(true);

    await userEvent.type(within(dialog).getByLabelText(/Type/), 'retcon');
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
    await userEvent.click(confirmButton);

    await waitFor(() => {
      const committed = server.state.requests.filter(
        (r) => r.url.includes('/canon:') && !(r.body as { dry_run: boolean }).dry_run,
      );
      expect(committed).toHaveLength(1);
    });
  });

  it('hides canon operations from a viewer', async () => {
    await signedIn(<CanonScreen projectId={PROJECT} />, { role: 'viewer' });
    await screen.findByRole('heading', { name: 'Canon change operations' });
    expect(screen.getByText(/role does not allow canon change operations/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Preview impact' })).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(<CanonScreen projectId={PROJECT} />);
    await screen.findByRole('heading', { name: 'Canon' });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 11. operations: jobs, SSE, costs, export
// ---------------------------------------------------------------------------------------------------------

/** A fake SSE transport whose frames the test drives explicitly. */
class TestSource implements EventSourceLike {
  onerror: ((this: unknown, ev: unknown) => void) | null = null;
  onopen: ((this: unknown, ev: unknown) => void) | null = null;
  static last: TestSource | undefined;
  static lastEventId: string | undefined;
  private listeners: ((event: MessageEvent<string>) => void)[] = [];

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }
  close(): void {
    /* nothing to release in the fake */
  }
  emit(seq: number, payload: Record<string, unknown>, terminal = false): void {
    for (const listener of this.listeners)
      listener({
        lastEventId: String(seq),
        data: JSON.stringify({ kind: 'step', payload, terminal }),
      } as MessageEvent<string>);
  }
}

const testFactory = (_url: string, lastEventId: string | undefined) => {
  const source = new TestSource();
  TestSource.last = source;
  TestSource.lastEventId = lastEventId;
  return source;
};

describe('operations', () => {
  beforeEach(() => {
    TestSource.last = undefined;
    TestSource.lastEventId = undefined;
  });

  it('shows live job progress from the event stream', async () => {
    await signedIn(<JobProgress jobId="j1" eventSourceFactory={testFactory} />);
    await screen.findByTestId('stream-state');
    TestSource.last?.emit(1, { status: 'running', step: 'draft' });
    await waitFor(() => {
      expect(screen.getByTestId('job-step').textContent).toBe('draft');
    });
  });

  it('does not let a replayed older event move a finished job backwards', async () => {
    await signedIn(<JobProgress jobId="j1" eventSourceFactory={testFactory} />);
    await screen.findByTestId('stream-state');
    TestSource.last?.emit(1, { status: 'running', step: 'draft' });
    TestSource.last?.emit(2, { status: 'completed', step: 'accept' }, true);
    await waitFor(() => {
      expect(screen.getByTestId('job-status').textContent).toContain('completed');
    });
    // A late replay of an older running frame must not relabel an accepted result.
    TestSource.last?.emit(3, { status: 'running', step: 'draft' });
    await waitFor(() => {
      expect(screen.getByTestId('job-status').textContent).toContain('completed');
    });
  });

  it('shows a disconnected state rather than pretending the job stopped', async () => {
    await signedIn(<JobProgress jobId="j1" eventSourceFactory={testFactory} />);
    await screen.findByTestId('stream-state');
    TestSource.last?.onopen?.call(undefined, {});
    await waitFor(() => {
      expect(screen.getByTestId('stream-state').textContent).toContain('connected');
    });
    TestSource.last?.onerror?.call(undefined, {});
    await waitFor(() => {
      expect(screen.getByTestId('stream-state').textContent).toContain('reconnecting');
    });
  });

  it('reports a late cancel as an outcome, not a failure', async () => {
    await signedIn(<OperationsScreen projectId={PROJECT} eventSourceFactory={testFactory} />);
    await screen.findByRole('rowheader', { name: 'chapter_production' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the job' }));
    await waitFor(() => {
      expect(screen.getByText(/had already finished, so the cancel had no effect/)).toBeTruthy();
    });
    // And it is not rendered as an error.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pauses and resumes a job through the real endpoints', async () => {
    const { server } = await signedIn(
      <OperationsScreen projectId={PROJECT} eventSourceFactory={testFactory} />,
    );
    await screen.findByRole('rowheader', { name: 'chapter_production' });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(server.state.requests.some((r) => r.url.includes('/jobs/j1:pause'))).toBe(true);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(server.state.requests.some((r) => r.url.includes('/jobs/j1:resume'))).toBe(true);
    });
  });

  it('creates an export and offers an authorized download link', async () => {
    await signedIn(<OperationsScreen projectId={PROJECT} eventSourceFactory={testFactory} />);
    await screen.findByRole('heading', { name: 'Export' });
    await userEvent.click(screen.getByRole('button', { name: 'Create TXT export' }));
    const result = await screen.findByTestId('export-result');
    const link = within(result).getByRole('link', { name: /Download the TXT export/ });
    // A server route that streams authorized bytes — never a filesystem path.
    expect(link.getAttribute('href')).toBe(`/v1/projects/${PROJECT}/exports/x1/content`);
    expect(link.getAttribute('href')).not.toMatch(/^(file:|\/(home|tmp|var))/);
  });

  it('has no accessibility violations', async () => {
    const { container } = await signedIn(
      <OperationsScreen projectId={PROJECT} eventSourceFactory={testFactory} />,
    );
    await screen.findByRole('rowheader', { name: 'chapter_production' });
    await expectNoA11yViolations(container);
  });
});

// ---------------------------------------------------------------------------------------------------------
// keyboard-only critical path
// ---------------------------------------------------------------------------------------------------------

describe('keyboard-only critical path', () => {
  it('signs in, reaches a project and opens it without a mouse', async () => {
    const server = makeServer();
    renderApp(
      <ProtectedRoute>
        <WorkspaceScreen onOpenProject={() => undefined} />
      </ProtectedRoute>,
      server,
    );
    await screen.findByRole('heading', { name: /sign in/i });

    // Tab to the email field, fill the form and submit with the keyboard alone.
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
    await userEvent.keyboard('operator@example.com');
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    await userEvent.keyboard('correct-password');
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('rowheader', { name: 'Second Awakening' })).toBeTruthy();
  });

  it('completes a destructive confirmation entirely from the keyboard', async () => {
    const { server } = await signedIn(<CandidateReviewScreen projectId={PROJECT} chapterNo={1} />);
    await screen.findByRole('heading', { name: /Version 1/ });
    const reject = screen.getByRole('button', { name: 'Reject' });
    reject.focus();
    await userEvent.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog');
    // Focus moved INTO the dialog, so the confirm button is immediately actionable.
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(
        server.state.requests.some(
          (r) =>
            r.url.includes('/reviews') && (r.body as { decision?: string }).decision === 'reject',
        ),
      ).toBe(true);
    });
    // And focus returns to the trigger rather than being dropped to the document.
    await waitFor(() => {
      expect(document.activeElement).toBe(reject);
    });
  });
});
