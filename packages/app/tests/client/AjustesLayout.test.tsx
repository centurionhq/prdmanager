import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { can, ORG_ROLES, PROJECT_ROLES, type PermissionAction } from '@prdm/contracts';
import { AjustesLayout } from '../../src/routes/AjustesLayout.js';
import type { ProjectShellContext } from '../../src/routes/ProjectShell.js';
import { makeProjectShellContext } from './fixtures.js';

/**
 * SDD-089 §D6 (WO-698) decides every project destination from `can(subject, …)`. The three actions
 * involved (`manage_members`, `manage_ci_tokens`, `manage_project_settings`) are admin-only in today's
 * matrix, so no *real* subject holds exactly one of them — the only way to pin which action each
 * destination is wired to is to answer that one predicate ourselves, leaving every other export of
 * `@prdm/contracts` (schemas, `PROJECT_ROLES`, …) as it really is. `afterEach` puts the real `can` back.
 */
vi.mock('@prdm/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prdm/contracts')>();
  return { ...actual, can: vi.fn(actual.can) };
});

afterEach(async () => {
  const actual = await vi.importActual<typeof import('@prdm/contracts')>('@prdm/contracts');
  vi.mocked(can).mockImplementation(actual.can);
});

function renderLayout(initialPath: string, context: ProjectShellContext = makeProjectShellContext('owner')) {
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug/ajustes',
        element: <Outlet context={context} />,
        children: [
          {
            path: '',
            element: <AjustesLayout />,
            children: [
              { path: 'general', element: <p>pantalla general</p> },
              { path: 'miembros', element: <p>pantalla miembros</p> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
}

function ajustesNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Ajustes' });
}

/** The visible labels of one group, in the order the nav draws them. */
function labelsOf(title: string): (string | null)[] {
  return within(within(ajustesNav()).getByRole('group', { name: title }))
    .getAllByRole('link')
    .map((link) => link.textContent);
}

const PROJECT_DESTINATIONS = ['General', 'Miembros', 'Tokens de CI', 'Auditoría'];

describe('AjustesLayout', () => {
  it('renders the project/org header, sub-nav and the active screen', () => {
    renderLayout('/o/acme/p/web/ajustes/general');

    expect(screen.getByRole('heading', { name: 'Ajustes' })).toBeTruthy();
    expect(screen.getByText('Proyecto Web, organización Acme')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Ajustes' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Miembros' })).toBeTruthy();
    expect(screen.getByText('pantalla general')).toBeTruthy();
  });

  it('groups the destinations the way the approved canvas does: the project first, then your account (WO-578)', () => {
    renderLayout('/o/acme/p/web/ajustes/general');

    expect(labelsOf('Proyecto Web')).toEqual(PROJECT_DESTINATIONS);
    expect(labelsOf('Tu cuenta')).toEqual(['Perfil', 'Tokens personales']);
  });

  it('offers only destinations that exist: no SSO, no integrations, none of the organisation screens (FB-035)', () => {
    renderLayout('/o/acme/p/web/ajustes/general');

    for (const name of [/SSO/i, /Integraciones/i, /Miembros de la organización/i]) expect(screen.queryByRole('link', { name })).toBeNull();
    expect(within(ajustesNav()).getAllByRole('link')).toHaveLength(6);
  });

  it('points the account group at the organization-level screens, where those two now live (SDD-089/WO-697)', () => {
    renderLayout('/o/acme/p/web/ajustes/general');

    const hrefs = within(ajustesNav()).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/o/acme/p/web/ajustes/general',
      '/o/acme/p/web/ajustes/miembros',
      '/o/acme/p/web/ajustes/tokens',
      '/o/acme/p/web/ajustes/auditoria',
      '/o/acme/ajustes/perfil',
      '/o/acme/ajustes/tokens-personales',
    ]);
  });

  it('marks the screen you are on', () => {
    renderLayout('/o/acme/p/web/ajustes/miembros');

    expect(screen.getByRole('link', { name: 'Miembros' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBeNull();
  });

  it('switches to the miembros screen for that path', () => {
    renderLayout('/o/acme/p/web/ajustes/miembros');

    expect(screen.getByText('pantalla miembros')).toBeTruthy();
  });

  it('with a viewer on the project offers only General and the account, never a destination that answers "no tenés permiso" (SDD-089 §D6, WO-698)', () => {
    renderLayout('/o/acme/p/web/ajustes/general', makeProjectShellContext('member', 'viewer'));

    for (const name of ['Miembros', 'Tokens de CI', 'Auditoría']) expect(screen.queryByRole('link', { name })).toBeNull();
    expect(labelsOf('Proyecto Web')).toEqual(['General']);
    expect(labelsOf('Tu cuenta')).toEqual(['Perfil', 'Tokens personales']);
    expect(within(ajustesNav()).getAllByRole('link')).toHaveLength(3);
  });

  it('keeps the four project destinations for a project admin — and for an org owner, who inherits admin (WO-698)', () => {
    renderLayout('/o/acme/p/web/ajustes/general', makeProjectShellContext('member', 'admin'));
    expect(labelsOf('Proyecto Web')).toEqual(PROJECT_DESTINATIONS);

    cleanup();
    renderLayout('/o/acme/p/web/ajustes/general', makeProjectShellContext('owner', 'viewer'));
    expect(labelsOf('Proyecto Web')).toEqual(PROJECT_DESTINATIONS);
  });

  it('offers each project destination from its own permission, not from the permission all three happen to share today (WO-698)', () => {
    const destinations: readonly (readonly [PermissionAction, string])[] = [
      ['manage_members', 'Miembros'],
      ['manage_ci_tokens', 'Tokens de CI'],
      ['manage_project_settings', 'Auditoría'],
    ];

    for (const [granted, label] of destinations) {
      vi.mocked(can).mockImplementation((_subject, asked) => asked === granted);
      renderLayout('/o/acme/p/web/ajustes/general', makeProjectShellContext('member', 'viewer'));

      expect(labelsOf('Proyecto Web')).toEqual(['General', label]);
      cleanup();
    }
  });

  it('never draws an empty group: the project group keeps its title when General is all that is left (WO-698)', () => {
    for (const orgRole of ORG_ROLES) {
      for (const myRole of PROJECT_ROLES) {
        renderLayout('/o/acme/p/web/ajustes/general', makeProjectShellContext(orgRole, myRole));

        for (const group of within(ajustesNav()).getAllByRole('group')) {
          expect(within(group).getAllByRole('link').length).toBeGreaterThan(0);
        }
        expect(within(ajustesNav()).getByRole('group', { name: 'Tu cuenta' })).toBeTruthy();
        expect(labelsOf('Proyecto Web')[0]).toBe('General');
        expect(labelsOf('Tu cuenta')).toHaveLength(2);

        cleanup();
      }
    }
  });
});
