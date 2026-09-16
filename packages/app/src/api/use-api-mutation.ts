/**
 * SDD-013 §"Capa de datos": generic `idle | cargando | error | listo` wrapper around any `client.ts`
 * mutation. On success it evicts every `useApiQuery` cache entry listed in `opts.invalidate` (see
 * `./query-cache.ts`), so the next mount of an affected screen refetches instead of showing stale data.
 */
import { useCallback, useRef, useState } from 'react';
import { invalidateQueryCache } from './query-cache.js';

export type ApiMutationStatus = 'idle' | 'cargando' | 'error' | 'listo';

export interface ApiMutationOptions {
  readonly invalidate?: readonly string[];
}

export interface ApiMutationState<TInput, TOutput> {
  readonly mutate: (input: TInput) => Promise<TOutput>;
  readonly status: ApiMutationStatus;
  readonly error: unknown;
}

export function useApiMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  opts: ApiMutationOptions = {},
): ApiMutationState<TInput, TOutput> {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [status, setStatus] = useState<ApiMutationStatus>('idle');
  const [error, setError] = useState<unknown>(null);

  const mutate = useCallback(async (input: TInput): Promise<TOutput> => {
    setStatus('cargando');
    setError(null);
    try {
      const output = await fnRef.current(input);
      const invalidate = optsRef.current.invalidate;
      if (invalidate && invalidate.length > 0) invalidateQueryCache(invalidate);
      setStatus('listo');
      return output;
    } catch (thrown: unknown) {
      setStatus('error');
      setError(thrown);
      throw thrown;
    }
  }, []);

  return { mutate, status, error };
}
