import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { SettingsTokensRedirect } from '../../src/routes/SettingsTokensRedirect.js';
import { makeOrgSummary } from './fixtures.js';

function renderRedirect() {
  const router = createMemoryRouter(
    [
      { path: '/settings/tokens', element: <SettingsTokensRedirect /> },
      { path: '/o/:orgSlug/ajustes/tokens-personales', element: <p>tokens personales</p> },
    ],
    { initialEntries: ['/settings/tokens'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** `/settings/tokens` is the legacy path (ADR-008) and it now only needs an organization: the personal-tokens
 * screen belongs to the account, not to a project (SDD-089 §D5, WO-697). */
describe('SettingsTokensRedirect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to the first organization\'s tokens-personales without asking for a project', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary({ slug: 'centurionhq', name: 'Centurion HQ' })]);
    const listProjects = vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([]);

    const router = renderRedirect();

    expect(await screen.findByText('tokens personales')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/o/centurionhq/ajustes/tokens-personales');
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('shows the no-organization notice (never the project one) when the caller belongs to nothing', async () => {
    vi.spyOn(client, 'listOrganizations').mockResolvedValue([]);
    const listProjects = vi.spyOn(client, 'getProjectsOverview');

    renderRedirect();

    expect(await screen.findByRole('heading', { name: 'Todavía no pertenecés a ninguna organización' })).toBeTruthy();
    expect(screen.queryByText(/invite a un proyecto/i)).toBeNull();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('reports an API failure instead of redirecting', async () => {
    vi.spyOn(client, 'listOrganizations').mockRejectedValue(new Error('boom'));

    renderRedirect();

    expect(await screen.findByText('Ocurrió un error inesperado. Probá de nuevo.')).toBeTruthy();
  });
});
