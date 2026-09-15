import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { AjustesGeneral } from '../../src/routes/AjustesGeneral.js';
import { AjustesPerfil } from '../../src/routes/AjustesPerfil.js';
import { EntradaPlaceholder } from '../../src/routes/EntradaPlaceholder.js';
import { NotFound } from '../../src/routes/NotFound.js';
import { OrdenesPlaceholder } from '../../src/routes/OrdenesPlaceholder.js';
import { PlantaPlaceholder } from '../../src/routes/PlantaPlaceholder.js';
import { makeProjectShellContext } from './fixtures.js';

function renderWithProjectContext(element: React.ReactElement) {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner')} />, children: [{ index: true, element }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('placeholder screens', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Planta shows a placeholder empty state', () => {
    renderWithProjectContext(<PlantaPlaceholder />);
    expect(screen.getByRole('heading', { name: 'Planta' })).toBeTruthy();
  });

  it('Ordenes shows a placeholder empty state', () => {
    renderWithProjectContext(<OrdenesPlaceholder />);
    expect(screen.getByRole('heading', { name: 'Órdenes de trabajo' })).toBeTruthy();
  });

  it('Entrada shows a placeholder empty state', () => {
    renderWithProjectContext(<EntradaPlaceholder />);
    expect(screen.getByRole('heading', { name: 'Bandeja de entrada' })).toBeTruthy();
  });

  it('NotFound renders a plain 404 message', () => {
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/nope', element: <NotFound /> }], { initialEntries: ['/nope'] })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
  });

  it('AjustesGeneral shows the real project identity', () => {
    renderWithProjectContext(<AjustesGeneral />);
    expect(screen.getByRole('heading', { name: 'Web' })).toBeTruthy();
    expect(screen.getByText('Acme', { exact: false })).toBeTruthy();
  });

  it('AjustesPerfil signs out and navigates to /login', async () => {
    const signOut = vi.spyOn(client, 'signOut').mockResolvedValue(undefined);
    const router = createMemoryRouter(
      [
        { path: '/ctx', element: <Outlet context={makeProjectShellContext('owner')} />, children: [{ index: true, element: <AjustesPerfil /> }] },
        { path: '/login', element: <p>login screen</p> },
      ],
      { initialEntries: ['/ctx'] },
    );
    render(<RouterProvider router={router} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('login screen')).toBeTruthy();
  });
});
