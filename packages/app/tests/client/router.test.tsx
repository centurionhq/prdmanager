import { render, screen, waitFor, within } from '@testing-library/react';
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

    expect(await screen.findByRole('heading', { name: 'Entrá a tu organización' })).toBeTruthy();
  });

  it('shows a branded 404 with a way home for an unknown path', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/does-not-exist'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Esta dirección no existe' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Volver al inicio' }).getAttribute('href')).toBe('/');
  });

  describe('SDD-071 404 inside the chrome', () => {
    const SECTION_404 = /Esta sección no existe/;

    beforeEach(() => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
      vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
    });

    it('an unknown org-level path renders the org 404 inside the org header', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/drift'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('heading', { name: 'Esta sección no existe en Acme' })).toBeTruthy();
      // SDD-077 D1: con una sola organización el header muestra el nombre como texto, sin switcher.
      expect(screen.queryByRole('combobox', { name: 'Organización' })).toBeNull();
      expect(screen.getByText('Acme')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Ver los proyectos de Acme' }).getAttribute('href')).toBe('/o/acme');
    });

    it('an unknown project-level path renders the project 404 inside the project sidebar', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/nope'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('heading', { name: 'Esta pantalla no existe en Web' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: SECTION_404 })).toBeNull();
      const destinos = within(screen.getByRole('navigation', { name: 'Destinos del proyecto' }));
      for (const label of ['Planta', 'Árbol de features', 'Documentos', 'Órdenes de trabajo', 'Drift', 'Bandeja de entrada']) {
        const link = destinos.getByRole('link', { name: label });
        expect(link).toBeTruthy();
        expect(link.getAttribute('aria-current')).toBeNull();
      }
    });

    it('a real project sibling (drift) is won by ProjectShell, not by the org splat', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/drift'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: SECTION_404 })).toBeNull();
      expect(screen.queryByRole('heading', { name: /Esta pantalla no existe/ })).toBeNull();
    });

    it('the legacy .../graph redirect still wins over the project splat', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/graph'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/arbol'));
    });

    it('a nested ajustes route is won by AjustesLayout, not by a 404', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes/general'] });
      render(<RouterProvider router={router} />);

      const group = await screen.findByRole('group', { name: 'Proyecto' });
      expect(within(group).getByText('Web')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: SECTION_404 })).toBeNull();
    });
  });

  describe('SDD-013 ADR-008 redirects', () => {
    beforeEach(() => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
      vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
      vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);
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
      expect(await screen.findByRole('heading', { name: 'General' })).toBeTruthy();
    });

    it("redirects /settings/tokens to the organization's ajustes/tokens-personales (SDD-089/WO-697)", async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/settings/tokens'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/ajustes/tokens-personales'));
    });

    it('the /ajustes index redirects to /ajustes/general', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/p/web/ajustes/general'));
    });
  });

  describe('SDD-089 organization-level account routes (WO-697)', () => {
    it('redirects the project-scoped perfil to the organization one', async () => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
      vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes/perfil'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/ajustes/perfil'));
      expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeTruthy();
    });

    it('redirects the project-scoped tokens-personales to the organization one', async () => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
      vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);

      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ajustes/tokens-personales'] });
      render(<RouterProvider router={router} />);

      await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme/ajustes/tokens-personales'));
    });

    it('mounts the personal-tokens screen if the caller belongs to no project at all: the org comes from the URL (WO-697/WO-607)', async () => {
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary({ slug: 'centurionhq', name: 'Centurion HQ' })]);
      const listProjects = vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([]);
      const listTokens = vi.spyOn(client, 'listPersonalTokens').mockResolvedValue([]);

      const router = createMemoryRouter(routes, { initialEntries: ['/o/centurionhq/ajustes/tokens-personales'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('heading', { level: 2, name: 'Tokens personales' })).toBeTruthy();
      await waitFor(() => expect(listTokens).toHaveBeenCalledWith('centurionhq'));
      expect(router.state.location.pathname).toBe('/o/centurionhq/ajustes/tokens-personales');
      expect(listProjects).not.toHaveBeenCalled();
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
