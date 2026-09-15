import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkOrderContextDto } from '@prdm/contracts';
import type { WorkOrderSummary } from '@prdm/core';
import * as client from '../../src/api/client.js';
import { ApiClientError } from '../../src/api/api-client-error.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { Ordenes } from '../../src/routes/Ordenes.js';
import { makeProjectShellContext } from './fixtures.js';

const ORDERS: WorkOrderSummary[] = [
  { id: 'WO-304', title: 'Escaneo incremental por hash', status: 'in_progress', assignedTo: 'agent:claude', blueprints: ['SDD-012'], sourcePath: 'docs/work-orders/WO-304.md' },
  { id: 'WO-310', title: 'Resumen del importador', status: 'pending', assignedTo: null, blueprints: ['SDD-012'], sourcePath: 'docs/work-orders/WO-310.md' },
  { id: 'WO-301', title: 'Tabla de hashes', status: 'done', assignedTo: 'dev:martin', blueprints: ['SDD-013'], sourcePath: 'docs/work-orders/WO-301.md' },
];

function fakeContext(overrides: Partial<WorkOrderContextDto['workOrder']> = {}): WorkOrderContextDto {
  return {
    workOrder: {
      id: 'WO-310',
      title: 'Resumen del importador',
      status: 'pending',
      assignedTo: null,
      sourcePath: 'docs/work-orders/WO-310.md',
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

function renderPage(): void {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner', 'admin')} />, children: [{ index: true, element: <Ordenes /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('Ordenes', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('lists every work order for the project', async () => {
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue(ORDERS);
    renderPage();

    expect(await screen.findByText('WO-304')).toBeTruthy();
    expect(screen.getByText('WO-310')).toBeTruthy();
    expect(screen.getByText('WO-301')).toBeTruthy();
  });

  it('shows an empty state when the project has no work orders at all', async () => {
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Todavía no hay órdenes de trabajo para este proyecto')).toBeTruthy();
  });

  it('filters by estado chip and offers "Quitar filtros" when nothing matches', async () => {
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue(ORDERS);
    renderPage();
    await screen.findByText('WO-304');

    await userEvent.click(screen.getByRole('radio', { name: /Hechas/ }));
    expect(screen.getByText('WO-301')).toBeTruthy();
    expect(screen.queryByText('WO-304')).toBeNull();

    await userEvent.type(screen.getByLabelText('Buscar órdenes'), 'no existe ninguna orden así');
    expect(screen.getByText('Ninguna orden coincide con estos filtros')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(await screen.findByText('WO-304')).toBeTruthy();
  });

  it('filters the visible rows by search, by id or title', async () => {
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue(ORDERS);
    renderPage();
    await screen.findByText('WO-304');

    await userEvent.type(screen.getByLabelText('Buscar órdenes'), 'hashes');

    expect(screen.getByText('WO-301')).toBeTruthy();
    expect(screen.queryByText('WO-304')).toBeNull();
  });

  it('opens the drawer with the real context and claims a pending order', async () => {
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue(ORDERS);
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext());
    const claim = vi.spyOn(client, 'claimWorkOrder').mockResolvedValue({ ...ORDERS[1]!, status: 'in_progress', assignedTo: 'dev:ana' });
    renderPage();

    await userEvent.click(await screen.findByText('WO-310'));

    expect(await screen.findByText('Al terminar una importación, la CLI muestra un resumen.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tomar orden' }));

    await waitFor(() => expect(claim).toHaveBeenCalledWith('acme', 'web', 'WO-310'));
    expect(await screen.findByText('Orden tomada')).toBeTruthy();
  });

  it('completes an in-progress order with a commit sha', async () => {
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue(ORDERS);
    vi.spyOn(client, 'getWorkOrderContext').mockResolvedValue(fakeContext({ id: 'WO-304', status: 'in_progress', assignedTo: 'agent:claude' }));
    const complete = vi.spyOn(client, 'completeWorkOrder').mockResolvedValue({ ...ORDERS[0]!, status: 'done' });
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
    vi.spyOn(client, 'listWorkOrders').mockResolvedValue(ORDERS);
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
});
