import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

export type GraphDataStatus = 'loading' | 'error' | 'ready';

export interface GraphDataState<T> {
  status: GraphDataStatus;
  data: T | null;
  error: unknown;
  /** Re-runs `fetcher` (SDD-005 "Actualizar": full-graph/drift are pulled on demand, never on a poll interval). */
  refetch: () => void;
}

interface InternalState<T> {
  status: GraphDataStatus;
  data: T | null;
  error: unknown;
}

const LOADING_STATE = { status: 'loading', data: null, error: null } as const;

/**
 * Generic `loading | error | ready` wrapper around any `api/client.ts` call (SDD-005 "Frontend"
 * `hooks/useGraphData`): `GraphCanvas`, the tree view and `NodeDetailPanel` each pass a different endpoint
 * through the same `fetcher` in a later phase. `deps` follows the same contract as `useEffect`'s own dependency
 * list — pass the values `fetcher` closes over (e.g. a selected node id) so a change re-fetches automatically;
 * `refetch()` re-runs it on demand (e.g. the "Actualizar" button) without any of those values changing.
 */
export function useGraphData<T>(fetcher: () => Promise<T>, deps: DependencyList = []): GraphDataState<T> {
  const [state, setState] = useState<InternalState<T>>(LOADING_STATE);
  const [refetchTick, setRefetchTick] = useState(0);
  // Always the latest fetcher, so the effect below can depend only on [...deps, refetchTick] and still call the
  // current closure — re-declaring `fetcher` on every render (e.g. an inline arrow) must not itself retrigger a
  // fetch, only an actual dependency or an explicit refetch() should.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setState(LOADING_STATE);

    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', data: null, error });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller-supplied dependency list.
  }, [refetchTick, ...deps]);

  const refetch = useCallback(() => setRefetchTick((tick) => tick + 1), []);

  return { ...state, refetch };
}
