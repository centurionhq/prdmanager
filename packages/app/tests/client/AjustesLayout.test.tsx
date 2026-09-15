import { render, screen } from '@testing-library/react';
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

  it('switches to the miembros screen for that path', () => {
    renderLayout('/o/acme/p/web/ajustes/miembros');

    expect(screen.getByText('pantalla miembros')).toBeTruthy();
  });
});
