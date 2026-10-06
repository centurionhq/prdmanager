/**
 * SDD-013 §"Capa de datos": generic `cargando | vacio | error | listo` wrapper around any `client.ts`
 * call, in the spirit of `@prdm/ui`'s own `useGraphData` but extended with an explicit "vacio" status
 * (an empty list is not an error) and a session-lived cache (see `./query-cache.ts`) so returning to a
 * screen already visited this session never flashes "cargando" again.
 */
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { confirmQueryRendered, getRenderableQuery, setCachedQuery } from './query-cache.js';

export type ApiQueryStatus = 'cargando' | 'vacio' | 'error' | 'listo';

export interface ApiQueryState<T> {
  readonly status: ApiQueryStatus;
  readonly data: T | undefined;
  readonly error: unknown;
  readonly retry: () => void;
}

interface InternalState<T> {
  readonly status: ApiQueryStatus;
  readonly data: T | undefined;
  readonly error: unknown;
}

function defaultIsEmpty<T>(data: T): boolean {
  return Array.isArray(data) && data.length === 0;
}

function loadedState<T>(data: T, isEmpty: (data: T) => boolean): InternalState<T> {
  return { status: isEmpty(data) ? 'vacio' : 'listo', data, error: null };
}

function initialStateFor<T>(key: string, isEmpty: (data: T) => boolean): InternalState<T> {
  const cached = getRenderableQuery<T>(key);
  return cached === undefined ? { status: 'cargando', data: undefined, error: null } : loadedState(cached, isEmpty);
}

/**
 * `deps` follows `useEffect`'s own dependency-list contract: pass every value `fn` closes over. Changing
 * `key` or any `deps` entry aborts the in-flight call (via `AbortController`, so its eventual settlement
 * never overwrites newer state) and starts a fresh one; `retry()` re-runs `fn` on demand without any of
 * those changing.
 */
export function useApiQuery<T>(
  key: string,
  fn: () => Promise<T>,
  deps: DependencyList,
  isEmpty: (data: T) => boolean = defaultIsEmpty,
): ApiQueryState<T> {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;

  const [state, setState] = useState<InternalState<T>>(() => initialStateFor(key, isEmptyRef.current));
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState(initialStateFor(key, isEmptyRef.current));

    fnRef
      .current()
      .then((data) => {
        if (controller.signal.aborted) return;
        setCachedQuery(key, data);
        setState(loadedState(data, isEmptyRef.current));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', data: undefined, error });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` is the caller-supplied dependency list.
  }, [key, retryTick, ...deps]);

  // SDD-103 D6: the value only becomes reusable cache once *this* screen has rendered it in a commit that
  // actually landed — a render that throws (an envelope the screen cannot parse) never reaches this effect,
  // so the plate's `retry()` finds no cached value and asks the server again instead of throwing on the same
  // poison. `state.data !== undefined` also covers the "vacio" case (an empty list is a real, renderable
  // result); a query whose data is literally `undefined` never had a usable cache entry to begin with.
  useEffect(() => {
    if (state.data !== undefined) confirmQueryRendered(key);
  }, [key, state.data]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);

  return { ...state, retry };
}
