import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AjustesLayout } from '../../src/routes/AjustesLayout.js';
import { makeProjectShellContext } from './fixtures.js';

function renderLayout(initialPath: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/o/:orgSlug/p/:projectSlug/ajustes',
        element: <Outlet context={makeProjectShellContext('owner')} />,
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

    const project = screen.getByRole('group', { name: 'Proyecto Web' });
    expect(within(project).getAllByRole('link').map((a) => a.textContent)).toEqual(['General', 'Miembros', 'Tokens de CI', 'Auditoría']);
    const account = screen.getByRole('group', { name: 'Tu cuenta' });
    expect(within(account).getAllByRole('link').map((a) => a.textContent)).toEqual(['Perfil', 'Tokens personales']);
  });

  it('offers only destinations that exist: no SSO, no integrations, none of the organisation screens (FB-035)', () => {
    renderLayout('/o/acme/p/web/ajustes/general');

    for (const name of [/SSO/i, /Integraciones/i, /Miembros de la organización/i]) expect(screen.queryByRole('link', { name })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Ajustes' })).getAllByRole('link')).toHaveLength(6);
  });

  it('every destination keeps the route it had, so no link anywhere else in the app breaks', () => {
    renderLayout('/o/acme/p/web/ajustes/general');

    const hrefs = within(screen.getByRole('navigation', { name: 'Ajustes' })).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/o/acme/p/web/ajustes/general',
      '/o/acme/p/web/ajustes/miembros',
      '/o/acme/p/web/ajustes/tokens',
      '/o/acme/p/web/ajustes/auditoria',
      '/o/acme/p/web/ajustes/perfil',
      '/o/acme/p/web/ajustes/tokens-personales',
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
});
