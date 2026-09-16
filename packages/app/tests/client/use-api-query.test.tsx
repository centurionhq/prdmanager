import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { useApiQuery } from '../../src/api/use-api-query.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useApiQuery', () => {
  beforeEach(() => {
    clearQueryCache();
  });

  it('starts in "cargando" with no cached data', () => {
    const fn = vi.fn(() => new Promise<string[]>(() => undefined));
    const { result } = renderHook(() => useApiQuery('list-a', fn, []));

    expect(result.current.status).toBe('cargando');
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it('transitions to "listo" with the resolved data', async () => {
    const fn = vi.fn(async () => ({ id: 'wo-1' }));
    const { result } = renderHook(() => useApiQuery('wo-1', fn, []));

    await waitFor(() => expect(result.current.status).toBe('listo'));
    expect(result.current.data).toEqual({ id: 'wo-1' });
  });

  it('transitions to "vacio" for an empty array by default', async () => {
    const fn = vi.fn(async () => [] as string[]);
    const { result } = renderHook(() => useApiQuery('empty-list', fn, []));

    await waitFor(() => expect(result.current.status).toBe('vacio'));
    expect(result.current.data).toEqual([]);
  });

  it('honors a custom isEmpty predicate', async () => {
    const fn = vi.fn(async () => ({ items: [] as string[] }));
    const isEmpty = (data: { items: string[] }): boolean => data.items.length === 0;
    const { result } = renderHook(() => useApiQuery('custom-empty', fn, [], isEmpty));

    await waitFor(() => expect(result.current.status).toBe('vacio'));
  });

  it('transitions to "error" when the fetcher rejects', async () => {
    const failure = new Error('network down');
    const fn = vi.fn(async () => {
      throw failure;
    });
    const { result } = renderHook(() => useApiQuery('failing', fn, []));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it('caches the last successful result per key so a remount skips "cargando"', async () => {
    const fn = vi.fn(async () => ({ id: 'wo-2' }));
    const first = renderHook(() => useApiQuery('wo-2', fn, []));
    await waitFor(() => expect(first.result.current.status).toBe('listo'));
    first.unmount();

    const second = renderHook(() => useApiQuery('wo-2', fn, []));
    expect(second.result.current.status).toBe('listo');
    expect(second.result.current.data).toEqual({ id: 'wo-2' });
  });

  it('ignores a stale response when deps change before the previous call resolves', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi.fn((id: string) => (id === 'a' ? first.promise : second.promise));

    const { result, rerender } = renderHook(({ id }: { id: string }) => useApiQuery('roa', () => fn(id), [id]), {
      initialProps: { id: 'a' },
    });

    rerender({ id: 'b' });
    second.resolve('second');
    await waitFor(() => expect(result.current.status).toBe('listo'));
    expect(result.current.data).toBe('second');

    await act(async () => {
      first.resolve('first');
      await Promise.resolve();
    });

    expect(result.current.data).toBe('second');
  });

  it('ignores a stale rejection when deps change before the previous call resolves', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi.fn((id: string) => (id === 'a' ? first.promise : second.promise));

    const { result, rerender } = renderHook(({ id }: { id: string }) => useApiQuery('rob', () => fn(id), [id]), {
      initialProps: { id: 'a' },
    });

    rerender({ id: 'b' });
    second.resolve('second');
    await waitFor(() => expect(result.current.status).toBe('listo'));

    await act(async () => {
      first.reject(new Error('too late'));
      await Promise.resolve();
    });

    expect(result.current.status).toBe('listo');
    expect(result.current.data).toBe('second');
  });

  it('retry() re-runs the fetcher without changing deps', async () => {
    const fn = vi.fn(async () => 'first');
    const { result } = renderHook(() => useApiQuery('retry-key', fn, []));
    await waitFor(() => expect(result.current.data).toBe('first'));

    fn.mockResolvedValueOnce('second');
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.data).toBe('second'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
