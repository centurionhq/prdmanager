import cytoscape from 'cytoscape';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCytoscape, type CytoscapeFactory } from '../../src/client/hooks/useCytoscape';

/**
 * jsdom has no `<canvas>`, so `useCytoscape`'s injected factory always runs the real `cytoscape()` with
 * `headless: true` (SDD-005 "Tests"): no container, no renderer, just the graph model — enough to assert
 * `cy.json()`/`cy.destroy()` calls without a browser.
 */
const headlessFactory: CytoscapeFactory = (options) => cytoscape({ ...options, headless: true });

describe('useCytoscape', () => {
  it('creates exactly one cy instance via the injected factory', () => {
    const factory = vi.fn(headlessFactory);
    const { result } = renderHook(() => useCytoscape({ container: null, elements: [], createCytoscape: factory }));

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.current.current).not.toBeNull();
  });

  it('calls cy.json() (not a second cy instance) when elements change', () => {
    const factory = vi.fn(headlessFactory);
    const { result, rerender } = renderHook(
      ({ elements }: { elements: cytoscape.ElementDefinition[] }) => useCytoscape({ container: null, elements, createCytoscape: factory }),
      { initialProps: { elements: [] as cytoscape.ElementDefinition[] } },
    );

    const cy = result.current.current;
    expect(cy).not.toBeNull();
    const jsonSpy = vi.spyOn(cy as cytoscape.Core, 'json');

    const nextElements: cytoscape.ElementDefinition[] = [{ group: 'nodes', data: { id: 'FR-001' } }];
    rerender({ elements: nextElements });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(jsonSpy).toHaveBeenCalledWith({ elements: nextElements });
    expect(result.current.current).toBe(cy);
  });

  it('preserves an existing node\'s live position across an elements refresh (never snaps it back to (0,0))', () => {
    const factory = vi.fn(headlessFactory);
    const initial: cytoscape.ElementDefinition[] = [{ group: 'nodes', data: { id: 'FR-001' } }];
    const { result, rerender } = renderHook(
      ({ elements }: { elements: cytoscape.ElementDefinition[] }) => useCytoscape({ container: null, elements, createCytoscape: factory }),
      { initialProps: { elements: initial } },
    );

    const cy = result.current.current as cytoscape.Core;
    const node = cy.getElementById('FR-001');
    node.position({ x: 123, y: 456 });

    // A refresh's plain ElementDefinition carries no position of its own (drift badging, a re-fetched full
    // graph, …) — the hook must still keep whatever position the node already has on screen.
    const refreshed: cytoscape.ElementDefinition[] = [{ group: 'nodes', data: { id: 'FR-001', drift: true } }];
    rerender({ elements: refreshed });

    expect(cy.getElementById('FR-001').position()).toEqual({ x: 123, y: 456 });
  });

  it('does not call cy.json() on a re-render with the same elements array', () => {
    const factory = vi.fn(headlessFactory);
    const elements: cytoscape.ElementDefinition[] = [];
    const { result, rerender } = renderHook(() => useCytoscape({ container: null, elements, createCytoscape: factory }));

    const jsonSpy = vi.spyOn(result.current.current as cytoscape.Core, 'json');
    rerender();

    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('calls cy.destroy() on unmount', () => {
    const factory = vi.fn(headlessFactory);
    const { result, unmount } = renderHook(() => useCytoscape({ container: null, elements: [], createCytoscape: factory }));

    const destroySpy = vi.spyOn(result.current.current as cytoscape.Core, 'destroy');
    unmount();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
