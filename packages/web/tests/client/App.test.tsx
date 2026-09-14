import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as prdmUi from '@prdm/ui';
import { App } from '../../src/client/App';
import * as apiClient from '../../src/client/api/client';

// `GraphCanvas` needs a real `<canvas>` (jsdom has none — same reason `useCytoscape`'s and `GraphCanvas`'s own
// tests inject a headless factory); a smoke test of `App`'s data wiring doesn't need the real canvas, so it's
// stubbed to a plain marker instead of threading `createCytoscape`/`layout` overrides all the way through App.
vi.mock('@prdm/ui', async () => {
  const actual = await vi.importActual<typeof prdmUi>('@prdm/ui');
  return {
    ...actual,
    GraphCanvas: () => <div data-testid="graph-canvas-stub" />,
  };
});

vi.mock('../../src/client/api/client', async () => {
  const actual = await vi.importActual<typeof apiClient>('../../src/client/api/client');
  return {
    ...actual,
    getProject: vi.fn(),
    getFullGraph: vi.fn(),
    getTree: vi.fn(),
    getDrift: vi.fn(),
    // WorkOrderList fetches independently of the rest of the shell; a real (unmocked) call would try an actual
    // fetch() against '/api/work-orders' in jsdom and fail with an unrelated error, muddying these assertions.
    listWorkOrders: vi.fn(),
  };
});

const mocked = vi.mocked(apiClient);

const PROJECT = { id: 'prj_test', name: 'demo', folders: {}, lifecycle: {}, counts: { PRD: 2, WO: 5 } } as apiClient.WebProjectSummary;
const EMPTY_REPORT = { documents: 1, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false };

describe('App', () => {
  it('loads project, tree and drift, then renders the shell with real data', async () => {
    mocked.getProject.mockResolvedValue(PROJECT);
    mocked.getFullGraph.mockResolvedValue({ nodes: [], edges: [] });
    mocked.getTree.mockResolvedValue({
      forest: [{ ref: 'PRD-004', label: 'Feature', kind: 'PRD', title: 'Explorador web', status: 'approved', via: null, edgeStatus: null, reviewNeeded: false, repeated: false, children: [] }],
    });
    mocked.getDrift.mockResolvedValue(EMPTY_REPORT);
    mocked.listWorkOrders.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(screen.getByText('prj_test')).toBeTruthy());
    expect(screen.getByText('PRD 2')).toBeTruthy();
    expect(screen.getByText('WO 5')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('treeitem', { name: /PRD-004/ })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sistema sincronizado'));
    expect(screen.getByTestId('graph-canvas-stub')).toBeTruthy();
  });

  it('shows an error state for the drift banner when /api/drift fails, without breaking the rest of the shell', async () => {
    mocked.getProject.mockResolvedValue(PROJECT);
    mocked.getFullGraph.mockResolvedValue({ nodes: [], edges: [] });
    mocked.getTree.mockResolvedValue({ forest: [] });
    mocked.getDrift.mockRejectedValue(new Error('drift endpoint down'));
    mocked.listWorkOrders.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((text) => text?.includes('drift endpoint down'))).toBe(true);
    });
    expect(screen.getByTestId('graph-canvas-stub')).toBeTruthy();
  });

  it('surfaces a /api/project failure in the topbar instead of silently showing nothing', async () => {
    mocked.getProject.mockRejectedValue(new Error('project endpoint down'));
    mocked.getFullGraph.mockResolvedValue({ nodes: [], edges: [] });
    mocked.getTree.mockResolvedValue({ forest: [] });
    mocked.getDrift.mockResolvedValue(EMPTY_REPORT);
    mocked.listWorkOrders.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((text) => text?.includes('project endpoint down'))).toBe(true);
    });
  });
});
