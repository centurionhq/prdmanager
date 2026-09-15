import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogEntryDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { OrgAjustesAuditoria } from '../../src/routes/OrgAjustesAuditoria.js';
import { OrgShell } from '../../src/routes/OrgShell.js';

function entry(overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto {
  return {
    id: 'e1',
    createdAt: '2026-01-01T00:00:00.000Z',
    actor: { type: 'user', id: 'u1' },
    action: 'organization.invitation.created',
    target: 'inv1',
    metadata: {},
    ...overrides,
  };
}

function renderPage(): void {
  vi.spyOn(client, 'listOrganizations').mockResolvedValue([{ id: 'org1', slug: 'acme', name: 'Acme', role: 'admin' }]);
  const router = createMemoryRouter(
    [{ path: '/o/:orgSlug', element: <OrgShell />, children: [{ path: 'ajustes/auditoria', element: <OrgAjustesAuditoria /> }] }],
    { initialEntries: ['/o/acme/ajustes/auditoria'] },
  );
  render(<RouterProvider router={router} />);
}

describe('OrgAjustesAuditoria', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an empty state when there is no activity', async () => {
    vi.spyOn(client, 'getOrgAuditLog').mockResolvedValue({ items: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('Todavía no hay actividad registrada')).toBeTruthy();
  });

  it('lists entries and loads a further page on demand', async () => {
    const getLog = vi
      .spyOn(client, 'getOrgAuditLog')
      .mockResolvedValueOnce({ items: [entry({ id: 'e1' })], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [entry({ id: 'e2', action: 'member.role_changed' })], nextCursor: null });
    renderPage();

    expect(await screen.findByText('organization.invitation.created')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));

    expect(await screen.findByText('member.role_changed')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull());
    expect(getLog).toHaveBeenNthCalledWith(2, 'acme', { action: undefined, cursor: 'cursor-2' });
  });

  it('filters by an exact action and refetches from scratch', async () => {
    const getLog = vi
      .spyOn(client, 'getOrgAuditLog')
      .mockResolvedValueOnce({ items: [entry()], nextCursor: null })
      .mockResolvedValueOnce({ items: [entry({ id: 'e2', action: 'member.role_changed' })], nextCursor: null });
    renderPage();

    await screen.findByText('organization.invitation.created');
    await userEvent.type(screen.getByLabelText('Filtrar por acción'), 'member.role_changed');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(getLog).toHaveBeenLastCalledWith('acme', { action: 'member.role_changed' }));
    expect(await screen.findByText('member.role_changed')).toBeTruthy();
  });
});
