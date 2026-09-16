/**
 * The operator application's only door to the server: the real `/v1` API (Checkpoint 7).
 *
 * There is deliberately no mock, no fixture and no local store behind this. Every screen calls these
 * functions, and these functions call the Fastify API described by the API plan. A static success path
 * would make the UI tests prove nothing about whether the product works, which is the exact failure mode
 * this checkpoint is meant to close.
 *
 * FOUR RULES THIS MODULE ENFORCES FOR EVERY SCREEN, so no screen has to remember them:
 *
 *  1. CREDENTIALS LIVE IN THE COOKIE, NOT IN JAVASCRIPT. Requests are sent with `credentials: 'include'`
 *     and the session cookie is HttpOnly on the server side, so the session secret is never readable by
 *     this code — and therefore never storable in `localStorage`, never loggable, never exfiltratable by
 *     injected script. The only token this module holds in memory is the CSRF token, which is useless
 *     without the cookie.
 *  2. UNSAFE METHODS CARRY THE CSRF HEADER. The API refuses a cookie-authenticated write without it
 *     (double-submit). Attaching it here rather than per-call means a new screen cannot forget it.
 *  3. ROLES AND WORKSPACE IDS ARE SERVER FACTS. The workspace header names a candidate; the server decides
 *     membership. This module never infers a role from anything it was handed by the page.
 *  4. ERRORS ARE TYPED PROBLEM DOCUMENTS. Every failure becomes an `ApiProblem` carrying the RFC 9457
 *     `code`, so screens branch on a stable identifier instead of parsing English prose, and a 5xx body
 *     is never rendered to the user.
 */

/** The API's stable error shape (RFC 9457 plus the project's `code`). */
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly request_id: string;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
  readonly data?: Readonly<Record<string, unknown>>;
}

export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail);
    this.name = 'ApiProblem';
  }

  get status(): number {
    return this.problem.status;
  }

  get code(): string {
    return this.problem.code;
  }

  /** Field errors, keyed by path, for an accessible error summary above a form. */
  get fieldErrors(): readonly { path: string; message: string }[] {
    return this.problem.errors ?? [];
  }

  /**
   * Whether this failure means "your session is gone".
   *
   * 403 is deliberately NOT included: a role refusal is not an authentication failure, and treating it as
   * one would sign an operator out for clicking a button they simply lack the role for.
   */
  get isUnauthenticated(): boolean {
    return this.problem.status === 401;
  }
}

export interface Session {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly csrfToken: string;
}

export interface Membership {
  readonly workspaceId: string;
  readonly name: string;
  readonly role: 'owner' | 'editor' | 'viewer';
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Injected so tests can drive the client without a network, and so SSR can pass a scoped fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly onUnauthenticated?: () => void;
}

/**
 * A stateful client bound to one signed-in operator and one active workspace.
 *
 * It holds exactly two pieces of state — the CSRF token and the active workspace id — and both are
 * replaced wholesale on sign-in and cleared on sign-out. Nothing here is persisted to browser storage.
 */
export class ApiClient {
  private csrfToken: string | undefined;
  private workspaceId: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private onUnauthenticated: (() => void) | undefined;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.onUnauthenticated = options.onUnauthenticated;
  }

  setWorkspace(workspaceId: string | undefined): void {
    this.workspaceId = workspaceId;
  }

  /**
   * Register the handler that revokes application state when the server says the credential is gone.
   *
   * Settable after construction because the owner of that state is the React provider, which may be handed
   * a client built elsewhere (a test, or a shared instance). Without this, an injected client would answer
   * 401 correctly and the UI would keep rendering as if it were still signed in.
   */
  setUnauthenticatedHandler(handler: (() => void) | undefined): void {
    this.onUnauthenticated = handler;
  }

  activeWorkspace(): string | undefined {
    return this.workspaceId;
  }

  /**
   * Drop every trace of the authenticated state this process holds.
   *
   * Called on sign-out and whenever the server answers 401. The cookie is the server's to clear; what this
   * guarantees is that no CSRF token or workspace scope survives in memory to be replayed by a later render.
   */
  clear(): void {
    this.csrfToken = undefined;
    this.workspaceId = undefined;
  }

  async request<T>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      idempotencyKey?: string | undefined;
      workspace?: string | undefined;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const workspace = options.workspace ?? this.workspaceId;
    if (workspace) headers['x-workspace-id'] = workspace;
    if (UNSAFE.has(method.toUpperCase()) && this.csrfToken)
      headers['x-csrf-token'] = this.csrfToken;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      // The session cookie travels here; it is never read by this code.
      credentials: 'include',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : undefined;

    if (!response.ok) {
      const problem = asProblem(parsed, response.status);
      if (problem.status === 401) {
        this.clear();
        this.onUnauthenticated?.();
      }
      throw new ApiProblem(problem);
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('POST', path, { body: body ?? {}, idempotencyKey });
  }

  put<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return this.request<T>('PUT', path, { body, idempotencyKey });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, { body });
  }

  // ---- authentication ------------------------------------------------------------------------------

  async signIn(email: string, password: string): Promise<Session> {
    const body = await this.request<{
      csrf_token: string;
      user: { id: string; email: string; display_name: string };
    }>('POST', '/v1/auth/login', { body: { email, password } });
    this.csrfToken = body.csrf_token;
    return {
      userId: body.user.id,
      email: body.user.email,
      displayName: body.user.display_name,
      csrfToken: body.csrf_token,
    };
  }

  /**
   * Restore a session from the cookie the browser already holds.
   *
   * A reload loses the in-memory CSRF token, so this re-reads it from `/v1/me`. Returning `undefined`
   * rather than throwing on 401 is what lets a protected route redirect to sign-in cleanly instead of
   * rendering an error for the ordinary "not signed in yet" case.
   */
  async restore(): Promise<Session | undefined> {
    try {
      const body = await this.request<{
        csrf_token: string;
        user: { id: string; email: string; display_name: string };
      }>('GET', '/v1/me');
      this.csrfToken = body.csrf_token;
      return {
        userId: body.user.id,
        email: body.user.email,
        displayName: body.user.display_name,
        csrfToken: body.csrf_token,
      };
    } catch (err) {
      if (err instanceof ApiProblem && err.isUnauthenticated) return undefined;
      throw err;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.request('POST', '/v1/auth/logout', { body: {} });
    } finally {
      // Local state is dropped even if the network call failed: a UI that still believed it was signed in
      // after the operator asked to leave would be the worse outcome.
      this.clear();
    }
  }

  async workspaces(): Promise<readonly Membership[]> {
    const body = await this.request<{
      items: { workspace_id: string; name: string; role: 'owner' | 'editor' | 'viewer' }[];
    }>('GET', '/v1/me');
    return body.items.map((item) => ({
      workspaceId: item.workspace_id,
      name: item.name,
      role: item.role,
    }));
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Coerce any failure into a problem document.
 *
 * A response that is not a recognisable problem — an HTML error page from a proxy, say — becomes a generic
 * internal error rather than being rendered. Echoing an unrecognised body to the operator is exactly how
 * internal detail leaks into a UI.
 */
export function asProblem(value: unknown, status: number): Problem {
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { detail?: unknown }).detail === 'string'
  )
    return value as Problem;
  return {
    type: 'urn:yeonjae:error:INTERNAL_ERROR',
    title: 'Request failed',
    status,
    detail:
      status >= 500
        ? 'The server could not complete this request. Try again, or contact an operator.'
        : 'The request could not be completed.',
    code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
    request_id: '',
  };
}

/**
 * A human sentence for a problem, chosen by code rather than by echoing server prose.
 *
 * Screens use this so that the same failure reads the same way everywhere, and so a 5xx never surfaces a
 * server-authored string.
 */
export function messageFor(problem: Problem): string {
  switch (problem.code) {
    case 'UNAUTHENTICATED':
      return 'Your session has ended. Sign in again to continue.';
    case 'INVALID_CREDENTIALS':
      return 'That email and password combination was not recognised.';
    case 'CSRF_REQUIRED':
      return 'This action could not be verified. Reload the page and try again.';
    case 'FORBIDDEN':
      return 'Your role does not allow this action.';
    case 'NOT_A_MEMBER':
      return 'You are not a member of this workspace.';
    case 'NOT_FOUND':
      return 'That item does not exist, or you cannot see it.';
    case 'CONFLICT':
      return problem.data?.reason === 'immutable_version'
        ? 'This version is pinned and cannot be edited. Create a new version instead.'
        : problem.data?.reason === 'plan_locked'
          ? 'This plan version is locked and cannot be edited. Create a new version instead.'
          : 'Someone else changed this while you were editing. Reload to see the current version.';
    case 'SELECTION_CONFLICT':
      return 'This selection has already been decided. Reload to see the current winner.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'This request was already submitted with different content.';
    case 'VALIDATION_FAILED':
    case 'SPEC_INVALID':
      return 'Some fields need attention before this can be saved.';
    case 'RATE_LIMITED':
      return 'Too many requests. Wait a moment and try again.';
    case 'BUDGET_EXHAUSTED':
      return 'This would exceed the project budget, so nothing was started or spent.';
    case 'INTERNAL_ERROR':
      return 'The server could not complete this request.';
    default:
      return problem.detail;
  }
}
