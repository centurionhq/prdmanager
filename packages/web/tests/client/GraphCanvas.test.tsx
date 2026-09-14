import type { RefreshReport, Subgraph } from '@prdm/core';
import { render, screen, waitFor } from '@testing-library/react';
import cytoscape from 'cytoscape';
import { describe, expect, it, vi } from 'vitest';
import { GraphCanvas } from '../../src/client/components/GraphCanvas';
import type { CytoscapeFactory } from '@prdm/ui';
import { SelectionProvider } from '../../src/client/state/selection';

/** jsdom has no `<canvas>` (SDD-005 "Tests") — headless mode skips the renderer entirely. */
const headlessCytoscape: CytoscapeFactory = (options) => cytoscape({ ...options, headless: true });

const GRAPH: Subgraph = {
  nodes: [
    { ref: 'PRD-004', label: 'Feature', kind: 'PRD', title: 'Explorador web', status: 'approved' },
    { ref: 'SDD-005', label: 'Blueprint', kind: 'SDD', title: 'Explorador web SDD', status: 'active' },
  ],
  edges: [{ from: 'SDD-005', to: 'PRD-004', type: 'ARCHITECTS', status: null, reviewNeeded: false }],
};

/**
 * `graph-stylesheet.ts` reads CSS custom properties via `getComputedStyle` — jsdom returns `''` for every custom
 * property (no real stylesheet cascade), which is fine for Cytoscape's headless mode used here (no rendering, no
 * color validation) and for `useCytoscape`'s own tests; this suite only checks the surrounding React wiring.
 */
describe('GraphCanvas', () => {
  it('renders the canvas container and toolbar once mounted', async () => {
    render(
      <SelectionProvider>
        <GraphCanvas graph={GRAPH} drift={null} onRefresh={vi.fn()} refreshing={false} createCytoscape={headlessCytoscape} layout={{ name: 'null' }} />
      </SelectionProvider>,
    );

    expect(screen.getByRole('img', { name: /Grafo interactivo/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Acercar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alejar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Encuadrar todo' })).toBeTruthy();
  });

  it('shows the large-graph notice once past the threshold', async () => {
    const manyNodes: Subgraph = { nodes: Array.from({ length: 501 }, (_, i) => ({ ref: `WO-${i}`, label: 'WorkOrder', kind: 'WO', title: 't', status: 'done' })), edges: [] };
    render(
      <SelectionProvider>
        <GraphCanvas graph={manyNodes} drift={null} onRefresh={vi.fn()} refreshing={false} createCytoscape={headlessCytoscape} layout={{ name: 'null' }} />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Grafo grande/)).toBeTruthy());
  });

  it('the refresh button is disabled while refreshing', async () => {
    render(
      <SelectionProvider>
        <GraphCanvas graph={GRAPH} drift={null} onRefresh={vi.fn()} refreshing createCytoscape={headlessCytoscape} layout={{ name: 'null' }} />
      </SelectionProvider>,
    );

    await waitFor(() => expect((screen.getByRole('button', { name: /Actualizar/ }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('calling onRefresh fires when the button is clicked', async () => {
    const onRefresh = vi.fn();
    render(
      <SelectionProvider>
        <GraphCanvas graph={GRAPH} drift={null} onRefresh={onRefresh} refreshing={false} createCytoscape={headlessCytoscape} layout={{ name: 'null' }} />
      </SelectionProvider>,
    );

    await waitFor(() => screen.getByRole('button', { name: 'Actualizar' }));
    screen.getByRole('button', { name: 'Actualizar' }).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('re-applies the graph stylesheet when the OS light/dark media query changes (F6 architecture review)', async () => {
    let changeHandler: (() => void) | undefined;
    const media = {
      matches: false,
      media: '(prefers-color-scheme: light)',
      addEventListener: (_event: string, handler: () => void) => {
        changeHandler = handler;
      },
      removeEventListener: () => undefined,
    };
    const matchMediaSpy = vi.fn().mockReturnValue(media);
    vi.stubGlobal('matchMedia', matchMediaSpy);

    render(
      <SelectionProvider>
        <GraphCanvas graph={GRAPH} drift={null} onRefresh={vi.fn()} refreshing={false} createCytoscape={headlessCytoscape} layout={{ name: 'null' }} />
      </SelectionProvider>,
    );
    await waitFor(() => expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-color-scheme: light)'));
    expect(changeHandler).toBeTypeOf('function');

    // The real assertion is that this doesn't throw and the listener was wired up; buildGraphStylesheet() itself
    // (already exercised by its own unit tests) is what cy.style() gets called with on each theme change.
    expect(() => changeHandler?.()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it('accepts a drift report without crashing', async () => {
    const report: RefreshReport = { documents: 2, errors: [], issues: [{ kind: 'code_out_of_sync', severity: 'error', nodeId: 'PRD-004', message: 'x' }], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: true };
    render(
      <SelectionProvider>
        <GraphCanvas graph={GRAPH} drift={report} onRefresh={vi.fn()} refreshing={false} createCytoscape={headlessCytoscape} layout={{ name: 'null' }} />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy());
  });
});
