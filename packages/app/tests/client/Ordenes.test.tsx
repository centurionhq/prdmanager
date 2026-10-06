import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkOrderContextDto, WorkProfile } from '@prdm/contracts';
import type { WorkOrderPage, WorkOrderStatusCounts, WorkOrderSummary } from '@prdm/core';
import * as client from '../../src/api/client.js';
import { ApiClientError } from '../../src/api/api-client-error.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { Ordenes } from '../../src/routes/Ordenes.js';
import { makeProjectShellContext } from './fixtures.js';

const ORDERS: WorkOrderSummary[] = [
  { id: 'WO-304', title: 'Escaneo incremental por hash', status: 'in_progress', assignedTo: 'agent:claude', blueprints: ['SDD-012'], sourcePath: 'docs/work-orders/WO-304.md', mirrorPath: '.prdm/remote/docs/WO-304.md' },
  { id: 'WO-310', title: 'Resumen del importador', status: 'pending', assignedTo: null, blueprints: ['SDD-012'], sourcePath: 'docs/work-orders/WO-310.md', mirrorPath: '.prdm/remote/docs/WO-310.md' },
  { id: 'WO-301', title: 'Tabla de hashes', status: 'done', assignedTo: 'dev:martin', blueprints: ['SDD-013'], sourcePath: 'docs/work-orders/WO-301.md', mirrorPath: '.prdm/remote/docs/WO-301.md' },
  { id: 'WO-320', title: 'Índice de búsqueda incremental', status: 'archived', assignedTo: null, blueprints: ['SDD-013'], sourcePath: 'docs/work-orders/WO-320.md', mirrorPath: '.prdm/remote/docs/WO-320.md' },
];

function fakeContext(overrides: Partial<WorkOrderContextDto['workOrder']> = {}): WorkOrderContextDto {
  return {
    workOrder: {
      id: 'WO-310',
      title: 'Resumen del importador',
      status: 'pending',
      assignedTo: null,
      sourcePath: 'docs/work-orders/WO-310.md',
      mirrorPath: '.prdm/remote/docs/WO-310.md',
      body: 'Al terminar una importación, la CLI muestra un resumen.',
      acceptanceCriteria: ['El resumen separa archivos nuevos, modificados y borrados'],
      ...overrides,
    },
    blueprints: [{ id: 'SDD-012', title: 'Importador', status: 'approved', impactsPaths: ['packages/cli/**'], body: '' }],
    featureLineage: [],
    context: [],
    code: [{ key: 'k1', path: 'packages/cli/src/import.ts', symbol: null, status: 'synced', reason: '', blueprint: 'SDD-012' }],
    commits: [{ sha: '3c1a5af1234567890', subject: 'Agrega el resumen', author: 'agent:claude', date: '2026-01-01' }],
    drift: [],
    instructions: '',
  };
}

function page(items: WorkOrderSummary[], total = items.length, counts: Partial<WorkOrderStatusCounts> = {}): WorkOrderPage {
  return { items, total, statusCounts: { all: 0, pending: 0, in_progress: 0, out_of_sync: 0, done: 0, archived: 0, ...counts } };
}

function renderPage(initialEntries: string[] = ['/ctx'], workProfile: WorkProfile | null = null) {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner', 'admin', workProfile)} />, children: [{ index: true, element: <Ordenes /> }] }],
    { initialEntries },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** `renderPage` with the three real Construir destinations mounted, to assert where «Ir a Construir» lands. */
function renderPageWithConstruir(workProfile: WorkProfile | null = null) {
  const router = createMemoryRouter(
    [
      { path: '/ctx', element: <Outlet context={makeProjectShellContext('owner', 'admin', workProfile)} />, children: [{ index: true, element: <Ordenes /> }] },
      { path: '/o/acme/p/web/construir/negocio', element: <p>destino: negocio</p> },
      { path: '/o/acme/p/web/construir/producto', element: <p>destino: producto</p> },
      { path: '/o/acme/p/web/construir/developer', element: <p>destino: developer</p> },
    ],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function selectOrders(ids: readonly string[]): Promise<void> {
  for (const id of ids) await userEvent.click(screen.getByRole('checkbox', { name: `Seleccionar ${id}` }));
}

async function openBatch(action: 'Archivar' | 'Tomar'): Promise<HTMLElement> {
  const bar = await screen.findByRole('group', { name: 'Acciones en lote' });
  await userEvent.click(within(bar).getByRole('button', { name: `${action} seleccionadas` }));
  return screen.findByRole('dialog', { name: action === 'Archivar' ? 'Archivar órdenes' : 'Tomar órdenes' });
}

describe('Ordenes', () => {
  beforeEach(() => {
    clearQueryCache();
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists every work order for the project', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    renderPage();

    expect(await screen.findByText('WO-304')).toBeTruthy();
    expect(screen.getByText('WO-310')).toBeTruthy();
    expect(screen.getByText('WO-301')).toBeTruthy();
  });

  it('shows the project-empty state with no filters, and "Quitar filtros" when filters match nothing', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText('Todavía no hay órdenes de trabajo para este proyecto')).toBeTruthy();
    list.mockResolvedValue(page([], 0));
    cleanup();
    clearQueryCache();
    renderPage(['/ctx?status=done']);

    expect(await screen.findByText('Ninguna orden coincide con estos filtros')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar filtros' })).toBeTruthy();
  });

  it('asks the server for one page with the active filters', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page([ORDERS[2]!]));
    renderPage(['/ctx?status=done']);

    expect(await screen.findByText('WO-301')).toBeTruthy();
    expect(list).toHaveBeenCalledWith('acme', 'web', expect.objectContaining({ status: 'done', limit: 25, offset: 0 }));
    expect(list.mock.calls.every(([, , filter]) => filter?.limit === 25 && filter?.offset === 0)).toBe(true);
  });

  it('reads every filter from the URL', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    renderPage(['/ctx?status=done&blueprint=SDD-012&actor=agentes&q=hash']);

    await screen.findByText('WO-304');
    expect(list).toHaveBeenCalledWith('acme', 'web', {
      status: 'done',
      blueprint: 'SDD-012',
      actorKind: 'agent',
      assignedTo: undefined,
      q: 'hash',
      limit: 25,
      offset: 0,
    });
  });

  it('writes the estado chip to the URL and re-queries from the first page', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    const router = renderPage(['/ctx?page=2']);
    await screen.findByText('WO-304');

    await userEvent.click(screen.getByRole('radio', { name: /Hechas/ }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('acme', 'web', expect.objectContaining({ status: 'done', offset: 0 })));
    expect(router.state.location.search).toBe('?status=done');
  });

  it('sends the search text to the server, replacing history', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    const router = renderPage();
    await screen.findByText('WO-304');

    await userEvent.type(screen.getByLabelText('Buscar órdenes'), 'hashes');

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('acme', 'web', expect.objectContaining({ q: 'hashes' })));
    expect(router.state.location.search).toBe('?q=hashes');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('pages against the real server total', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS, 60));
    renderPage();

    expect(await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'Mostrando 4 de 60 órdenes')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Página 1 de 3')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('acme', 'web', expect.objectContaining({ offset: 25 })));
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'Mostrando 29 de 60 órdenes')).toBeTruthy();
  });

  it('shows the server status counts on the estado chips', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS, 4, { all: 12, pending: 7 }));
    renderPage();
    await screen.findByText('WO-304');

    expect(within(screen.getByRole('radio', { name: /Pendientes/ })).getByText('7')).toBeTruthy();
    expect(within(screen.getByRole('radio', { name: /Todas/ })).getByText('12')).toBeTruthy();
  });

  it('filters "Asignada a: mí" by the session handle', async () => {
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: 'martin', workProfile: null });
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    renderPage();
    await screen.findByText('WO-304');
    await waitFor(() => expect((screen.getByRole('option', { name: 'Asignada a: mí' }) as HTMLOptionElement).disabled).toBe(false));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Asignada a' }), 'Asignada a: mí');

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('acme', 'web', expect.objectContaining({ assignedTo: 'dev:martin', actorKind: undefined })));
  });

  it('disables "Asignada a: mí" and explains why when the session has no handle', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    renderPage();
    await screen.findByText('WO-304');

    const option = await screen.findByRole('option', { name: /Asignada a: mí/ });
    expect((option as HTMLOptionElement).disabled).toBe(true);
    expect(await screen.findByText('Definí tu handle en Ajustes › Perfil')).toBeTruthy();
  });

  it('falls back to the defaults on invalid URL values', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    renderPage(['/ctx?status=no-existe&page=0&actor=raro']);

    expect(await screen.findByText('WO-304')).toBeTruthy();
    const filter = list.mock.calls[0]![2]!;
    expect(filter.status).toBeUndefined();
    expect(filter.actorKind).toBeUndefined();
    expect(filter.offset).toBe(0);
  });

  async function openClaimDialog(): Promise<HTMLElement> {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext());
    renderPage();
    await userEvent.click(await screen.findByText('WO-310'));
    expect(await screen.findByText('Al terminar una importación, la CLI muestra un resumen.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tomar orden' }));
    return screen.findByRole('dialog', { name: 'Tomar orden' });
  }

  const claimResult = (assignedTo: string): Awaited<ReturnType<typeof client.claimWorkOrder>> => ({
    id: 'WO-310',
    status: 'in_progress',
    assignedTo,
    claimedAt: '2026-01-01T00:00:00.000Z',
  });

  it('opens the drawer with the real context and claims a pending order as the session handle', async () => {
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: 'ana', workProfile: null });
    const claim = vi.spyOn(client, 'claimWorkOrder').mockResolvedValue(claimResult('dev:ana'));
    const dialog = await openClaimDialog();

    expect((await within(dialog).findByRole('radio', { name: 'Yo (dev:ana)' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));

    await waitFor(() => expect(claim).toHaveBeenCalledWith('acme', 'web', 'WO-310', 'dev:ana'));
    expect(await screen.findByText('Orden tomada: asignada a dev:ana')).toBeTruthy();
  });

  it('without a handle disables "Yo" and claims for a named agent', async () => {
    const claim = vi.spyOn(client, 'claimWorkOrder').mockResolvedValue(claimResult('agent:claude'));
    const dialog = await openClaimDialog();

    expect(within(dialog).queryByRole('radio', { name: /Yo \(dev:/ })).toBeNull();
    expect((within(dialog).getByRole('radio', { name: 'Yo (sin handle)' }) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText('Definí tu handle en Ajustes › Perfil.')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Nombre del agente'), ' claude ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));

    await waitFor(() => expect(claim).toHaveBeenCalledWith('acme', 'web', 'WO-310', 'agent:claude'));
  });

  it('rejects an invalid agent name without calling the server', async () => {
    const claim = vi.spyOn(client, 'claimWorkOrder').mockResolvedValue(claimResult('agent:x'));
    const dialog = await openClaimDialog();

    const input = within(dialog).getByLabelText('Nombre del agente');
    await userEvent.type(input, 'agente con espacios');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));

    expect(await within(dialog).findByText(/Escribí el nombre del agente/)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(claim).not.toHaveBeenCalled();
  });

  it('shows a server rejection inside the claim dialog', async () => {
    vi.spyOn(client, 'claimWorkOrder').mockRejectedValue(new ApiClientError(409, 'unknown', 'already claimed'));
    const dialog = await openClaimDialog();

    await userEvent.type(within(dialog).getByLabelText('Nombre del agente'), 'claude');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBeTruthy();
  });

  it('completes an in-progress order with a commit sha', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext({ id: 'WO-304', status: 'in_progress', assignedTo: 'agent:claude' }));
    const complete = vi.spyOn(client, 'completeWorkOrder').mockResolvedValue({ id: 'WO-304', status: 'done', completedAt: '2026-01-01T00:00:00.000Z', resolvedBy: [], drift: [] });
    renderPage();

    await userEvent.click(await screen.findByText('WO-304'));
    await userEvent.click(await screen.findByRole('button', { name: 'Completar' }));
    const modal = await screen.findByRole('dialog', { name: 'Completar orden' });
    await userEvent.type(within(modal).getByLabelText(/SHA del commit con Refs: WO-304/), '3c1a5af1234567890');
    await userEvent.click(within(modal).getByRole('button', { name: 'Completar' }));

    await waitFor(() => expect(complete).toHaveBeenCalledWith('acme', 'web', 'WO-304', '3c1a5af1234567890'));
    expect(await screen.findByText('Orden completada')).toBeTruthy();
  });

  it('explains a 409 commit_not_verified_by_ci instead of a generic error', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext({ id: 'WO-304', status: 'in_progress', assignedTo: 'agent:claude' }));
    vi.spyOn(client, 'completeWorkOrder').mockRejectedValue(new ApiClientError(409, 'unknown', 'commit not verified by CI'));
    renderPage();

    await userEvent.click(await screen.findByText('WO-304'));
    await userEvent.click(await screen.findByRole('button', { name: 'Completar' }));
    const modal = await screen.findByRole('dialog', { name: 'Completar orden' });
    await userEvent.type(within(modal).getByLabelText(/SHA del commit con Refs: WO-304/), '3c1a5af1234567890');
    await userEvent.click(within(modal).getByRole('button', { name: 'Completar' }));

    expect(await screen.findByText(/todavía no fue verificado por CI/)).toBeTruthy();
  });

  it('archives a pending order with an optional reason, toasts and refreshes the list', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext());
    const archive = vi
      .spyOn(client, 'archiveWorkOrder')
      .mockResolvedValue({ id: 'WO-310', status: 'archived', archivedAt: '2026-01-01T00:00:00.000Z', archivedBy: 'dev:ana' });
    renderPage();

    await userEvent.click(await screen.findByText('WO-310'));
    await userEvent.click(await screen.findByRole('button', { name: 'Archivar' }));

    const modal = await screen.findByRole('dialog', { name: 'Archivar orden' });
    await userEvent.type(within(modal).getByLabelText('Motivo (opcional)'), 'Quedó obsoleta');
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith('acme', 'web', 'WO-310', 'Quedó obsoleta'));
    expect(await screen.findByText('Orden archivada')).toBeTruthy();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it('archives without a reason (an empty motive is a valid archive)', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext());
    const archive = vi
      .spyOn(client, 'archiveWorkOrder')
      .mockResolvedValue({ id: 'WO-310', status: 'archived', archivedAt: '2026-01-01T00:00:00.000Z', archivedBy: 'dev:ana' });
    renderPage();

    await userEvent.click(await screen.findByText('WO-310'));
    await userEvent.click(await screen.findByRole('button', { name: 'Archivar' }));
    const modal = await screen.findByRole('dialog', { name: 'Archivar orden' });
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith('acme', 'web', 'WO-310', undefined));
  });

  it.each([
    ['done', 'done'],
    ['archived', 'archived'],
  ])('never offers Archivar on a %s order', async (_label, status) => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(
      fakeContext({ id: 'WO-301', status, assignedTo: 'dev:martin' }),
    );
    renderPage();

    await userEvent.click(await screen.findByText('WO-301'));
    expect(await screen.findByText('Al terminar una importación, la CLI muestra un resumen.')).toBeTruthy();

    expect(screen.queryByRole('button', { name: 'Archivar' })).toBeNull();
  });

  it('surfaces the server\'s own message when the session lacks archive_work_order', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext());
    vi.spyOn(client, 'archiveWorkOrder').mockRejectedValue(
      new ApiClientError(403, 'forbidden', 'No tenés permiso para archivar órdenes en este proyecto.'),
    );
    renderPage();

    await userEvent.click(await screen.findByText('WO-310'));
    await userEvent.click(await screen.findByRole('button', { name: 'Archivar' }));
    const modal = await screen.findByRole('dialog', { name: 'Archivar orden' });
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    expect(await screen.findByText('No tenés permiso para archivar órdenes en este proyecto.')).toBeTruthy();
  });

  it('explains that orders are generated from a blueprint checklist and offers «Ir a Construir»', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page([]));
    const router = renderPageWithConstruir();

    expect(await screen.findByText('Todavía no hay órdenes de trabajo para este proyecto')).toBeTruthy();
    expect(screen.getByText(/## Tareas/)).toBeTruthy();
    expect(screen.getByText(/se generan del checklist/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Ir a Construir' }));

    // Nobody has picked a work profile yet, so the line starts where it starts: the business case.
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/construir/negocio'));
    expect(await screen.findByText('destino: negocio')).toBeTruthy();
  });

  it('sends whoever already chose a work profile to their own Construir path', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page([]));
    const router = renderPageWithConstruir('developer');

    await screen.findByText('Todavía no hay órdenes de trabajo para este proyecto');
    await userEvent.click(screen.getByRole('button', { name: 'Ir a Construir' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/construir/developer'));
  });

  it('does not change the filtered-empty state, which keeps «Quitar filtros»', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page([], 0));
    renderPage(['/ctx?status=done']);

    expect(await screen.findByText('Ninguna orden coincide con estos filtros')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitar filtros' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ir a Construir' })).toBeNull();
  });

  it('shows the batch bar with its counter from two selected orders on', async () => {
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    renderPage();
    await screen.findByText('WO-304');

    await selectOrders(['WO-310']);
    expect(screen.queryByRole('group', { name: 'Acciones en lote' })).toBeNull();

    await selectOrders(['WO-301']);

    const bar = await screen.findByRole('group', { name: 'Acciones en lote' });
    expect(within(bar).getByText('2 órdenes seleccionadas')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Archivar seleccionadas' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Tomar seleccionadas' })).toBeTruthy();
  });

  it('archives the whole selection in one batch, with an optional motive, and refreshes the list', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    const batch = vi.spyOn(client, 'batchWorkOrders').mockResolvedValue({
      results: [
        { id: 'WO-301', ok: true },
        { id: 'WO-310', ok: true },
      ],
      archived: 2,
      claimed: 0,
    });
    renderPage();
    await screen.findByText('WO-304');
    await selectOrders(['WO-310', 'WO-301']);

    const modal = await openBatch('Archivar');
    await userEvent.type(within(modal).getByLabelText('Motivo (opcional)'), 'Quedaron obsoletas');
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    await waitFor(() =>
      expect(batch).toHaveBeenCalledWith('acme', 'web', { action: 'archive', ids: ['WO-301', 'WO-310'], reason: 'Quedaron obsoletas' }),
    );
    expect(await screen.findByText('2 órdenes archivadas')).toBeTruthy();
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByRole('group', { name: 'Acciones en lote' })).toBeNull();
  });

  it('reports the per-item failures of a batch with the server\'s own message, without aborting the rest', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'batchWorkOrders').mockResolvedValue({
      results: [
        { id: 'WO-301', ok: true },
        { id: 'WO-310', ok: false, error: 'la orden no está en un estado archivable' },
      ],
      archived: 1,
      claimed: 0,
    });
    renderPage();
    await screen.findByText('WO-304');
    await selectOrders(['WO-310', 'WO-301']);

    const modal = await openBatch('Archivar');
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    expect(await screen.findByText(/1 de 2 archivadas/)).toBeTruthy();
    const failures = screen.getByRole('list', { name: 'Órdenes que no se pudieron actualizar' });
    expect(within(failures).getByText('WO-310')).toBeTruthy();
    expect(within(failures).getByText(/la orden no está en un estado archivable/)).toBeTruthy();
    // Best-effort: the item that did archive still refreshes the list.
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows a rejected batch inside the dialog and keeps the selection', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    vi.spyOn(client, 'batchWorkOrders').mockRejectedValue(
      new ApiClientError(403, 'forbidden', 'No tenés permiso para archivar órdenes en este proyecto.'),
    );
    renderPage();
    await screen.findByText('WO-304');
    await selectOrders(['WO-310', 'WO-301']);

    const modal = await openBatch('Archivar');
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    expect(await within(modal).findByRole('alert')).toHaveProperty(
      'textContent',
      'No tenés permiso para archivar órdenes en este proyecto.',
    );
    expect(list.mock.calls.length).toBe(1);
    expect(screen.getByRole('group', { name: 'Acciones en lote' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Seleccionar WO-310' }) as HTMLInputElement).checked).toBe(true);
  });

  it('takes the whole selection in one batch, defaulting to the session handle', async () => {
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: 'ana', workProfile: null });
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(ORDERS));
    const batch = vi.spyOn(client, 'batchWorkOrders').mockResolvedValue({
      results: [
        { id: 'WO-301', ok: true },
        { id: 'WO-310', ok: true },
      ],
      archived: 0,
      claimed: 2,
    });
    renderPage();
    await screen.findByText('WO-304');
    await selectOrders(['WO-310', 'WO-301']);

    const modal = await openBatch('Tomar');
    expect((within(modal).getByRole('radio', { name: 'Yo (dev:ana)' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(modal).getByRole('button', { name: 'Tomar órdenes' }));

    await waitFor(() =>
      expect(batch).toHaveBeenCalledWith('acme', 'web', { action: 'claim', ids: ['WO-301', 'WO-310'], assignee: 'dev:ana' }),
    );
    expect(await screen.findByText('2 órdenes tomadas')).toBeTruthy();
  });

  it('refuses a batch over the server\'s own 200-id cap before calling it', async () => {
    const many: WorkOrderSummary[] = Array.from({ length: 201 }, (_, index) => ({
      id: `WO-${400 + index}`,
      title: `Orden ${index}`,
      status: 'pending',
      assignedTo: null,
      blueprints: ['SDD-012'],
      sourcePath: `docs/work-orders/WO-${400 + index}.md`,
      mirrorPath: `.prdm/remote/docs/WO-${400 + index}.md`,
    }));
    vi.spyOn(client, 'queryWorkOrders').mockResolvedValue(page(many, many.length));
    const batch = vi.spyOn(client, 'batchWorkOrders').mockResolvedValue({ results: [], archived: 0, claimed: 0 });
    renderPage();
    await screen.findByText('WO-400');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas' }));
    const modal = await openBatch('Archivar');
    await userEvent.click(within(modal).getByRole('button', { name: 'Archivar' }));

    expect(await within(modal).findByRole('alert')).toHaveProperty(
      'textContent',
      'El lote acepta hasta 200 órdenes. Quitá algunas de la selección y volvé a intentar.',
    );
    expect(batch).not.toHaveBeenCalled();
  });
});
