/**
 * Screen 1 — Authentication (Checkpoint 7, UI plan §1).
 *
 * Sign in, session restoration, sign out, and the handling of a session that has expired or been revoked
 * while the page was open. The security properties are in `app-state.tsx` and `api.ts`; what this file owns
 * is that they are *visible and operable*:
 *
 *  * the sign-in form is a real labelled form with an error summary that takes focus on failure, so a
 *    keyboard operator learns why the attempt failed without hunting;
 *  * a failed sign-in never says which of email or password was wrong — that would be a user-enumeration
 *    oracle — and the API's `INVALID_CREDENTIALS` message is rendered as one sentence;
 *  * `ProtectedRoute` renders nothing sensitive while the session is still being restored, so a reload
 *    cannot flash workspace content before the server has confirmed the cookie.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { ApiProblem, messageFor } from '../lib/api';
import { useAppState } from '../components/app-state';
import { ErrorSummary, Field, Form, LiveRegion } from '../components/primitives';

export function SignInScreen(): ReactNode {
  const { signIn, session, restoring, reauthRequired } = useAppState();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (restoring) return <p role="status">Restoring your session…</p>;
  if (session)
    return (
      <p role="status">
        Signed in as {session.displayName} ({session.email}).
      </p>
    );

  return (
    <section aria-labelledby="signin-heading">
      <h1 id="signin-heading">Sign in to Yeonjae Studio</h1>
      {reauthRequired ? (
        <p role="status">
          Your session is still valid, but this page was reloaded and its security token was
          cleared. Sign in again to enable changes.
        </p>
      ) : null}
      {problem ? (
        <ErrorSummary
          title="Sign-in failed"
          message={messageFor(problem.problem)}
          fields={problem.fieldErrors}
        />
      ) : null}
      <Form
        label="Sign in"
        onSubmit={async () => {
          setBusy(true);
          setProblem(undefined);
          try {
            await signIn(email, password);
          } catch (err) {
            setProblem(err instanceof ApiProblem ? err : undefined);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field path="email" label="Email">
          {(props) => (
            <input
              {...props}
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          )}
        </Field>
        <Field path="password" label="Password">
          {(props) => (
            <input
              {...props}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          )}
        </Field>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </Form>
    </section>
  );
}

/**
 * Gate a screen behind a live session.
 *
 * While `restoring` is true nothing protected renders: showing content first and redirecting afterwards
 * would flash another operator's workspace on a shared machine.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): ReactNode {
  const { session, restoring } = useAppState();
  if (restoring) return <p role="status">Checking your session…</p>;
  if (!session)
    return (
      <div>
        <LiveRegion message="Your session has ended. Sign in to continue." />
        <SignInScreen />
      </div>
    );
  return <>{children}</>;
}

export function SignOutButton(): ReactNode {
  const { signOut, session } = useAppState();
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut().finally(() => {
          setBusy(false);
        });
      }}
    >
      Sign out
    </button>
  );
}
