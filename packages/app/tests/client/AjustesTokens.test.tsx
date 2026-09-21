import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrgRole, ProjectRole, TokenSummaryDto } from '@prdm/contracts';
import * as client from '../../src/api/client.js';
import { AjustesTokens } from '../../src/routes/AjustesTokens.js';
import { makeProjectShellContext } from './fixtures.js';

const CI_TOKEN: TokenSummaryDto = {
  id: 'tok1',
  kind: 'project_ci',
  name: 'ci-pipeline',
  prefix: 'prdm_ci_abcd',
  scopes: ['reports:write'],
  expiresAt: '2026-12-31T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderAjustesTokens(orgRole: OrgRole, myRole?: ProjectRole): void {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext(orgRole, myRole)} />, children: [{ index: true, element: <AjustesTokens /> }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('AjustesTokens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a permission message instead of the section for a viewer', () => {
    renderAjustesTokens('member', 'viewer');

    expect(screen.getByText('No tenés permiso para gestionar tokens de CI en este proyecto.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Tokens de CI' })).toBeNull();
  });

  it('is shown for a project admin and lets them create + revoke a CI token', async () => {
    vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createCiToken').mockResolvedValue({ token: CI_TOKEN, secret: 'prdm_ci_abcd.SECRET' });
    renderAjustesTokens('member', 'admin');

    expect(await screen.findByRole('heading', { name: 'Tokens de CI' })).toBeTruthy();
    await screen.findByText(/Todavía no hay tokens/);

    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'ci-pipeline');
    await userEvent.click(screen.getByLabelText('reports:write'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('acme', 'web', expect.objectContaining({ name: 'ci-pipeline', scopes: ['reports:write'], projectIds: [] })),
    );
    expect(await screen.findByText('prdm_ci_abcd.SECRET')).toBeTruthy();

    const revoke = vi.spyOn(client, 'revokeCiToken').mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: /^Revocar/ }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('acme', 'web', 'tok1'));
  });

  it('explains that the official baseline depends on the default branch and an OIDC-verified token, not a chosen branch', async () => {
    vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);
    renderAjustesTokens('member', 'admin');

    await screen.findByRole('heading', { name: 'Tokens de CI' });
    expect(screen.getByText(/rama por defecto del proyecto y de un token de CI verificado por OIDC/)).toBeTruthy();
    expect(screen.queryByLabelText('Rama')).toBeNull();
  });

  it('an org owner (no project_members row) can manage CI tokens via inherited admin', async () => {
    vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);
    renderAjustesTokens('owner');

    expect(await screen.findByRole('heading', { name: 'Tokens de CI' })).toBeTruthy();
  });

  it('never offers mcp:* or import:write scopes for a CI token', async () => {
    vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);
    renderAjustesTokens('member', 'admin');

    await screen.findByRole('heading', { name: 'Tokens de CI' });
    // The scopes only exist once the form is open, so it has to be open for this to prove anything.
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));
    expect(screen.getByLabelText('reports:write')).toBeTruthy();
    expect(screen.queryByLabelText('mcp:read')).toBeNull();
    expect(screen.queryByLabelText('mcp:write')).toBeNull();
    expect(screen.queryByLabelText('import:write')).toBeNull();
  });
});
