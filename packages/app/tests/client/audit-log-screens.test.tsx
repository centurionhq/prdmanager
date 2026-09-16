import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogEntryDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { AjustesAuditoria } from '../../src/routes/AjustesAuditoria.js';
import { OrgAjustesAuditoria } from '../../src/routes/OrgAjustesAuditoria.js';
import { makeProjectShellContext } from './fixtures.js';

const ENTRY: AuditLogEntryDto = {
  id: 'audit1',
  actor: { type: 'user', id: 'u1' },
  action: 'wo.claim',
  target: 'WO-001',
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderProjectAuditoria() {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner')} />, children: [{ index: true, element: <AjustesAuditoria /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

function renderOrgAuditoria() {
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug',
        element: <Outlet context={{ orgSlug: 'acme', organizations: [], currentOrg: { id: 'org1', slug: 'acme', name: 'Acme', role: 'owner' } }} />,
        children: [{ index: true, element: <OrgAjustesAuditoria /> }],
      },
    ],
    { initialEntries: ['/o/acme'] },
  );
  render(<RouterProvider router={router} />);
}

describe('AjustesAuditoria', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('shows a table with the entries once loaded', async () => {
    vi.spyOn(client, 'getProjectAuditLog').mockResolvedValue({ items: [ENTRY], nextCursor: null });
    renderProjectAuditoria();

    expect(await screen.findByText('wo.claim')).toBeTruthy();
    expect(screen.getByText('WO-001')).toBeTruthy();
  });

  it('shows an empty state with no entries', async () => {
    vi.spyOn(client, 'getProjectAuditLog').mockResolvedValue({ items: [], nextCursor: null });
    renderProjectAuditoria();

    expect(await screen.findByText('Todavía no hay actividad registrada')).toBeTruthy();
  });

  it('shows an error state with a retry on failure', async () => {
    vi.spyOn(client, 'getProjectAuditLog').mockRejectedValue(new Error('boom'));
    renderProjectAuditoria();

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('OrgAjustesAuditoria', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => vi.restoreAllMocks());

  it('shows a table with the org-wide entries once loaded', async () => {
    vi.spyOn(client, 'getOrgAuditLog').mockResolvedValue({ items: [ENTRY], nextCursor: null });
    renderOrgAuditoria();

    expect(await screen.findByText('wo.claim')).toBeTruthy();
  });
});
