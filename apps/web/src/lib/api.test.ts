/**
 * API client contract (Checkpoint 7).
 *
 * These prove the client's security-relevant behaviour against a fake fetch: what it sends, what it never
 * stores, and what it does when the server says the credential is gone.
 */
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiProblem, asProblem, messageFor } from './api';

/** The shape of a `vi.fn()` standing in for `fetch`, so the assertions below need no casts. */
type FetchMock = { mock: { calls: [url: string, init?: RequestInit | undefined][] } };

/** The init of the n-th call. */
function sentInit(fetchImpl: FetchMock, index: number): RequestInit {
  const call = fetchImpl.mock.calls.at(index);
  if (!call) throw new Error(`no fetch call at index ${index}`);
  return call[1] ?? {};
}

function sentHeaders(fetchImpl: FetchMock, index: number): Record<string, string> {
  return (sentInit(fetchImpl, index).headers ?? {}) as Record<string, string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('api client', () => {
  it('sends credentials and never reads the session cookie itself', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit = {}) =>
      jsonResponse({ items: [] }),
    );
    const client = new ApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.get('/v1/projects');
    const init = sentInit(fetchImpl, 0);
    expect(init.credentials).toBe('include');
    // The client never reads document.cookie: the session secret is HttpOnly and invisible to script.
    expect(JSON.stringify(init.headers)).not.toContain('yeonjae_session');
  });

  it('attaches the CSRF header to unsafe methods only, after sign-in', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST' && _url.endsWith('/v1/auth/login'))
        return jsonResponse({
          csrf_token: 'csrf-value',
          user: { id: 'u1', email: 'a@b.c', display_name: 'A' },
        });
      return jsonResponse({ ok: true });
    });
    const client = new ApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.signIn('a@b.c', 'pw');

    await client.get('/v1/projects');
    expect(sentHeaders(fetchImpl, 1)['x-csrf-token']).toBeUndefined();

    await client.post('/v1/projects', { title: 'x' });
    expect(sentHeaders(fetchImpl, 2)['x-csrf-token']).toBe('csrf-value');
  });

  it('sends the workspace header as a candidate the server verifies', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit = {}) => jsonResponse({}));
    const client = new ApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });
    client.setWorkspace('ws-1');
    await client.get('/v1/projects');
    expect(sentHeaders(fetchImpl, 0)['x-workspace-id']).toBe('ws-1');
  });

  it('revokes local authenticated state and notifies on a 401', async () => {
    const onUnauthenticated = vi.fn();
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit = {}) =>
      url.endsWith('/v1/auth/login')
        ? jsonResponse({ csrf_token: 'c', user: { id: 'u', email: 'e', display_name: 'd' } })
        : jsonResponse(
            {
              type: 'urn:yeonjae:error:UNAUTHENTICATED',
              title: 'Authentication required',
              status: 401,
              detail: 'The session is expired, revoked or invalid.',
              code: 'UNAUTHENTICATED',
              request_id: 'r1',
            },
            401,
          ),
    );
    const client = new ApiClient({
      baseUrl: '',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthenticated,
    });
    await client.signIn('e', 'p');
    client.setWorkspace('ws-1');

    await expect(client.get('/v1/projects')).rejects.toBeInstanceOf(ApiProblem);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    // Everything authenticated is gone, so a later render cannot replay a stale scope.
    expect(client.activeWorkspace()).toBeUndefined();
    // A later write carries no CSRF token, because the cleared state has nothing to replay.
    await expect(client.post('/v1/projects', {})).rejects.toBeInstanceOf(ApiProblem);
    expect(sentHeaders(fetchImpl, -1)['x-csrf-token']).toBeUndefined();
  });

  it('restores a session from the cookie and answers undefined when signed out', async () => {
    const signedOut = new ApiClient({
      baseUrl: '',
      fetchImpl: (async (_url: string, _init: RequestInit = {}) =>
        jsonResponse(
          {
            type: 'u',
            title: 't',
            status: 401,
            detail: 'no session',
            code: 'UNAUTHENTICATED',
            request_id: 'r',
          },
          401,
        )) as unknown as typeof fetch,
    });
    expect(await signedOut.restore()).toBeUndefined();
  });

  it('does not treat a 403 as a lost session', async () => {
    const onUnauthenticated = vi.fn();
    const client = new ApiClient({
      baseUrl: '',
      onUnauthenticated,
      fetchImpl: (async (_url: string, _init: RequestInit = {}) =>
        jsonResponse(
          {
            type: 'u',
            title: 'Insufficient role',
            status: 403,
            detail: 'This operation requires the editor role.',
            code: 'FORBIDDEN',
            request_id: 'r',
          },
          403,
        )) as unknown as typeof fetch,
    });
    await expect(client.post('/v1/projects', {})).rejects.toBeInstanceOf(ApiProblem);
    // Signing an operator out because they lack a role would be a bug, not a safety measure.
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('never renders an unrecognised server body', () => {
    const problem = asProblem('<html>Gateway timeout</html>', 504);
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(problem.detail).not.toContain('html');
    expect(messageFor(problem)).toBe('The server could not complete this request.');
  });

  it('explains a conflict by its reason rather than by server prose', () => {
    expect(
      messageFor({
        type: 't',
        title: 'Conflict',
        status: 409,
        detail: 'raw server text',
        code: 'CONFLICT',
        request_id: 'r',
        data: { reason: 'immutable_version' },
      }),
    ).toContain('pinned');
    expect(
      messageFor({
        type: 't',
        title: 'Conflict',
        status: 409,
        detail: 'raw server text',
        code: 'CONFLICT',
        request_id: 'r',
        data: { reason: 'stale_version' },
      }),
    ).toContain('changed this while you were editing');
  });
});
