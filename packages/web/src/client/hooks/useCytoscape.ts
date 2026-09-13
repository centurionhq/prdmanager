import { useEffect, useRef, type RefObject } from 'react';
import type { Core, CytoscapeOptions, ElementDefinition, LayoutOptions, StylesheetJson } from 'cytoscape';

/** Injected so tests can pass `(opts) => cytoscape({ ...opts, headless: true })` (SDD-005 "Tests"): jsdom has no
 * `<canvas>`, and Cytoscape's default renderer needs one, so the real default export is never called under jsdom. */
export type CytoscapeFactory = (options: CytoscapeOptions) => Core;

/** `cose` (force-directed, built into Cytoscape core, no extra dependency): the doc-as-code graph has hundreds of
 * leaf `CodeRef`/`Commit` nodes fanning out unevenly, which `breadthfirst` (built for a clean level-by-level tree)
 * squashes into overlapping horizontal bands at real-repo scale — verified against this repo's own ~860-element
 * full graph. `cose`'s physical simulation spreads dense, irregular fan-out far more legibly. `nodeRepulsion` and
 * `idealEdgeLength` are cose's own defaults (400000 / 32) with only the edge length bumped up, verified
 * empirically against this same ~860-element graph: an under-tuned repulsion (anything far below the library
 * default) collapses the whole graph into one dense clump instead of spreading it. */
const DEFAULT_LAYOUT: LayoutOptions = { name: 'cose', animate: false, nodeRepulsion: () => 400_000, idealEdgeLength: () => 60 };

export interface UseCytoscapeOptions {
  /** `null` while the canvas element hasn't mounted yet; headless tests never provide one. */
  container: HTMLElement | null;
  elements: ElementDefinition[];
  /** Falls back to an empty stylesheet until `graph-stylesheet.ts` lands in a later phase. */
  stylesheet?: StylesheetJson;
  createCytoscape: CytoscapeFactory;
  /** @default cose (see DEFAULT_LAYOUT) */
  layout?: LayoutOptions;
}

/**
 * `hooks/useCytoscape` (SDD-005 "Frontend"): creates the `cy` instance exactly once, on mount, with whatever
 * `elements` were passed in on that first render. Every later `elements` change calls `cy.json({elements})`
 * instead of recreating the instance, which is what preserves the user's pan/zoom across a data refresh
 * (SDD-005 "GraphCanvas ... botón Actualizar preservando pan y zoom"). `cy.destroy()` runs on unmount.
 */
export function useCytoscape({ container, elements, stylesheet, createCytoscape, layout }: UseCytoscapeOptions): RefObject<Core | null> {
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
      layout: layout ?? DEFAULT_LAYOUT,
    });
    cy.fit(undefined, 30);
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
    const cy = cyRef.current;
    if (!cy) return;
    // `cy.json({elements})` fully replaces the element set; a plain `ElementDefinition` carries no `position`,
    // so re-adding an already-laid-out node without one snaps it back to Cytoscape's default (0,0) — collapsing
    // the whole graph into one point the moment `elements` changes for any reason (e.g. `drift` resolving a beat
    // after `graph`), not just on an explicit "Actualizar" (verified empirically against this repo's own full
    // graph). Carrying forward each existing node's live position is what actually makes the refresh preserve
    // layout, not merely pan/zoom.
    const withPositions = elements.map((el) => {
      if (el.group !== 'nodes' || el.data.id === undefined) return el;
      const existing = cy.getElementById(el.data.id);
      return existing.nonempty() ? { ...el, position: existing.position() } : el;
    });
    cy.json({ elements: withPositions });
  }, [elements]);

  return cyRef;
}
