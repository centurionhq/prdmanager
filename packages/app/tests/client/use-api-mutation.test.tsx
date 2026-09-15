import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedQuery, clearQueryCache, setCachedQuery } from '../../src/api/query-cache.js';
import { useApiMutation } from '../../src/api/use-api-mutation.js';

describe('useApiMutation', () => {
  beforeEach(() => {
    clearQueryCache();
  });

  it('starts idle', () => {
    const fn = vi.fn(async (input: string) => input.toUpperCase());
    const { result } = renderHook(() => useApiMutation(fn));

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('goes through cargando to listo and resolves with the output', async () => {
    const fn = vi.fn(async (input: string) => input.toUpperCase());
    const { result } = renderHook(() => useApiMutation(fn));

    let output: string | undefined;
    await act(async () => {
      output = await result.current.mutate('wo-1');
    });

    expect(output).toBe('WO-1');
    expect(result.current.status).toBe('listo');
    expect(fn).toHaveBeenCalledWith('wo-1');
  });

  it('goes to error and rethrows when fn rejects', async () => {
    const failure = new Error('conflict');
    const fn = vi.fn(async () => {
      throw failure;
    });
    const { result } = renderHook(() => useApiMutation(fn));

    await act(async () => {
      await expect(result.current.mutate('x')).rejects.toBe(failure);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(failure);
  });

  it('invalidates the listed query cache keys on success', async () => {
    setCachedQuery('ordenes', ['WO-1']);
    setCachedQuery('metrics', { total: 1 });
    const fn = vi.fn(async () => ({ id: 'WO-2' }));
    const { result } = renderHook(() => useApiMutation(fn, { invalidate: ['ordenes'] }));

    await act(async () => {
      await result.current.mutate({});
    });

    expect(getCachedQuery('ordenes')).toBeUndefined();
    expect(getCachedQuery('metrics')).toEqual({ total: 1 });
  });

  it('does not invalidate any cache key on failure', async () => {
    setCachedQuery('ordenes', ['WO-1']);
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useApiMutation(fn, { invalidate: ['ordenes'] }));

    await act(async () => {
      await result.current.mutate({}).catch(() => undefined);
    });

    expect(getCachedQuery('ordenes')).toEqual(['WO-1']);
  });

  it('resets the error once a new mutate call starts', async () => {
    const fn = vi.fn(async (shouldFail: boolean) => {
      if (shouldFail) throw new Error('nope');
      return 'ok';
    });
    const { result } = renderHook(() => useApiMutation(fn));

    await act(async () => {
      await result.current.mutate(true).catch(() => undefined);
    });
    expect(result.current.status).toBe('error');

    await waitFor(() => expect(result.current.error).not.toBeNull());

    let output: string | undefined;
    await act(async () => {
      output = await result.current.mutate(false);
    });

    expect(output).toBe('ok');
    expect(result.current.status).toBe('listo');
    expect(result.current.error).toBeNull();
  });
});
