/**
 * @vitest-environment jsdom
 *
 * The New-novel journey: the intake form posts a schema-shaped intake, the suggestions render from the
 * server's run state, approval posts the chosen concept, and every state the run can rest in is readable
 * — including the NO_PROVIDER refusal, which must name the missing configuration rather than "error".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { ApiClient } from '../lib/api';
import { AppStateProvider } from '../components/app-state';
import { NovelScreen } from './novel';

const PROJECT = '00000000-0000-7000-8000-000000000001';

interface State {
  run: Record<string, unknown> | undefined;
  noProvider: boolean;
  failIntakeOnce?: boolean;
  failApprovalOnce?: boolean;
  requests: { method: string; url: string; body: unknown; key: string | undefined }[];
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function problem(status: number, code: string, detail: string) {
  return new Response(
    JSON.stringify({
      type: `urn:yeonjae:error:${code}`,
      title: code,
      status,
      detail,
      code,
      request_id: 'r',
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

const SUGGESTIONS = [
  {
    id: '00000000-0000-8000-8000-00000000a001',
    candidate_id: 'c1',
    status: 'candidate',
    angle: 'faithful',
    logline: 'The accountant becomes the hunter they cannot fire.',
    story_promise: 'Competence as revenge.',
    chapter_one_hook: 'Three ghosts on the payroll.',
    ending_direction: 'The ledgers go public.',
    differentiators: ['numbers as a weapon'],
    risk_notes: [],
  },
  {
    id: '00000000-0000-8000-8000-00000000a002',
    candidate_id: 'c2',
    status: 'candidate',
    angle: 'sharper hook',
    logline: 'The audit is tomorrow and the ledgers are already burning.',
    story_promise: 'Speed.',
    differentiators: ['a ticking clock'],
    risk_notes: ['pace fatigue'],
  },
];

function makeServer(initial: Partial<State> = {}) {
  const state: State = { run: undefined, noProvider: false, requests: [], ...initial };
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    state.requests.push({
      method,
      url,
      body,
      key: (init.headers as Record<string, string> | undefined)?.['idempotency-key'],
    });
    if (url.endsWith('/v1/auth/login') && method === 'POST')
      return ok({
        csrf_token: 'csrf-1',
        user: { id: 'u1', email: 'operator@example.com', display_name: 'Operator' },
      });
    if (url.endsWith('/v1/me'))
      return ok({
        user: { id: 'u1', email: 'op@example.com', display_name: 'Operator' },
        via: 'session',
        workspaces: [{ workspace_id: 'ws-1', name: 'Studio', role: 'owner' }],
      });
    if (url.endsWith('/novel') && method === 'POST') {
      if (state.noProvider)
        return problem(503, 'NO_PROVIDER', 'This API process has no model provider configured.');
      if (state.failIntakeOnce) {
        state.failIntakeOnce = false;
        return problem(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'The request key belongs to a different request.',
        );
      }
      state.run = {
        id: 'run1',
        status: 'awaiting_approval',
        spec_version: 1,
        approved_concept_id: null,
        target_chapters: (body as { intake: { target_chapters: number } }).intake.target_chapters,
        next_chapter: 1,
        auto_continue: true,
        stop_after_chapter: null,
        last_error: null,
        running: false,
      };
      return ok({ run: state.run, spec_version: 1, suggestions: SUGGESTIONS }, 201);
    }
    if (url.endsWith('/novel/approve') && method === 'POST') {
      if (state.failApprovalOnce) {
        state.failApprovalOnce = false;
        return problem(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'The request key belongs to a different request.',
        );
      }
      state.run = {
        ...state.run,
        status: 'planning',
        approved_concept_id: (body as { concept_id: string }).concept_id,
        auto_continue: (body as { auto_continue?: boolean }).auto_continue ?? true,
      };
      return ok({ run: state.run }, 202);
    }
    if (url.endsWith('/novel/bible') && method === 'GET') {
      if (!state.run || state.run.status === 'awaiting_approval')
        return problem(404, 'NOT_FOUND', 'The story bible is not ready.');
      return ok({
        bible: {
          design: {
            characters: { protagonist: { name: 'Seo Ji-an', wound: 'Betrayal' } },
            world: { premise: 'Ghosts audit the living.' },
            progression: { power: 'Credibility' },
          },
          entities: [{ kind: 'character', name: 'Seo Ji-an' }],
          propositions: [{ statement: 'The ledgers can expose the treasurer.' }],
          promises: [{ statement: 'Competence becomes revenge.' }],
          commits: [{ statement: 'No reveal before chapter three.' }],
        },
        blueprint: { story_promise: 'Competence as revenge.', seasons: [{ ordinal: 1 }] },
      });
    }
    if (url.endsWith('/novel') && method === 'GET') {
      if (!state.run) return problem(404, 'NOT_FOUND', 'This project has no novel run yet.');
      return ok({
        run: state.run,
        suggestions: state.run.status === 'awaiting_approval' ? SUGGESTIONS : [],
        plan:
          state.run.status === 'planning' || state.run.status === 'producing'
            ? {
                target_chapters: 12,
                concept_id: state.run.approved_concept_id,
                spec_version: 1,
                bible: {
                  characters: [{ name: 'Seo Ji-an', description: 'Accountant.' }],
                  locations: [{ name: 'Counting house' }],
                  organizations: [],
                  abilities: [],
                  propositions: 3,
                  promises: [
                    { statement: 'Who are the ghosts?', type: 'mystery', importance: 'core' },
                  ],
                },
                blueprint: {
                  story_promise: 'Competence as revenge.',
                  main_conflict: 'The treasurer controls the audit.',
                  ending: { type: 'bittersweet' },
                  seasons: [
                    {
                      ordinal: 1,
                      title: 'Ghost Payroll',
                      objective: 'Find the ghosts.',
                      chapters: { from: 1, to: 12 },
                    },
                  ],
                },
              }
            : null,
        chapters:
          state.run.status === 'producing'
            ? [{ number: 1, status: 'accepted', title: 'The ledger' }]
            : [],
        accepted_chapters: state.run.status === 'producing' ? 1 : 0,
        spend_cents: 42,
      });
    }
    return problem(404, 'NOT_FOUND', 'No such route.');
  });
  return { state, fetchImpl };
}

async function renderScreen(server = makeServer()) {
  const client = new ApiClient({
    baseUrl: '',
    fetchImpl: server.fetchImpl as unknown as typeof fetch,
  });
  // Restoring `/v1/me` intentionally does not mint CSRF. Sign in through the real client first so
  // protected novel actions test an authenticated writable session without weakening re-auth behavior.
  await client.signIn('operator@example.com', 'correct-password');
  const utils = render(
    <AppStateProvider client={client}>
      <NovelScreen projectId={PROJECT} />
    </AppStateProvider>,
  );
  return { ...utils, server };
}

afterEach(() => {
  cleanup();
});

describe('new novel journey', () => {
  it('reuses the intake key when retrying the unchanged request', async () => {
    const { server } = await renderScreen(makeServer({ failIntakeOnce: true }));
    await screen.findByRole('heading', { name: 'Describe the novel you want' });
    await userEvent.type(screen.getByLabelText('Working title'), 'Ash Ledger');
    await userEvent.type(
      screen.getByLabelText('Premise'),
      'A disgraced guild accountant discovers the ledgers are forged and must climb the ranks to prove it.',
    );
    const submit = screen.getByRole('button', { name: 'Get story suggestions' });
    await userEvent.click(submit);
    await screen.findByRole('alert');
    await userEvent.click(submit);

    await screen.findByRole('heading', { name: /Story suggestions/ });
    const posts = server.state.requests.filter(
      (request) => request.method === 'POST' && request.url.endsWith('/novel'),
    );
    expect(posts).toHaveLength(2);
    expect(posts[0]?.key).toBeTruthy();
    expect(posts[1]?.key).toBe(posts[0]?.key);
  });

  it('mints a new intake key after the request is edited', async () => {
    const { server } = await renderScreen(makeServer({ failIntakeOnce: true }));
    await screen.findByRole('heading', { name: 'Describe the novel you want' });
    await userEvent.type(screen.getByLabelText('Working title'), 'Ash Ledger');
    await userEvent.type(
      screen.getByLabelText('Premise'),
      'A disgraced guild accountant discovers the ledgers are forged and must climb the ranks to prove it.',
    );
    const submit = screen.getByRole('button', { name: 'Get story suggestions' });
    await userEvent.click(submit);
    await screen.findByRole('alert');
    await userEvent.type(screen.getByLabelText('Working title'), ' Revised');
    await userEvent.click(submit);

    await screen.findByRole('heading', { name: /Story suggestions/ });
    const posts = server.state.requests.filter(
      (request) => request.method === 'POST' && request.url.endsWith('/novel'),
    );
    expect(posts).toHaveLength(2);
    expect(posts[1]?.key).not.toBe(posts[0]?.key);
  });

  it('mints a new approval key when autopilot mode changes', async () => {
    const { server } = await renderScreen(
      makeServer({
        failApprovalOnce: true,
        run: {
          id: 'run1',
          status: 'awaiting_approval',
          spec_version: 1,
          approved_concept_id: null,
          target_chapters: 12,
          next_chapter: 1,
          auto_continue: true,
          stop_after_chapter: null,
          last_error: null,
          running: false,
        },
      }),
    );
    await screen.findByRole('heading', { name: /Story suggestions/ });
    await userEvent.click(
      screen.getByRole('button', { name: 'Approve direction 1 and start writing' }),
    );
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Approve direction 1 and start writing' }),
    );

    await screen.findByText('building the story bible');
    const posts = server.state.requests.filter((request) => request.url.endsWith('/novel/approve'));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.key).toBeTruthy();
    expect(posts[1]?.key).not.toBe(posts[0]?.key);
    expect(posts[1]?.body).toEqual({ concept_id: SUGGESTIONS[0]?.id, auto_continue: false });
  });

  it('posts a schema-shaped intake and shows the suggestions to approve', async () => {
    const { server } = await renderScreen();
    await screen.findByRole('heading', { name: 'Describe the novel you want' });
    await userEvent.type(screen.getByLabelText('Working title'), 'Ash Ledger');
    await userEvent.type(
      screen.getByLabelText('Premise'),
      'A disgraced guild accountant discovers the ledgers are forged and must climb the ranks to prove it.',
    );
    await userEvent.clear(screen.getByLabelText('Number of chapters'));
    await userEvent.type(screen.getByLabelText('Number of chapters'), '12');
    await userEvent.type(
      screen.getByLabelText(/Forbidden developments/),
      'No harem\nNo reveal before ch.3',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Get story suggestions' }));

    const post = await waitFor(() => {
      const r = server.state.requests.find((x) => x.method === 'POST' && x.url.endsWith('/novel'));
      expect(r).toBeDefined();
      return r;
    });
    const intake = (post?.body as { intake: Record<string, unknown> }).intake;
    expect(intake).toMatchObject({
      title_working: 'Ash Ledger',
      genre: { primary: 'hunter-gate' },
      target_chapters: 12,
      target_words_per_chapter: 2500,
      forbidden_developments: ['No harem', 'No reveal before ch.3'],
      operating_mode: 'autopilot',
    });

    await screen.findByRole('heading', { name: /Story suggestions/ });
    expect(screen.getByText('The accountant becomes the hunter they cannot fire.')).toBeTruthy();
    expect(
      screen.getByText('The audit is tomorrow and the ledgers are already burning.'),
    ).toBeTruthy();

    await userEvent.click(
      screen.getByRole('button', { name: 'Approve direction 2 and start writing' }),
    );
    await waitFor(() => {
      const approve = server.state.requests.find((x) => x.url.endsWith('/novel/approve'));
      expect(approve?.body).toEqual({ concept_id: SUGGESTIONS[1]?.id, auto_continue: true });
    });
    // The run panel now shows the plan being built and the bible once the server reports it.
    await screen.findByText('building the story bible');
    expect((await screen.findByRole('heading', { name: 'Story bible' })).textContent).toBe(
      'Story bible',
    );
    expect(screen.getByText('Seo Ji-an')).toBeTruthy();
    expect(screen.getByText(/Ghost Payroll/)).toBeTruthy();
  });

  it('names a missing provider instead of a generic failure', async () => {
    await renderScreen(makeServer({ noProvider: true }));
    await screen.findByRole('heading', { name: 'Describe the novel you want' });
    await userEvent.type(screen.getByLabelText('Working title'), 'X');
    await userEvent.type(
      screen.getByLabelText('Premise'),
      'A premise long enough to pass the minimum length check.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Get story suggestions' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No model provider is configured');
  });

  it('renders a resting producing run with progress and controls', async () => {
    const server = makeServer({
      run: {
        id: 'run1',
        status: 'producing',
        spec_version: 1,
        approved_concept_id: SUGGESTIONS[0]?.id,
        target_chapters: 12,
        next_chapter: 2,
        auto_continue: true,
        stop_after_chapter: null,
        last_error: null,
        running: true,
      },
    });
    const { container } = await renderScreen(server);
    await screen.findByText('writing chapters');
    expect(screen.getByLabelText('chapters accepted').getAttribute('value')).toBe('1');
    expect(screen.getByRole('button', { name: 'Pause after the current step' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeTruthy();
    expect(screen.queryByText('Seo Ji-an')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Load full story bible' }));
    await screen.findByText(/Ghosts audit the living/);
    expect(screen.getByText(/Download full story bible \(JSON\)/)).toBeTruthy();
    expect(
      server.state.requests.filter((request) => request.url.endsWith('/novel/bible')).length,
    ).toBe(1);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
