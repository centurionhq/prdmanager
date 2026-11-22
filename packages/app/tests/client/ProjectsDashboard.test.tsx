import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectOverviewDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { OrgShell } from '../../src/routes/OrgShell.js';
import { ProjectsDashboard, lineLabel, readLegendOpenPreference, writeLegendOpenPreference } from '../../src/routes/ProjectsDashboard.js';

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
    andonFeature: null,
    driftErrors: 0,
    driftWarnings: 0,
    awaitingFirstReport: false,
    workOrdersInProgress: 2,
    myRole: 'admin',
    lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    lastReportAt: null,
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
    // The legend preference outlives a mount on purpose; each test starts from the default (collapsed).
    writeLegendOpenPreference(false);
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
    expect(screen.getByText('Lector')).toBeTruthy();
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
    expect(screen.getByText('Llegó a Producto, detenida en Diseño técnico')).toBeTruthy();
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

  it('reads a project nobody sees as an alarm with a marker and the invite action', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({ memberCount: 0 }),
      makeProject({ id: 'proj2', slug: 'ystream', name: 'Ystream', memberCount: 3 }),
    ]);
    renderDashboard('member');

    await screen.findByText('Web');
    // One `role="status"` per alarmed row and never `role="alert"`: the table can hold N rows, so the
    // alarm is not a live announcement (the view-level alert is reserved for real failures).
    const row = screen.getByText('Web').closest('tr')!;
    const alarm = within(row).getByRole('status');
    expect(alarm.textContent).toContain('Nadie del equipo lo ve');
    const action = within(row).getByRole('link', { name: /nadie del equipo ve Web.*Agregar miembros/i });
    expect(action.getAttribute('href')).toBe('/o/acme/p/web/ajustes/miembros');
    expect(within(row).queryByRole('alert')).toBeNull();

    const populated = screen.getByText('Ystream').closest('tr')!;
    expect(within(populated).queryByRole('status')).toBeNull();
    expect(within(populated).getByRole('link', { name: '3 miembros' }).getAttribute('href')).toBe('/o/acme/p/ystream/ajustes/miembros');
  });

  it('shows the alarm to a viewer but hides the invite action it cannot use', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ memberCount: 0, myRole: 'viewer' })]);
    renderDashboard('member');

    await screen.findByText('Web');
    const row = screen.getByText('Web').closest('tr')!;
    expect(within(row).getByRole('status').textContent).toContain('Nadie del equipo lo ve');
    expect(within(row).queryByText('Agregar miembros')).toBeNull();
    expect(within(row).getByRole('link', { name: /nadie del equipo ve Web/i }).getAttribute('href')).toBe('/o/acme/p/web/ajustes/miembros');
  });

  it('links a stopped line to its blocking initiative and names it, with the age of the evidence', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({
        furthestStation: 'entregado',
        andonStation: 'diseno_tecnico',
        andonFeature: { id: 'FR-001', title: 'Inventario de bodega' },
        lastReportAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      }),
    ]);
    renderDashboard('member');

    await screen.findByText('Web');
    const link = screen.getByRole('link', { name: /Inventario de bodega/ });
    expect(link.getAttribute('href')).toBe('/o/acme/p/web/drift?feature=FR-001');
    expect(link.textContent).toContain('Llegó a Producto, detenida en Diseño técnico');
    expect(link.textContent).toMatch(/Último reporte hace 8 d/);
    expect(link.textContent).toContain('Ver qué la frena');
  });

  it('leaves the line cell as plain text when nothing is stopped', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({ andonStation: null, furthestStation: 'construccion', lastReportAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
    ]);
    renderDashboard('member');

    const text = await screen.findByText('Llega a Construcción');
    expect(text.closest('a')).toBeNull();
    expect(screen.queryByText('Ver qué la frena')).toBeNull();
  });

  it('never prints two contradictory stages for the same line', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
      makeProject({
        furthestStation: 'entregado',
        andonStation: 'diseno_tecnico',
        andonFeature: { id: 'FR-001', title: 'Inventario de bodega' },
      }),
    ]);
    renderDashboard('member');

    await screen.findByText('Web');
    const cell = screen.getByText(/detenida en Diseño técnico/).closest('a')!;
    expect(cell.textContent).not.toContain('Llega a Entregado');
    expect(cell.textContent).not.toContain('Llegó a Entregado');
    expect(cell.textContent).toContain('Llegó a Producto');
  });

  it('keeps the legend collapsed until the reader opens it with the keyboard, and remembers it', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    renderDashboard('member');

    await screen.findByText('Web');
    const toggle = screen.getByRole('button', { name: 'Cómo leer la tabla' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/detectadas por CI/)).toBeNull();

    toggle.focus();
    await userEvent.keyboard('{Enter}');

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/detectadas por CI/)).toBeTruthy();
    expect(readLegendOpenPreference()).toBe(true);
  });

  it('starts the legend open when the reader already opened it once', async () => {
    writeLegendOpenPreference(true);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    renderDashboard('member');

    await screen.findByText('Web');
    const toggle = screen.getByRole('button', { name: 'Cómo leer la tabla' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/detectadas por CI/)).toBeTruthy();

    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(readLegendOpenPreference()).toBe(false);
  });

  it('links drift and orders to their screens', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject({ driftErrors: 2, driftWarnings: 1, workOrdersInProgress: 7 })]);
    renderDashboard('member');

    const drift = await screen.findByRole('link', { name: /2 errores/ });
    expect(drift.getAttribute('href')).toBe('/o/acme/p/web/drift');
    expect(drift.textContent).toContain('2 errores · 1 aviso');
    expect(screen.getByRole('link', { name: '7' }).getAttribute('href')).toBe('/o/acme/p/web/ordenes');
  });

  it('explains the line, drift, orders and access in a legend the reader must open', async () => {
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProject()]);
    renderDashboard('member');

    await screen.findByText('Web');
    await userEvent.click(screen.getByRole('button', { name: 'Cómo leer la tabla' }));
    const legend = screen.getByRole('region', { name: 'Cómo leer la tabla' });
    expect(within(legend).getAllByRole('listitem').length).toBeGreaterThanOrEqual(11);
    expect(within(legend).getByText(/detectadas por CI/)).toBeTruthy();
    expect(within(legend).getByText(/nadie del equipo ve/)).toBeTruthy();
  });

  describe('line status filter and severity sort', () => {
    const lineProjects = (): ProjectOverviewDto[] => [
      makeProject({ id: 'p1', slug: 'web', name: 'Web' }),
      makeProject({ id: 'p2', slug: 'ystream', name: 'Ystream', andonStation: 'construccion', furthestStation: 'entregado' }),
      makeProject({ id: 'p3', slug: 'driftoso', name: 'Driftoso', driftErrors: 1, furthestStation: 'producto' }),
      makeProject({ id: 'p4', slug: 'esperando', name: 'Esperando', awaitingFirstReport: true }),
      makeProject({ id: 'p5', slug: 'viejo', name: 'Viejo', archivedAt: '2026-01-01T00:00:00.000Z', andonStation: 'producto' }),
    ];

    function bodyRowNames(): string[] {
      return screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td')?.textContent ?? '');
    }

    it('"Detenidos" keeps only rows with an andon station and combines with Archivados', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue(lineProjects());
      renderDashboard('member');

      await screen.findByText('Web');
      await userEvent.click(screen.getByRole('radio', { name: /Detenidos/ }));
      expect(screen.getByText('Ystream')).toBeTruthy();
      for (const name of ['Web', 'Driftoso', 'Esperando', 'Viejo']) expect(screen.queryByText(name)).toBeNull();

      await userEvent.click(screen.getByRole('radio', { name: /Archivados/ }));
      expect(screen.getByText('Viejo')).toBeTruthy();
      expect(screen.queryByText('Ystream')).toBeNull();
    });

    it('"Con drift" keeps only rows with errors or warnings, not those awaiting CI', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue(lineProjects());
      renderDashboard('member');

      await screen.findByText('Web');
      await userEvent.click(screen.getByRole('radio', { name: /Con drift/ }));
      expect(screen.getByText('Driftoso')).toBeTruthy();
      for (const name of ['Web', 'Ystream', 'Esperando', 'Viejo']) expect(screen.queryByText(name)).toBeNull();
    });

    it('"Esperando CI" keeps only rows awaiting the first report', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue(lineProjects());
      renderDashboard('member');

      await screen.findByText('Web');
      await userEvent.click(screen.getByRole('radio', { name: /Esperando CI/ }));
      expect(screen.getByText('Esperando', { selector: 'span' })).toBeTruthy();
      for (const name of ['Web', 'Ystream', 'Driftoso', 'Viejo']) expect(screen.queryByText(name)).toBeNull();
    });

    it('names both active filters when the combination leaves no rows', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue(lineProjects());
      renderDashboard('member');

      await screen.findByText('Web');
      await userEvent.click(screen.getByRole('radio', { name: /Archivados/ }));
      await userEvent.click(screen.getByRole('radio', { name: /Con drift/ }));

      expect(await screen.findByText('Ningún proyecto coincide con «Archivados» y «Con drift».')).toBeTruthy();
    });

    it('counts each group of chips over the rows the other group leaves visible', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue(lineProjects());
      renderDashboard('member');

      await screen.findByText('Web');
      const lineGroup = screen.getByRole('radiogroup', { name: 'Estado de la línea' });
      const projectGroup = screen.getByRole('radiogroup', { name: 'Filtrar proyectos' });
      const chip = (group: HTMLElement, name: RegExp): HTMLElement => within(group).getByRole('radio', { name });

      // «Activos» hides «Viejo», so the stopped chip counts one row, not two, and «Todos» of the
      // line group counts the four visible rows, not the five projects of the org.
      expect(within(chip(lineGroup, /Detenidos/)).getByText('1')).toBeTruthy();
      expect(within(chip(lineGroup, /Todos/)).getByText('4')).toBeTruthy();

      await userEvent.click(chip(lineGroup, /Con drift/));
      expect(bodyRowNames()).toHaveLength(1);
      expect(bodyRowNames()[0]).toContain('Driftoso');
      // The other direction: inside «Con drift» there is one active project and none archived.
      expect(within(chip(projectGroup, /Activos/)).getByText('1')).toBeTruthy();
      expect(within(chip(projectGroup, /Archivados/)).getByText('0')).toBeTruthy();
    });

    it('no chip promises more rows than the table shows when selected', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue(lineProjects());
      renderDashboard('member');

      await screen.findByText('Web');
      const lineGroup = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Estado de la línea' });
      for (const name of [/Detenidos/, /Con drift/, /Esperando CI/, /Todos/]) {
        const radio = within(lineGroup()).getByRole('radio', { name });
        const promised = Number(within(radio).getByText(/^\d+$/).textContent);
        await userEvent.click(radio);
        expect(bodyRowNames()).toHaveLength(promised);
      }
    });

    it('sorts by "Estado de la línea" with the stopped line first', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
        makeProject({ id: 'p1', slug: 'web', name: 'Web' }),
        makeProject({ id: 'p2', slug: 'ystream', name: 'Ystream', andonStation: 'entrada', furthestStation: 'entregado' }),
      ]);
      renderDashboard('member');

      await screen.findByText('Web');
      await userEvent.click(screen.getByRole('button', { name: 'Estado de la línea' }));

      expect(screen.getByRole('columnheader', { name: 'Estado de la línea' }).getAttribute('aria-sort')).toBe('ascending');
      expect(bodyRowNames()[0]).toContain('Ystream');
    });

    it('sorts by "Drift" by severity: errors outweigh warnings', async () => {
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([
        makeProject({ id: 'p1', slug: 'avisos', name: 'Avisos', driftErrors: 0, driftWarnings: 3 }),
        makeProject({ id: 'p2', slug: 'errores', name: 'Errores', driftErrors: 2, driftWarnings: 0 }),
      ]);
      renderDashboard('member');

      await screen.findByText('Avisos');
      const header = (): HTMLElement => screen.getByRole('columnheader', { name: 'Drift' });
      await userEvent.click(screen.getByRole('button', { name: 'Drift' }));
      expect(header().getAttribute('aria-sort')).toBe('ascending');
      expect(bodyRowNames()[0]).toContain('Avisos');

      await userEvent.click(screen.getByRole('button', { name: 'Drift' }));
      expect(header().getAttribute('aria-sort')).toBe('descending');
      expect(bodyRowNames()[0]).toContain('Errores');
    });
  });
});

describe('lineLabel (FB-237)', () => {
  it('clamps the reached station to the one right before the stop', () => {
    expect(lineLabel({ furthestStation: 'entregado', andonStation: 'diseno_tecnico' })).toBe('Llegó a Producto, detenida en Diseño técnico');
    expect(lineLabel({ furthestStation: 'construccion', andonStation: 'diseno_tecnico' })).toBe('Llegó a Producto, detenida en Diseño técnico');
    expect(lineLabel({ furthestStation: 'entregado', andonStation: 'planificacion' })).toBe('Llegó a Diseño técnico, detenida en Planificación');
  });

  it('says only the hit stage when there is no andon, or when the line stopped at the first station', () => {
    expect(lineLabel({ furthestStation: 'entregado', andonStation: null })).toBe('Llega a Entregado');
    expect(lineLabel({ furthestStation: 'entregado', andonStation: 'entrada' })).toBe('Se detuvo en Entrada');
  });

  it('never prints a reached station past the stop', () => {
    const label = lineLabel({ furthestStation: 'entregado', andonStation: 'producto' });
    expect(label).not.toContain('Entregado');
    expect(label).not.toContain('Construcción');
    expect(label).toBe('Llegó a Caso de negocio, detenida en Producto');
  });
});
