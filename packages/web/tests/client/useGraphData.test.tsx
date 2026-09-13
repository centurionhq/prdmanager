import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGraphData } from '../../src/client/hooks/useGraphData';

describe('useGraphData', () => {
  it('starts in the loading state', () => {
    const fetcher = vi.fn(() => new Promise<string>(() => undefined));
    const { result } = renderHook(() => useGraphData(fetcher));

    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('transitions to ready with the resolved data', async () => {
    const fetcher = vi.fn(async () => ({ nodes: [], edges: [] }));
    const { result } = renderHook(() => useGraphData(fetcher));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toEqual({ nodes: [], edges: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('transitions to error when the fetcher rejects', async () => {
    const failure = new Error('network down');
    const fetcher = vi.fn(async () => {
      throw failure;
    });
    const { result } = renderHook(() => useGraphData(fetcher));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeNull();
  });

  it('refetch() re-runs the fetcher and resets to loading first', async () => {
    const fetcher = vi.fn(async () => 'first');
    const { result } = renderHook(() => useGraphData(fetcher));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data).toBe('first');

    fetcher.mockResolvedValueOnce('second');
    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toBe('second'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when a dependency changes', async () => {
    const fetcher = vi.fn(async (id: string) => `node:${id}`);
    const { result, rerender } = renderHook(({ id }: { id: string }) => useGraphData(() => fetcher(id), [id]), {
      initialProps: { id: 'FR-001' },
    });

    await waitFor(() => expect(result.current.data).toBe('node:FR-001'));

    rerender({ id: 'FR-002' });

    await waitFor(() => expect(result.current.data).toBe('node:FR-002'));
    expect(fetcher).toHaveBeenNthCalledWith(1, 'FR-001');
    expect(fetcher).toHaveBeenNthCalledWith(2, 'FR-002');
  });

  it('ignores a stale response when unmounted before it resolves', async () => {
    let resolveFetch: (value: string) => void = () => undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useGraphData(fetcher));

    unmount();
    await act(async () => {
      resolveFetch('too late');
      await Promise.resolve();
    });

    expect(result.current.status).toBe('loading');
  });
});
