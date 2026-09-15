import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { routes } from '../../src/router';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

/** WO-117: "/" no longer renders a static placeholder — it's `RootRedirect`, which sends a signed-out
 * visitor to `/login` (this repo's actual entry point once a session exists is `/o/:orgSlug`, exercised by
 * `RootRedirect.test.tsx` and `OrgShell.test.tsx`). This smoke test only proves the route tree itself wires
 * up and reaches a real screen. */
describe('app router', () => {
  beforeEach(() => clearQueryCache());
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects "/" to "/login" for a signed-out visitor', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeTruthy();
  });

  it('shows a 404 page for an unknown path', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/does-not-exist'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
  });

  describe('SDD-013 ADR-008 redirects', () => {
    beforeEach(() => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
    });

    it('redirects a legacy .../graph path to .../arbol', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/graph'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/arbol'));
    });

    it('redirects a legacy .../settings path to .../ajustes/general', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/settings'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/ajustes/general'));
      expect(await screen.findByRole('heading', { name: 'Web' })).toBeTruthy();
    });

    it('redirects /settings/tokens to the first visible project\'s ajustes/tokens-personales', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/settings/tokens'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/ajustes/tokens-personales'));
    });

    it('the /ajustes index redirects to /ajustes/general', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/ajustes/general'));
    });
  });

  describe('permission gating', () => {
    it('a viewer never sees the "Crear token" action on ajustes/tokens', async () => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary({ role: 'member' })]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ myRole: 'viewer' })]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);

      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes/tokens'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByText('No tenés permiso para gestionar tokens de CI en este proyecto.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Crear token' })).toBeNull();
    });

    it('a project admin does see the "Crear token" action on ajustes/tokens', async () => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary({ role: 'member' })]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview({ myRole: 'admin' })]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
      vi.spyOn(client, 'listCiTokens').mockResolvedValue([]);

      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes/tokens'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('button', { name: 'Crear token' })).toBeTruthy();
    });
  });
});
