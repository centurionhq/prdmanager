/**
 * Simulates loading/empty/error states for the mock demo without a real backend (SDD-011).
 * Any screen can force a state via `?estado=` for screenshots and manual QA.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

export type DemoState = 'listo' | 'cargando' | 'vacio' | 'error';

const FORCEABLE_STATES: readonly DemoState[] = ['cargando', 'vacio', 'error'];

/** Reads `?estado=cargando|vacio|error` from a query string; anything else is `null`. */
export function parseDemoState(search: string): DemoState | null {
  const value = new URLSearchParams(search).get('estado');
  const match = FORCEABLE_STATES.find((state) => state === value);
  return match ?? null;
}

export interface UseDemoStateOptions {
  readonly latencyMs?: number;
}

export interface UseDemoStateResult {
  readonly state: DemoState;
  readonly retry: () => void;
}

const DEFAULT_LATENCY_MS = 400;

/**
 * Starts at `cargando` and flips to `listo` after `latencyMs`, unless the URL forces a state.
 * `retry` restarts the loading cycle and, when the forced state was `error`, clears it from the URL.
 */
export function useDemoState(options: UseDemoStateOptions = {}): UseDemoStateResult {
  const { latencyMs = DEFAULT_LATENCY_MS } = options;
  const [searchParams, setSearchParams] = useSearchParams();
  const forced = parseDemoState(searchParams.toString());
  const [cycle, setCycle] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (forced) return undefined;
    setHasLoaded(false);
    const timer = setTimeout(() => setHasLoaded(true), latencyMs);
    return () => clearTimeout(timer);
    // `cycle` intentionally restarts this effect without changing any visible input.
  }, [forced, latencyMs, cycle]);

  const retry = useCallback(() => {
    if (forced === 'error') {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete('estado');
        return next;
      });
    }
    setCycle((value) => value + 1);
  }, [forced, setSearchParams]);

  return { state: forced ?? (hasLoaded ? 'listo' : 'cargando'), retry };
}
