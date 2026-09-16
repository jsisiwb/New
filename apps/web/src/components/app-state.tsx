/**
 * Session and workspace state for the operator application (Checkpoint 7).
 *
 * THE SECURITY SHAPE OF THIS FILE, stated up front because it is the reason it exists at all:
 *
 *  * NOTHING AUTHENTICATED IS PERSISTED IN THE BROWSER. No `localStorage`, no `sessionStorage`, no
 *    non-HttpOnly cookie written from here. The session lives in the server's HttpOnly cookie; the CSRF
 *    token lives in this module's memory for the lifetime of the page and dies with a reload (after which
 *    `restore()` fetches a fresh one). Manuscript prose is likewise never cached into browser storage.
 *  * ROLE IS A SERVER FACT. `role` comes from the membership the API reports and is used ONLY to decide
 *    what to show. Every action is authorized again server-side, so a tampered role in this state buys an
 *    attacker a visible button and a 403, not an operation.
 *  * A 401 REVOKES LOCAL STATE IMMEDIATELY. The client is constructed with a callback that clears the
 *    session the moment the server says the credential is gone, so a revoked or expired session cannot
 *    leave a page rendering as if it were still signed in.
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiProblem, type Membership, type Session } from '../lib/api';

export interface AppState {
  readonly api: ApiClient;
  readonly session: Session | undefined;
  readonly memberships: readonly Membership[];
  readonly workspaceId: string | undefined;
  readonly role: Membership['role'] | undefined;
  readonly restoring: boolean;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly selectWorkspace: (workspaceId: string) => void;
  /** True when the current role is at least the one named. Presentation only; the server re-decides. */
  readonly can: (minimum: Membership['role']) => boolean;
}

const AppStateContext = createContext<AppState | undefined>(undefined);

const RANK: Record<Membership['role'], number> = { viewer: 1, editor: 2, owner: 3 };

export function AppStateProvider({
  children,
  client,
}: {
  children: ReactNode;
  /** Injected in tests; the app builds one from the configured API base URL. */
  client?: ApiClient;
}): ReactNode {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [memberships, setMemberships] = useState<readonly Membership[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined);
  const [restoring, setRestoring] = useState(true);

  const api = useMemo(() => client ?? new ApiClient({ baseUrl: apiBaseUrl() }), [client]);

  // The provider owns the authenticated state, so it owns the revocation handler — including for a client
  // constructed elsewhere. A 401 must clear this state no matter who built the client.
  useEffect(() => {
    api.setUnauthenticatedHandler(() => {
      setSession(undefined);
      setMemberships([]);
      setWorkspaceId(undefined);
    });
    return () => {
      api.setUnauthenticatedHandler(undefined);
    };
  }, [api]);

  const loadMemberships = useCallback(async () => {
    const items = await api.workspaces();
    setMemberships(items);
    const first = items[0];
    if (first) {
      setWorkspaceId(first.workspaceId);
      api.setWorkspace(first.workspaceId);
    }
  }, [api]);

  // A ref rather than a closure flag: the restore is asynchronous, and a response that arrives after this
  // provider unmounted must not set state on it. (A plain `let` is also correct but its mutation happens
  // in a cleanup the type-flow analysis cannot see, so it reads as a constant.)
  const restoreCancelled = useRef(false);

  useEffect(() => {
    restoreCancelled.current = false;
    void (async () => {
      try {
        const restored = await api.restore();
        if (restoreCancelled.current) return;
        if (restored) {
          setSession(restored);
          await loadMemberships();
        }
      } catch {
        // A restore failure is not an error state for a signed-out visitor: they simply see sign-in.
        if (!restoreCancelled.current) setSession(undefined);
      } finally {
        if (!restoreCancelled.current) setRestoring(false);
      }
    })();
    return () => {
      restoreCancelled.current = true;
    };
  }, [api, loadMemberships]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const next = await api.signIn(email, password);
      setSession(next);
      await loadMemberships();
    },
    [api, loadMemberships],
  );

  const signOut = useCallback(async () => {
    await api.signOut();
    setSession(undefined);
    setMemberships([]);
    setWorkspaceId(undefined);
  }, [api]);

  const selectWorkspace = useCallback(
    (next: string) => {
      setWorkspaceId(next);
      api.setWorkspace(next);
    },
    [api],
  );

  const role = memberships.find((m) => m.workspaceId === workspaceId)?.role;

  const value = useMemo<AppState>(
    () => ({
      api,
      session,
      memberships,
      workspaceId,
      role,
      restoring,
      signIn,
      signOut,
      selectWorkspace,
      can: (minimum) => (role ? RANK[role] >= RANK[minimum] : false),
    }),
    [api, session, memberships, workspaceId, role, restoring, signIn, signOut, selectWorkspace],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}

/**
 * The API base URL.
 *
 * Empty by default, meaning same-origin — the configuration that needs no CORS at all. A deployment that
 * serves the web app from another origin sets `NEXT_PUBLIC_API_BASE_URL`, and that origin must then be in
 * the API's `YEONJAE_CORS_ORIGINS` allowlist, which is default-deny.
 */
export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  return typeof configured === 'string' ? configured : '';
}

/** Render a problem safely: a typed code becomes a known sentence, anything else a generic one. */
export function problemMessage(err: unknown): string {
  if (err instanceof ApiProblem) return err.problem.detail;
  return 'Something went wrong. Try again.';
}
