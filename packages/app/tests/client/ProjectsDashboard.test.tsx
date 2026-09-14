import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { OrgShell } from '../../src/routes/OrgShell.js';
import { ProjectsDashboard } from '../../src/routes/ProjectsDashboard.js';

const PROJECT = {
  id: 'proj1',
  slug: 'web',
  name: 'Web',
  graphProjectId: 'prj_abc',
  settings: {} as never,
  archivedAt: null,
};

function renderDashboard(role: 'owner' | 'admin' | 'member') {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role }]);
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug',
        element: <OrgShell />,
        children: [{ index: true, element: <ProjectsDashboard /> }],
      },
    ],
    { initialEntries: ['/o/acme'] },
  );
  render(<RouterProvider router={router} />);
}

describe('ProjectsDashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the project grid once loaded', async () => {
    vi.spyOn(client, 'listProjects').mockResolvedValue([PROJECT]);
    renderDashboard('member');

    expect(await screen.findByText('Web')).toBeTruthy();
    expect(screen.getByText('web')).toBeTruthy();
  });

  it('shows an empty-state message with no projects', async () => {
    vi.spyOn(client, 'listProjects').mockResolvedValue([]);
    renderDashboard('member');

    expect(await screen.findByText(/todavía no hay proyectos/i)).toBeTruthy();
  });

  it('shows "Nuevo proyecto" only for an org owner/admin, never a plain member', async () => {
    vi.spyOn(client, 'listProjects').mockResolvedValue([]);
    renderDashboard('member');

    await screen.findByText(/todavía no hay proyectos/i);
    expect(screen.queryByRole('button', { name: 'Nuevo proyecto' })).toBeNull();
  });

  it('an admin can create a project through the form, with slug validation', async () => {
    vi.spyOn(client, 'listProjects').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createProject').mockResolvedValue({ ...PROJECT, slug: 'new-proj', name: 'New Proj' });
    renderDashboard('admin');

    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo proyecto' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'New Proj');
    await userEvent.type(screen.getByLabelText('Slug'), 'Not Valid Slug!');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText(/Minúsculas, números y guiones/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Slug'));
    await userEvent.type(screen.getByLabelText('Slug'), 'new-proj');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('acme', { slug: 'new-proj', name: 'New Proj' }));
    expect(await screen.findByText('New Proj')).toBeTruthy();
  });
});
