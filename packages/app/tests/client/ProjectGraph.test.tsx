import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as prdmUi from '@prdm/ui';
import * as client from '../../src/api/client.js';
import { OrgShell } from '../../src/routes/OrgShell.js';
import { ProjectGraph } from '../../src/routes/ProjectGraph.js';

// `GraphCanvas` needs a real `<canvas>` (jsdom has none), same as packages/web's own App.test.tsx.
vi.mock('@prdm/ui', async () => {
  const actual = await vi.importActual<typeof prdmUi>('@prdm/ui');
  return { ...actual, GraphCanvas: () => <div data-testid="graph-canvas-stub" /> };
});

const EMPTY_REPORT = { documents: 1, errors: [], issues: [], governed: [], workOrderUpdates: [], baselineWritten: false, hasBlockingIssues: false };

function renderPage(projectRole?: 'admin' | 'editor' | 'viewer') {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'member' }]);
  vi.spyOn(client, 'listProjects').mockResolvedValue([]);
  vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });
  vi.spyOn(client, 'listProjectMembers').mockResolvedValue(projectRole ? [{ userId: 'u1', email: 'me@example.test', name: 'Me', role: projectRole }] : []);
  vi.spyOn(client, 'getFullGraph').mockResolvedValue({ nodes: [], edges: [] });
  vi.spyOn(client, 'getTree').mockResolvedValue({ forest: [] });
  vi.spyOn(client, 'getDrift').mockResolvedValue(EMPTY_REPORT);
  vi.spyOn(client, 'listWorkOrders').mockResolvedValue([]);

  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/graph', element: <ProjectGraph /> }] }],
    { initialEntries: ['/o/acme/p/web/graph'] },
  );
  render(<RouterProvider router={router} />);
}

describe('ProjectGraph', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the drift banner, graph canvas stub and work order list; hides "Reconocer" for a viewer', async () => {
    renderPage('viewer');

    expect(await screen.findByTestId('graph-canvas-stub')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sistema sincronizado'));
    expect(screen.queryByRole('button', { name: 'Reconocer' })).toBeNull();
  });

  it('an admin can acknowledge drift', async () => {
    renderPage('admin');
    await screen.findByTestId('graph-canvas-stub');

    const acknowledge = vi.spyOn(client, 'acknowledgeDrift').mockResolvedValue({ report: EMPTY_REPORT });

    await userEvent.clear(screen.getByLabelText('Reconocer'));
    await userEvent.type(screen.getByLabelText('Reconocer'), 'WO-001');
    await userEvent.click(screen.getByRole('button', { name: 'Reconocer' }));

    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('acme', 'web', 'WO-001'));
  });

  it('shows an error state when the drift endpoint fails, without breaking the rest of the shell', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'member' }]);
    vi.spyOn(client, 'listProjects').mockResolvedValue([]);
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Me' } });
    vi.spyOn(client, 'listProjectMembers').mockResolvedValue([{ userId: 'u1', email: 'me@example.test', name: 'Me', role: 'viewer' }]);
    vi.spyOn(client, 'getFullGraph').mockResolvedValue({ nodes: [], edges: [] });
    vi.spyOn(client, 'getTree').mockResolvedValue({ forest: [] });
    vi.spyOn(client, 'getDrift').mockRejectedValue(new Error('drift endpoint down'));
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue([]);

    const router = createMemoryRouter(
      [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'p/:projectSlug/graph', element: <ProjectGraph /> }] }],
      { initialEntries: ['/o/acme/p/web/graph'] },
    );
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((text) => text?.includes('drift endpoint down'))).toBe(true);
    });
    expect(screen.getByTestId('graph-canvas-stub')).toBeTruthy();
  });
});
