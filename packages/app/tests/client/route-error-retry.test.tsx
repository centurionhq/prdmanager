/**
 * WO-744 (SDD-103 D6) — rework: the plate's «Reintentar» has to discard the read that broke the screen.
 *
 * `request.ts` casts the response body without validating it, so a 200 whose envelope the screen cannot
 * render reaches the session cache (the render then throws inside the route's `errorElement`). Retrying is
 * `navigate(location, { replace: true })` — a remount of the same route with the same query key — so a cache
 * that served that value again made the render throw a second time *before* the refetch effect ever ran:
 * zero requests, the plate back with a new code, and the app broken until a full reload.
 *
 * This case drives the **real** Órdenes screen through the **real** route tree (nothing here mocks the screen
 * that throws — that is exactly what let the bug through in `router.test.tsx`'s case (c)): the first call
 * answers WO-745's unexpected envelope, every later one the real page.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkOrderPage } from '@prdm/core';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { routes } from '../../src/router';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

/** Same payload the WO-745 e2e intercepts on `**\/graph/work-orders*`: `items` is not a list, so `Ordenes`
 * blows up while rendering (`data.items` → `42` → `sortWorkOrders` → `items.map is not a function`). */
const POISONED_ENVELOPE = {
  items: 42,
  total: 1,
  statusCounts: { all: 1, pending: 1, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 },
} as unknown as WorkOrderPage;

const REAL_PAGE: WorkOrderPage = {
  items: [
    {
      id: 'WO-001',
      title: 'Una orden sembrada',
      status: 'pending',
      assignedTo: null,
      blueprints: ['SDD-001'],
      sourcePath: 'docs/work-orders/WO-001.md',
      mirrorPath: '.prdm/remote/docs/WO-001.md',
    },
  ],
  total: 1,
  statusCounts: { all: 1, pending: 1, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 },
};

describe('SDD-103 D6 · «Reintentar» descarta la lectura que tumbó la pantalla', () => {
  beforeEach(() => {
    clearQueryCache();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
    vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('el envelope inesperado tumba la pantalla y, ya sin la causa, «Reintentar» pide de nuevo y dibuja las filas', async () => {
    const list = vi.spyOn(client, 'queryWorkOrders').mockResolvedValueOnce(POISONED_ENVELOPE).mockResolvedValue(REAL_PAGE);
    const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ordenes'] });
    render(<RouterProvider router={router} />);

    // The real screen threw on the real envelope: the plate is up, inside the chrome.
    expect(await screen.findByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    // The poisoned read must not be served again: the retry asks the server once more and draws the rows.
    expect(await screen.findByRole('heading', { level: 1, name: 'Órdenes de trabajo' })).toBeTruthy();
    expect(screen.getByText('WO-001')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
