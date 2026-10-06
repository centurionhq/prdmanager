import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { PersonalTokensSettings } from '../../src/routes/PersonalTokensSettings.js';
import { makeProjectShellContext } from './fixtures.js';

const TOKEN: import('@prdm/contracts').TokenSummaryDto = {
  id: 'tok1',
  kind: 'personal',
  name: 'laptop',
  prefix: 'prdm_pat_abcd',
  scopes: ['governance:read'],
  expiresAt: '2026-12-31T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** The organization the project shell resolved from the URL — deliberately NOT the first one
 * `listOrganizations()` returns, so a screen that fell back to `orgs[0]` would fail these tests. */
const SHELL_ORG = 'shell-org';

/** The project shell resolves the organization (`/o/:orgSlug/...`) and hands it down the `AjustesLayout`
 * outlet; that is the only organization this screen may use (SDD-013, WO-607/FB-083). Membership is the
 * shell's business too: an org the caller does not belong to never reaches this screen. */
function renderPersonalTokens(): void {
  const context = makeProjectShellContext('owner');
  const router = createMemoryRouter(
    [
      {
        path: '/ctx',
        element: (
          <Outlet
            context={{
              ...context,
              orgSlug: SHELL_ORG,
              currentOrg: { ...context.currentOrg, slug: SHELL_ORG },
            }}
          />
        ),
        children: [{ index: true, element: <PersonalTokensSettings /> }],
      },
    ],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('PersonalTokensSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes the organization from the shell, never from listOrganizations(), and shows no organization picker', async () => {
    const listOrganizations = vi
      .spyOn(client, 'listOrganizations')
      .mockResolvedValue([{ id: 'org-otra', slug: 'otra', name: 'Otra', role: 'owner' }]);
    const listTokens = vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([TOKEN]);
    renderPersonalTokens();

    expect(await screen.findByText('laptop')).toBeTruthy();
    expect(listTokens).toHaveBeenCalledWith(SHELL_ORG);
    expect(listOrganizations).not.toHaveBeenCalled();
    expect(screen.queryByRole('combobox', { name: 'Organización' })).toBeNull();
    expect(screen.getByText('prdm_pat_abcd')).toBeTruthy();
    expect(screen.queryByText(/secret/i)).toBeNull();
  });

  it('creates a token for the shell organization, shows the secret exactly once, and lists the new token', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createPersonalToken').mockResolvedValue({ token: TOKEN, secret: 'prdm_pat_abcd.SUPERSECRET' });
    renderPersonalTokens();

    await screen.findByText(/Todavía no hay tokens/);

    await userEvent.type(screen.getByLabelText('Nombre'), 'laptop');
    await userEvent.click(screen.getByLabelText('governance:read'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(SHELL_ORG, expect.objectContaining({ name: 'laptop', scopes: ['governance:read'] })),
    );
    expect(await screen.findByText('prdm_pat_abcd.SUPERSECRET')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('prdm_pat_abcd.SUPERSECRET')).toBeNull();
  });

  it('requires at least one scope before submitting', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createPersonalToken');
    renderPersonalTokens();

    await screen.findByText(/Todavía no hay tokens/);
    await userEvent.type(screen.getByLabelText('Nombre'), 'no-scopes');
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    expect(await screen.findByText(/al menos un scope/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes a token from the shell organization', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([TOKEN]);
    const revoke = vi.spyOn(client, 'revokePersonalToken').mockResolvedValue(undefined);
    renderPersonalTokens();

    await userEvent.click(await screen.findByRole('button', { name: 'Revocar' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(SHELL_ORG, 'tok1'));
  });
});
