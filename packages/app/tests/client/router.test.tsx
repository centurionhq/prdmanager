import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { clearQueryCache } from '../../src/api/query-cache.js';
import { routes } from '../../src/router';
import { makeOrgSummary, makeProjectOverview } from './fixtures.js';

/** SDD-103: banderas mutables (izadas con el `vi.mock`) que hacen tirar a una pantalla real durante el render. */
const thrown = vi.hoisted(() => ({ ordenes: false, admin: false, orgIndex: false }));

vi.mock('../../src/routes/Ordenes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/routes/Ordenes.js')>();
  return {
    ...actual,
    Ordenes: () => {
      if (thrown.ordenes) throw new Error('boom en Órdenes');
      return <actual.Ordenes />;
    },
  };
});

vi.mock('../../src/routes/AdminOrganizations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/routes/AdminOrganizations.js')>();
  return {
    ...actual,
    AdminOrganizations: () => {
      if (thrown.admin) throw new Error('boom en Admin');
      return <actual.AdminOrganizations />;
    },
  };
});

vi.mock('../../src/routes/ProjectsDashboard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/routes/ProjectsDashboard.js')>();
  return {
    ...actual,
    ProjectsDashboard: () => {
      if (thrown.orgIndex) throw new Error('boom en Proyectos');
      return <actual.ProjectsDashboard />;
    },
  };
});

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

  describe('SDD-103 · el error de render se contiene dentro del chrome', () => {
    const CODE = /^ERR-[0-9A-F]{4}-[0-9A-F]{4}$/;
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(client, 'listOrganizations').mockResolvedValue([makeOrgSummary()]);
      vi.spyOn(client, 'getProjectsOverview').mockResolvedValue([makeProjectOverview()]);
      vi.spyOn(client, 'getSession').mockResolvedValue(null);
      vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
      vi.spyOn(client, 'queryWorkOrders').mockResolvedValue({
        items: [],
        total: 0,
        statusCounts: { all: 0, pending: 0, in_progress: 0, out_of_sync: 0, done: 0, archived: 0 },
      } as Awaited<ReturnType<typeof client.queryWorkOrders>>);
    });
    afterEach(() => {
      thrown.ordenes = false;
      thrown.admin = false;
      thrown.orgIndex = false;
    });

    function mountOrdenes() {
      thrown.ordenes = true;
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme/p/web/ordenes'] });
      render(<RouterProvider router={router} />);
      return router;
    }

    it('(a) project level: the sidebar survives and the plate explains it without leaking the engine error', async () => {
      mountOrdenes();

      expect(await screen.findByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
      const exits = within(screen.getByRole('navigation', { name: 'Destinos del proyecto' }));
      expect(exits.getByRole('link', { name: 'Ir a la Planta' }).getAttribute('href')).toBe('/o/acme/p/web');
      expect(exits.getByRole('link', { name: 'Ir a Documentos' }).getAttribute('href')).toBe('/o/acme/p/web/documents');
      const group = within(screen.getByRole('group', { name: 'Código del error' }));
      expect(group.getByText(CODE)).toBeTruthy();
      expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
      expect(screen.queryByText(/boom en Órdenes/)).toBeNull();
    });

    it('(b) logs the same code it shows, next to the real error', async () => {
      mountOrdenes();

      const code = (await screen.findByText(CODE)).textContent ?? '';
      expect(consoleError).toHaveBeenCalledWith(`[route-error] ${code}`, expect.any(Error));
    });

    it('(c) "Reintentar" redraws the real screen once the cause is gone', async () => {
      mountOrdenes();
      await screen.findByRole('heading', { name: 'No pudimos mostrar esta pantalla' });

      thrown.ordenes = false;
      await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

      expect(await screen.findByRole('heading', { name: 'Órdenes de trabajo' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeNull();
    });

    it('(d) navigating to another route of the shell clears the plate', async () => {
      const router = mountOrdenes();
      await screen.findByRole('heading', { name: 'No pudimos mostrar esta pantalla' });

      await router.navigate('/o/acme/p/web/ajustes/general');

      expect(await screen.findByRole('heading', { name: 'General' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeNull();
    });

    it('(e) org level: the org header survives and the exit goes to the org projects', async () => {
      thrown.orgIndex = true;
      const router = createMemoryRouter(routes, { initialEntries: ['/o/acme'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeTruthy();
      expect(screen.getByText('Acme')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Ver los proyectos de Acme' }).getAttribute('href')).toBe('/o/acme');
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
      expect(screen.queryByText(/boom en Proyectos/)).toBeNull();
    });

    it('(e) last resort: a failure outside any shell renders the plate with no navigation', async () => {
      thrown.admin = true;
      const router = createMemoryRouter(routes, { initialEntries: ['/admin'] });
      render(<RouterProvider router={router} />);

      expect(await screen.findByRole('heading', { name: 'No pudimos mostrar esta pantalla' })).toBeTruthy();
      expect(screen.getByText(CODE)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
      expect(screen.queryByRole('navigation')).toBeNull();
      expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
    });
  });
});
