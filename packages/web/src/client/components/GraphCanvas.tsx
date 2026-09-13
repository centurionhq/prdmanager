import defaultCytoscape from 'cytoscape';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { EventObject, LayoutOptions } from 'cytoscape';
import type { RefreshReport, Subgraph } from '@prdm/core';
import { useCytoscape, type CytoscapeFactory } from '../hooks/useCytoscape';
import { applyDrift } from '../graph/apply-drift';
import { toElements } from '../graph/to-elements';
import { useSelection } from '../state/selection';
import { buildGraphStylesheet } from '../styles/graph-stylesheet';
import styles from './GraphCanvas.module.css';

/** Above this, the force/breadthfirst layout gets visually dense enough to warrant navigating by branch instead (SDD-005 "Frontend"). */
const LARGE_GRAPH_THRESHOLD = 500;

export interface GraphCanvasProps {
  graph: Subgraph;
  drift: RefreshReport | null;
  onRefresh: () => void;
  refreshing: boolean;
  /** @default the real cytoscape() export. Overridden in tests with a headless factory — jsdom has no `<canvas>` (same reason as `useCytoscape`'s own tests). */
  createCytoscape?: CytoscapeFactory;
  /** @default useCytoscape's own cose default. Overridden in tests: cose measures the container's pixel size for its bounding box, which a headless test has none of. */
  layout?: LayoutOptions;
}

interface GraphCanvasBodyProps extends GraphCanvasProps {
  container: HTMLElement;
}

/**
 * Only ever mounted once a real DOM node exists for `container` (see `GraphCanvas` below) — `useCytoscape`
 * creates `cy` on its very first render, so this component's first render must already have it.
 */
function GraphCanvasBody({ container, graph, drift, onRefresh, refreshing, createCytoscape = defaultCytoscape, layout }: GraphCanvasBodyProps): ReactElement {
  const { selectedId, select } = useSelection();
  const stylesheet = useMemo(() => buildGraphStylesheet(), []);

  const elements = useMemo(() => {
    const base = toElements(graph);
    return drift ? applyDrift(base, drift) : base;
  }, [graph, drift]);

  const cyRef = useCytoscape({ container, elements, stylesheet, createCytoscape, layout });

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const handleTap = (event: EventObject): void => {
      const id = event.target.id?.();
      if (typeof id === 'string') select(id);
    };
    cy.on('tap', 'node', handleTap);
    return () => {
      cy.off('tap', 'node', handleTap);
    };
  }, [cyRef, select]);

  // Mirrors the shared selection into cy's own `:selected` state without feeding back into React (the effect
  // above already owns the tap -> select() direction) — search results and the tree both drive this the same way.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements(':selected').unselect();
    if (selectedId) cy.getElementById(selectedId).select();
  }, [cyRef, selectedId, elements]);

  // `buildGraphStylesheet()` reads resolved CSS custom-property values via getComputedStyle at call time — every
  // *other* element in the app re-themes for free through tokens.css's own `@media (prefers-color-scheme)` block,
  // but the canvas's colors were baked into Cytoscape's stylesheet once at mount and never touched again, so an
  // OS-level light/dark switch left it silently stuck on whichever theme was active on first paint (F6
  // architecture review). Re-applying the stylesheet on the same media query tokens.css itself keys off keeps
  // the two in sync.
  useEffect(() => {
    const cy = cyRef.current;
    // jsdom (this repo's test environment) doesn't implement matchMedia at all, unlike every real browser.
    if (!cy || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const applyCurrentTheme = (): void => void cy.style(buildGraphStylesheet());
    media.addEventListener('change', applyCurrentTheme);
    return () => media.removeEventListener('change', applyCurrentTheme);
  }, [cyRef]);

  return (
    <>
      <button type="button" className={styles.refreshButton} onClick={onRefresh} disabled={refreshing}>
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className={refreshing ? styles.spin : undefined}>
          <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Actualizar
      </button>
      <div className={styles.tools} aria-label="Controles del canvas">
        <button type="button" className={styles.toolButton} aria-label="Acercar" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)}>
          +
        </button>
        <button type="button" className={styles.toolButton} aria-label="Alejar" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)}>
          −
        </button>
        <button type="button" className={styles.toolButton} aria-label="Encuadrar todo" onClick={() => cyRef.current?.fit(undefined, 30)}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      {elements.length > LARGE_GRAPH_THRESHOLD && (
        <p className={styles.notice}>Grafo grande ({elements.length} elementos) — navegar por rama desde el árbol puede ser más claro.</p>
      )}
    </>
  );
}

/**
 * `components/GraphCanvas.tsx` (SDD-005 "Frontend"): the interactive Cytoscape view. The mount container is
 * discovered via a callback ref into state — `GraphCanvasBody` (and the `useCytoscape` call inside it) is only
 * ever mounted once that state holds a real element, since `useCytoscape` creates `cy` on its very first render
 * and has no way to react to the container arriving later.
 */
export function GraphCanvas(props: GraphCanvasProps): ReactElement {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <div className={styles.wrap}>
      <div
        ref={setContainer}
        className={styles.canvas}
        role="img"
        aria-label="Grafo interactivo del Feature Tree (ver el árbol de la izquierda para una vista accesible por teclado)"
      />
      {container && <GraphCanvasBody {...props} container={container} />}
    </div>
  );
}
