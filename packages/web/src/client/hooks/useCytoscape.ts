import { useEffect, useRef, type RefObject } from 'react';
import type { Core, CytoscapeOptions, ElementDefinition, StylesheetJson } from 'cytoscape';

/** Injected so tests can pass `(opts) => cytoscape({ ...opts, headless: true })` (SDD-005 "Tests"): jsdom has no
 * `<canvas>`, and Cytoscape's default renderer needs one, so the real default export is never called under jsdom. */
export type CytoscapeFactory = (options: CytoscapeOptions) => Core;

export interface UseCytoscapeOptions {
  /** `null` while the canvas element hasn't mounted yet; headless tests never provide one. */
  container: HTMLElement | null;
  elements: ElementDefinition[];
  /** Falls back to an empty stylesheet until `graph-stylesheet.ts` lands in a later phase. */
  stylesheet?: StylesheetJson;
  createCytoscape: CytoscapeFactory;
}

/**
 * `hooks/useCytoscape` (SDD-005 "Frontend"): creates the `cy` instance exactly once, on mount, with whatever
 * `elements` were passed in on that first render. Every later `elements` change calls `cy.json({elements})`
 * instead of recreating the instance, which is what preserves the user's pan/zoom across a data refresh
 * (SDD-005 "GraphCanvas ... botón Actualizar preservando pan y zoom"). `cy.destroy()` runs on unmount.
 */
export function useCytoscape({ container, elements, stylesheet, createCytoscape }: UseCytoscapeOptions): RefObject<Core | null> {
  const cyRef = useRef<Core | null>(null);
  // Captured once: React only honors a `useRef` initializer on the first render, which is exactly the "as of
  // mount" snapshot the creation effect below needs without listing `elements` in its own dependency array.
  const initialElementsRef = useRef(elements);
  const hasMountedElementsEffect = useRef(false);

  useEffect(() => {
    const cy = createCytoscape({
      container,
      elements: initialElementsRef.current,
      style: stylesheet ?? [],
      layout: { name: 'breadthfirst' },
    });
    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // Runs once: `container`/`createCytoscape` are expected to be stable for the component's lifetime, and
    // `elements` is intentionally excluded — see `initialElementsRef` above and the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasMountedElementsEffect.current) {
      // Skips the run that pairs with the creation effect above: `cy` was just built with these same elements.
      hasMountedElementsEffect.current = true;
      return;
    }
    cyRef.current?.json({ elements });
  }, [elements]);

  return cyRef;
}
