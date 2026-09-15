import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDemoState, useDemoState, type UseDemoStateResult } from '../../src/lib/use-demo-state';

describe('parseDemoState', () => {
  it('reads a forced loading state from the query string', () => {
    expect(parseDemoState('?estado=cargando')).toBe('cargando');
  });

  it('reads a forced empty state from the query string', () => {
    expect(parseDemoState('?estado=vacio')).toBe('vacio');
  });

  it('reads a forced error state from the query string', () => {
    expect(parseDemoState('?estado=error')).toBe('error');
  });

  it('returns null when the param is missing', () => {
    expect(parseDemoState('')).toBeNull();
  });

  it('returns null for an unrecognized value', () => {
    expect(parseDemoState('?estado=listo')).toBeNull();
  });
});

function renderDemoState(initialEntry: string, latencyMs?: number): { current: () => UseDemoStateResult } {
  let latest: UseDemoStateResult | undefined;

  function Probe() {
    latest = useDemoState(latencyMs === undefined ? undefined : { latencyMs });
    return <span data-testid="state">{latest.state}</span>;
  }

  const router = createMemoryRouter([{ path: '/', element: <Probe /> }], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);

  return {
    current: () => {
      if (!latest) throw new Error('useDemoState probe did not render');
      return latest;
    },
  };
}

describe('useDemoState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts loading and flips to listo after the latency window', () => {
    const probe = renderDemoState('/', 400);
    expect(screen.getByTestId('state').textContent).toBe('cargando');

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByTestId('state').textContent).toBe('listo');
    expect(probe.current().state).toBe('listo');
  });

  it('lets a forced state in the URL win over the loading cycle', () => {
    renderDemoState('/?estado=vacio', 400);
    expect(screen.getByTestId('state').textContent).toBe('vacio');

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(screen.getByTestId('state').textContent).toBe('vacio');
  });

  it('keeps a forced error state visible', () => {
    renderDemoState('/?estado=error', 400);
    expect(screen.getByTestId('state').textContent).toBe('error');
  });

  it('restarts the loading cycle on retry', () => {
    const probe = renderDemoState('/', 400);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('state').textContent).toBe('listo');

    act(() => {
      probe.current().retry();
    });
    expect(screen.getByTestId('state').textContent).toBe('cargando');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('state').textContent).toBe('listo');
  });

  it('clears a forced error from the URL when retrying', () => {
    const probe = renderDemoState('/?estado=error', 400);
    expect(screen.getByTestId('state').textContent).toBe('error');

    act(() => {
      probe.current().retry();
    });
    expect(screen.getByTestId('state').textContent).toBe('cargando');

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByTestId('state').textContent).toBe('listo');
  });

  it('cleans up the pending timer on unmount', () => {
    function Probe() {
      useDemoState({ latencyMs: 400 });
      return null;
    }
    const router = createMemoryRouter([{ path: '/', element: <Probe /> }], { initialEntries: ['/'] });
    const { unmount } = render(<RouterProvider router={router} />);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
