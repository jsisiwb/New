/**
 * Data loading for the operator screens (Checkpoint 7).
 *
 * A screen needs the same four things every time — a value, a loading flag, an error to render safely, and
 * a way to reload after a mutation — and getting any of them subtly wrong is what produces a UI that lies.
 * Two decisions here are deliberate:
 *
 *  * A STALE RESPONSE NEVER WINS. Each load carries a generation counter and a late response from a
 *    previous workspace or project is discarded. Without that, switching workspace quickly can paint the
 *    previous tenant's data over the new one — a correctness bug that looks exactly like a leak.
 *  * THE ERROR IS A MESSAGE, NOT AN EXCEPTION OBJECT. Screens render `error` directly, so it is resolved
 *    to a safe sentence here (via the problem's stable code) rather than by each call site, and an
 *    unrecognised failure can never put server text on the page.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiProblem, messageFor } from './api';

export interface Resource<T> {
  readonly data: T | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly problem: ApiProblem | undefined;
  readonly reload: () => void;
}

export function useResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean } = {},
): Resource<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const generation = useRef(0);
  const previousDeps = useRef<readonly unknown[] | undefined>(undefined);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    generation.current += 1;
    const mine = generation.current;
    const dependenciesChanged =
      previousDeps.current !== undefined &&
      (previousDeps.current.length !== deps.length ||
        previousDeps.current.some((value, index) => !Object.is(value, deps[index])));
    previousDeps.current = deps;
    if (dependenciesChanged) setData(undefined);
    setLoading(true);
    setError(undefined);
    setProblem(undefined);
    void (async () => {
      try {
        const value = await loadRef.current();
        // A response from a superseded load is dropped rather than painted over newer data.
        if (mine !== generation.current) return;
        setData(value);
      } catch (err) {
        if (mine !== generation.current) return;
        if (err instanceof ApiProblem) {
          setProblem(err);
          setError(messageFor(err.problem));
        } else {
          setError('Something went wrong loading this view.');
        }
      } finally {
        if (mine === generation.current) setLoading(false);
      }
    })();
    // The dependency list is supplied by the caller (spread below) and `nonce` forces an explicit
    // reload; `loadRef` keeps the latest closure without making the loader itself a dependency.
    return () => {
      // Invalidate the request before unmount or a dependency change. Fetch cannot be assumed abortable
      // (the injected transport in tests is not), so the generation guard is the portable cleanup.
      generation.current += 1;
    };
  }, [enabled, nonce, ...deps]);

  const reload = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { data, loading, error, problem, reload };
}

/**
 * Run a mutation with a single in-flight guard and a safe error message.
 *
 * The guard is not cosmetic: double-submitting a production start or a canon operation is exactly the kind
 * of duplicate the server's idempotency keys exist to absorb, and not sending the second request at all is
 * cheaper than relying on that absorption.
 */
export function useMutation(): {
  run: (fn: () => Promise<void>) => void;
  busy: boolean;
  error: string | undefined;
  problem: ApiProblem | undefined;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);

  const run = useCallback((fn: () => Promise<void>) => {
    setBusy((current) => {
      if (current) return current;
      setError(undefined);
      setProblem(undefined);
      void (async () => {
        try {
          await fn();
        } catch (err) {
          if (err instanceof ApiProblem) {
            setProblem(err);
            setError(messageFor(err.problem));
          } else {
            setError('Something went wrong. Try again.');
          }
        } finally {
          setBusy(false);
        }
      })();
      return true;
    });
  }, []);

  return {
    run,
    busy,
    error,
    problem,
    clear: () => {
      setError(undefined);
      setProblem(undefined);
    },
  };
}

/**
 * A fresh idempotency key per submission attempt.
 *
 * Generated client-side so that a retry of the SAME logical submission reuses its key (the server replays
 * the stored response), while a genuinely new submission gets a new one.
 */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
