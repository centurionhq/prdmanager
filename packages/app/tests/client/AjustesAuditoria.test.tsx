import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogEntryDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { AjustesAuditoria } from '../../src/routes/AjustesAuditoria.js';
import { makeProjectShellContext } from './fixtures.js';

function entry(overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto {
  return {
    id: 'e1',
    createdAt: '2026-01-01T00:00:00.000Z',
    actor: { type: 'user', id: 'u1' },
    action: 'document.published',
    target: 'SDD-011',
    metadata: {},
    ...overrides,
  };
}

function renderPage(): void {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('admin')} />, children: [{ index: true, element: <AjustesAuditoria /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('AjustesAuditoria', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an empty state when there is no activity', async () => {
    vi.spyOn(client, 'getProjectAuditLog').mockResolvedValue({ items: [], nextCursor: null });
    renderPage();

    expect(await screen.findByText('Todavía no hay actividad registrada')).toBeTruthy();
  });

  it('lists entries and loads a further page on demand', async () => {
    const getLog = vi
      .spyOn(client, 'getProjectAuditLog')
      .mockResolvedValueOnce({ items: [entry({ id: 'e1' })], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [entry({ id: 'e2', action: 'drift.acknowledged' })], nextCursor: null });
    renderPage();

    expect(await screen.findByText('document.published')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));

    expect(await screen.findByText('drift.acknowledged')).toBeTruthy();
    expect(screen.getByText('document.published')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull());
    expect(getLog).toHaveBeenNthCalledWith(2, 'acme', 'web', { action: undefined, cursor: 'cursor-2' });
  });

  it('filters by an exact action and refetches from scratch', async () => {
    const getLog = vi
      .spyOn(client, 'getProjectAuditLog')
      .mockResolvedValueOnce({ items: [entry()], nextCursor: null })
      .mockResolvedValueOnce({ items: [entry({ id: 'e2', action: 'drift.acknowledged' })], nextCursor: null });
    renderPage();

    await screen.findByText('document.published');
    await userEvent.type(screen.getByLabelText('Filtrar por acción'), 'drift.acknowledged');
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(getLog).toHaveBeenLastCalledWith('acme', 'web', { action: 'drift.acknowledged' }));
    expect(await screen.findByText('drift.acknowledged')).toBeTruthy();
  });

  it('surfaces a server error with a retry action', async () => {
    vi.spyOn(client, 'getProjectAuditLog')
      .mockRejectedValueOnce(new client.ApiClientError(500, 'internal_error', 'boom'))
      .mockResolvedValueOnce({ items: [entry()], nextCursor: null });
    renderPage();

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('document.published')).toBeTruthy();
  });
});
