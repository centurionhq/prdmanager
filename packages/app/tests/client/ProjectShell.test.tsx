import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { ProjectShell } from '../../src/routes/ProjectShell.js';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

function renderShell(initialPath = '/o/acme/p/web') {
  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug/p/:projectSlug', element: <ProjectShell />, children: [{ index: true, element: <p>planta</p> }] }],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
}

describe('ProjectShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the sidebar and nested route once org/project data loads', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });

    renderShell();

    expect(await screen.findByText('planta')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Ana Ríos')).toBeTruthy();
  });

  it('shows a drift andon badge on the Drift nav item when driftErrors > 0', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ driftErrors: 3 })]);
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'me@example.test', name: 'Ana Ríos' } });

    renderShell();

    await screen.findByText('planta');
    expect(screen.getByText('3 errores de drift')).toBeTruthy();
  });

  it('shows "Organización no encontrada" for a slug the caller does not belong to', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue(null);

    renderShell('/o/nope/p/web');

    expect(await screen.findByText('Organización no encontrada')).toBeTruthy();
  });

  it('shows "Proyecto no encontrado" for a slug not in the org\'s overview', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue(null);

    renderShell('/o/acme/p/nope');

    expect(await screen.findByText('Proyecto no encontrado')).toBeTruthy();
  });

  it('shows the API error message on failure', async () => {
    vi.spyOn(client, 'listOrganizations').mockRejectedValue(new Error('boom'));

    renderShell();

    expect(await screen.findByText('Ocurrió un error inesperado. Probá de nuevo.')).toBeTruthy();
  });
});
