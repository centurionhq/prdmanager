import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { PersonalTokensSettings } from '../../src/routes/PersonalTokensSettings.js';
import { makeOrgSummary, makeProjectShellContext } from './fixtures.js';

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

/** The organization the project shell resolved from the URL. Deliberately NOT the first one
 * `listOrganizations()` returns, so a screen that fell back to `orgs[0]` fails these tests (WO-607/FB-083). */
const SHELL_ORG = 'shell-org';

/** The project shell resolves the organization (`/o/:orgSlug/...`) and hands it down the `AjustesLayout`
 * outlet; that is the only organization this screen may use. Since SDD-089/WO-697 the screen lives at the
 * organization level and mounts under `OrgShell` too, so it reads the slug through `useShellOrgSlug()`,
 * which only needs the org shell context. Membership is the shell's business too — an
 * organization the caller does not belong to never reaches this screen (`OrgShell`/`ProjectShell` render
 * "Organización no encontrada" instead), which is why this screen no longer calls `listOrganizations()`
 * nor renders the "pertenecer a una organización" notice the canvas never had. */
function renderPersonalTokens(orgSlug: string = SHELL_ORG): void {
  const context = makeProjectShellContext('owner');
  const router = createMemoryRouter(
    [
      {
        path: '/ctx',
        element: <Outlet context={{ ...context, orgSlug, currentOrg: { ...context.currentOrg, slug: orgSlug } }} />,
        children: [{ index: true, element: <PersonalTokensSettings /> }],
      },
    ],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

/** Same screen, but under a bare `OrgShellContext` (no project fields at all): SDD-089 moved it out of the
 * project, so a platform-level organization is enough for it to work. */
function renderPersonalTokensInOrgShell(orgSlug: string): void {
  const currentOrg = makeOrgSummary({ slug: orgSlug, name: 'Centurion HQ' });
  const router = createMemoryRouter(
    [
      {
        path: '/ctx',
        element: <Outlet context={{ orgSlug, organizations: [currentOrg], currentOrg }} />,
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
    expect(screen.queryByLabelText('Organización')).toBeNull();
    expect(screen.getByText('prdm_pat_abcd')).toBeTruthy();
    expect(screen.queryByText(/secret/i)).toBeNull();
  });

  it('reads the tokens of whatever organization the shell resolves, without any in-screen switcher', async () => {
    const list = vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    renderPersonalTokens('globex');

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('globex'));
    expect(screen.queryByRole('combobox', { name: 'Organización' })).toBeNull();
  });

  it('works under a bare organization shell, with no project at all (SDD-089/WO-697)', async () => {
    const list = vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([TOKEN]);
    renderPersonalTokensInOrgShell('centurionhq');

    expect(await screen.findByText('laptop')).toBeTruthy();
    expect(list).toHaveBeenCalledWith('centurionhq');
  });

  it('creates a token for the shell organization, shows the secret exactly once, and lists the new token', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createPersonalToken').mockResolvedValue({ token: TOKEN, secret: 'prdm_pat_abcd.SUPERSECRET' });
    renderPersonalTokens();

    await screen.findByText(/Todavía no hay tokens/);

    // The form is one click away, not always on screen (SDD-056, canvas `AjustesTokens.dc.html`).
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'laptop');
    await userEvent.click(screen.getByLabelText('governance:read'));
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(SHELL_ORG, expect.objectContaining({ name: 'laptop', scopes: ['governance:read'] })),
    );
    expect(await screen.findByText('prdm_pat_abcd.SUPERSECRET')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Ya lo guardé' }));
    expect(screen.queryByText('prdm_pat_abcd.SUPERSECRET')).toBeNull();
  });

  it('requires at least one scope before submitting', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    const create = vi.spyOn(client, 'createPersonalToken');
    renderPersonalTokens();

    await screen.findByText(/Todavía no hay tokens/);
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));
    await userEvent.type(screen.getByLabelText('Nombre'), 'no-scopes');
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    expect(await screen.findByText(/al menos un scope/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('has no second level-one heading of its own: the page already has its h1', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
    renderPersonalTokens();

    expect(await screen.findByRole('heading', { level: 2, name: 'Tokens personales' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('revokes a token from the shell organization', async () => {
    vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([TOKEN]);
    const revoke = vi.spyOn(client, 'revokePersonalToken').mockResolvedValue(undefined);
    renderPersonalTokens();

    await userEvent.click(await screen.findByRole('button', { name: /^Revocar/ }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(SHELL_ORG, 'tok1'));
  });
});
