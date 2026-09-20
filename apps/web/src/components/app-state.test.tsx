/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiClient } from '../lib/api';
import { AppStateProvider, useAppState } from './app-state';

function Harness(): ReactNode {
  const state = useAppState();
  return (
    <>
      <output data-testid="session">{state.session?.email ?? 'signed-out'}</output>
      <button type="button" onClick={() => void state.signIn('operator@example.com', 'password')}>
        sign in
      </button>
      <button
        type="button"
        onClick={() => {
          void state.signOut().catch(() => undefined);
        }}
      >
        sign out
      </button>
    </>
  );
}

describe('AppStateProvider', () => {
  it('clears the rendered session when logout is rejected', async () => {
    let restored = false;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/v1/me')) {
        if (!restored) {
          return new Response(
            JSON.stringify({
              type: 'u',
              title: 'Unauthenticated',
              status: 401,
              detail: 'no session',
              code: 'UNAUTHENTICATED',
              request_id: 'r',
            }),
            { status: 401, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return new Response(
          JSON.stringify({
            user: { id: 'u1', email: 'operator@example.com', display_name: 'Operator' },
            via: 'session',
            workspaces: [{ workspace_id: 'ws-1', name: 'Studio', role: 'owner' }],
          }),
        );
      }
      if (url.endsWith('/v1/auth/login')) {
        restored = true;
        return new Response(
          JSON.stringify({
            csrf_token: 'csrf',
            user: { id: 'u1', email: 'operator@example.com', display_name: 'Operator' },
          }),
        );
      }
      if (url.endsWith('/v1/auth/logout')) {
        return new Response(
          JSON.stringify({
            type: 'c',
            title: 'CSRF required',
            status: 403,
            detail: 'csrf required',
            code: 'CSRF_REQUIRED',
            request_id: 'r',
          }),
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        );
      }
      throw new Error(`Unexpected ${init.method ?? 'GET'} ${url}`);
    });
    const client = new ApiClient({ baseUrl: '', fetchImpl: fetchImpl as unknown as typeof fetch });

    render(
      <AppStateProvider client={client}>
        <Harness />
      </AppStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('signed-out');
    });
    fireEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('operator@example.com');
    });

    fireEvent.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => {
      expect(screen.getByTestId('session').textContent).toBe('signed-out');
    });
  });
});
