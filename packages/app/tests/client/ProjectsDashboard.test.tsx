import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectOverviewDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { OrgShell } from '../../src/routes/OrgShell.js';
import { ProjectsDashboard } from '../../src/routes/ProjectsDashboard.js';

function makeProject(overrides: Partial<ProjectOverviewDto> = {}): ProjectOverviewDto {
  return {
    id: 'proj1',
    slug: 'web',
    name: 'Web',
    graphProjectId: 'prj_abc',
    settings: {} as never,
    archivedAt: null,
    docCount: 12,
    furthestStation: 'diseno_tecnico',
    andonStation: null,
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: false,
    workOrdersInProgress: 2,
    myRole: 'admin',
    lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

function renderDashboard(role: 'owner' | 'admin' | 'member' = 'member') {
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
    clearQueryCache();
  });

  it('renders each project with its line status, drift, orders, role and activity', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({ driftErrors: 2 }),
      makeProject({ id: 'proj2', slug: 'ystream', name: 'Ystream', driftWarnings: 1, workOrdersInProgress: 0, myRole: 'viewer' }),
    ]);
    renderDashboard('member');

    expect(await screen.findByText('Web')).toBeTruthy();
    expect(screen.getByText('Ystream')).toBeTruthy();
    expect(screen.getByText('2 errores')).toBeTruthy();
    expect(screen.getByText('1 aviso')).toBeTruthy();
    expect(screen.getByText('Viewer')).toBeTruthy();
  });

  it('shows "Esperando primer reporte de CI" instead of a fabricated drift number', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ awaitingFirstReport: true })]);
    renderDashboard('member');

    expect(await screen.findByText('Esperando primer reporte de CI')).toBeTruthy();
  });

  it('shows an empty-state message with no projects', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([]);
    renderDashboard('member');

    expect(await screen.findByText(/todavía no hay proyectos/i)).toBeTruthy();
  });

  it('shows an error state and retries', async () => {
    const spy = vi
      .spyOn(client, 'getProjectsOverview')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce([makeProject()]);
    renderDashboard('member');

    expect(await screen.findByText(/no pudimos cargar los proyectos/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Web')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('filters archived projects out of "Activos" and into "Archivados"', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({ name: 'Activo' }),
      makeProject({ id: 'proj2', slug: 'viejo', name: 'Viejo', archivedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    renderDashboard('member');

    await screen.findByText('Activo');
    expect(screen.queryByText('Viejo')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /Archivados/ }));
    expect(await screen.findByText('Viejo')).toBeTruthy();
    expect(screen.queryByText('Activo')).toBeNull();
  });

  it('filters by the search field', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ name: 'Web' }), makeProject({ id: 'proj2', slug: 'ystream', name: 'Ystream' })]);
    renderDashboard('member');

    await screen.findByText('Web');
    await userEvent.type(screen.getByRole('searchbox', { name: /buscar proyectos/i }), 'ystream');

    expect(await screen.findByText('Ystream')).toBeTruthy();
    expect(screen.queryByText('Web')).toBeNull();
  });

  it('shows "Nuevo proyecto" only for an org owner/admin, never a plain member', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([]);
    renderDashboard('member');

    await screen.findByText(/todavía no hay proyectos/i);
    expect(screen.queryByRole('button', { name: 'Nuevo proyecto' })).toBeNull();
  });

  it('an admin can create a project through the modal, with slug validation', async () => {
    vi.spyOn(client, 'getProjectsOverview')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeProject({ id: 'proj-new', slug: 'new-proj', name: 'New Proj' })]);
    const create = vi.spyOn(client, 'createProject').mockResolvedValue({
      id: 'proj-new',
      slug: 'new-proj',
      name: 'New Proj',
      graphProjectId: 'prj_new',
      settings: {} as never,
      archivedAt: null,
    });
    renderDashboard('admin');

    await screen.findByText(/todavía no hay proyectos/i);
    await userEvent.click(screen.getAllByRole('button', { name: 'Nuevo proyecto' })[0]!);

    const dialog = screen.getByRole('dialog', { name: 'Nuevo proyecto' });
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'New Proj');
    await userEvent.clear(within(dialog).getByLabelText('Slug'));
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'Not Valid!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear proyecto' }));

    expect(await screen.findByText(/Minúsculas, números y guiones/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();

    await userEvent.clear(within(dialog).getByLabelText('Slug'));
    await userEvent.type(within(dialog).getByLabelText('Slug'), 'new-proj');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear proyecto' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('acme', { slug: 'new-proj', name: 'New Proj' }));
    expect(await screen.findByText('New Proj')).toBeTruthy();
  });

  it('exposes seven distinct segment names and marks the stopped station', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ furthestStation: 'construccion', andonStation: 'diseno_tecnico' })]);
    renderDashboard('member');

    await screen.findByText('Web');
    const labels = screen.getAllByRole('img').map((node) => node.getAttribute('aria-label'));
    expect(labels).toHaveLength(7);
    expect(new Set(labels).size).toBe(7);
    expect(labels).toContain('Detenida en Diseño técnico');
    expect(labels).toContain('Entregado · pendiente');
    expect(labels).toContain('Entrada · alcanzada');
    expect(labels.filter((label) => label?.startsWith('Detenida en'))).toHaveLength(1);
    expect(screen.getByText('Llega a Construcción, detenida en Diseño técnico')).toBeTruthy();
  });

  it('shows the archive action only with the archive permission', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject(),
      makeProject({ id: 'proj2', slug: 'ystream', name: 'Ystream', myRole: 'viewer' }),
    ]);
    renderDashboard('member');

    await screen.findByText('Web');
    expect(screen.getAllByRole('button', { name: 'Archivar' })).toHaveLength(1);
    const viewerRow = screen.getByText('Ystream').closest('tr')!;
    expect(within(viewerRow).queryByRole('button')).toBeNull();
  });

  it('hides the archive action when no row grants it', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ myRole: 'viewer' })]);
    renderDashboard('member');

    await screen.findByText('Web');
    expect(screen.queryByRole('button', { name: 'Archivar' })).toBeNull();
  });

  it('confirming archive calls the API and refreshes the list', async () => {
    const overview = vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    const archive = vi.spyOn(client, 'archiveProject').mockResolvedValue({} as never);
    renderDashboard('member');

    await userEvent.click(await screen.findByRole('button', { name: 'Archivar' }));
    const dialog = screen.getByRole('dialog', { name: 'Archivar Web' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archivar' }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith('acme', 'web'));
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Web quedó archivado')).toBeTruthy();
  });

  it('keeps the dialog open with an alert when archiving fails', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    vi.spyOn(client, 'archiveProject').mockRejectedValue(new Error('boom'));
    renderDashboard('member');

    await userEvent.click(await screen.findByRole('button', { name: 'Archivar' }));
    const dialog = screen.getByRole('dialog', { name: 'Archivar Web' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archivar' }));

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Archivar Web' })).toBeTruthy();
  });

  it('cancelling the archive dialog does not call the API', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    const archive = vi.spyOn(client, 'archiveProject').mockResolvedValue({} as never);
    renderDashboard('member');

    await userEvent.click(await screen.findByRole('button', { name: 'Archivar' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Archivar Web' })).getByRole('button', { name: 'Cancelar' }));

    expect(archive).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('unarchives without asking for confirmation', async () => {
    const overview = vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ archivedAt: '2026-01-01T00:00:00.000Z' })]);
    const unarchive = vi.spyOn(client, 'unarchiveProject').mockResolvedValue({} as never);
    renderDashboard('member');

    await userEvent.click(await screen.findByRole('radio', { name: /Archivados/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Desarchivar' }));

    await waitFor(() => expect(unarchive).toHaveBeenCalledWith('acme', 'web'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(2));
  });

  it('shows who has access, linking to the members settings', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({ memberCount: 0 }),
      makeProject({ id: 'proj2', slug: 'ystream', name: 'Ystream', memberCount: 3 }),
    ]);
    renderDashboard('member');

    const empty = await screen.findByRole('link', { name: 'Sin miembros · nadie del equipo lo ve' });
    expect(empty.getAttribute('href')).toBe('/o/acme/p/web/ajustes/miembros');
    expect(screen.getByRole('link', { name: '3 miembros' }).getAttribute('href')).toBe('/o/acme/p/ystream/ajustes/miembros');
  });

  it('links drift and orders to their screens', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ driftErrors: 2, driftWarnings: 1, workOrdersInProgress: 7 })]);
    renderDashboard('member');

    const drift = await screen.findByRole('link', { name: /2 errores/ });
    expect(drift.getAttribute('href')).toBe('/o/acme/p/web/drift');
    expect(drift.textContent).toContain('2 errores · 1 aviso');
    expect(screen.getByRole('link', { name: '7' }).getAttribute('href')).toBe('/o/acme/p/web/ordenes');
  });

  it('explains the line, drift, orders and access in a visible legend', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    renderDashboard('member');

    await screen.findByText('Web');
    const legend = screen.getByRole('region', { name: 'Cómo leer la tabla' });
    expect(within(legend).getAllByRole('listitem').length).toBeGreaterThanOrEqual(11);
    expect(within(legend).getByText(/detectadas por CI/)).toBeTruthy();
  });
});
