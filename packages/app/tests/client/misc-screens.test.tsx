import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { AjustesGeneral } from '../../src/routes/AjustesGeneral.js';
import { AjustesPerfil } from '../../src/routes/AjustesPerfil.js';
import { NotFound } from '../../src/routes/NotFound.js';
import { makeProjectShellContext } from './fixtures.js';

function renderWithProjectContext(element: React.ReactElement) {
  const router = createMemoryRouter(
    [{ path: '/ctx', element: <Outlet context={makeProjectShellContext('owner')} />, children: [{ index: true, element }] }],
    { initialEntries: ['/ctx'] },
  );
  render(<RouterProvider router={router} />);
}

describe('misc screens', () => {
  afterEach(() => vi.restoreAllMocks());

  it('NotFound renders a plain 404 message', () => {
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/nope', element: <NotFound /> }], { initialEntries: ['/nope'] })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Esta dirección no existe' })).toBeTruthy();
  });

  it('AjustesGeneral shows the real project identity', () => {
    renderWithProjectContext(<AjustesGeneral />);
    // SDD-056: the identity is now read-only fields under their labels, no longer a heading with the name.
    expect(within(screen.getByRole('group', { name: 'Proyecto' })).getByText('Web')).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Organización' })).getByText('Acme')).toBeTruthy();
  });

  it('AjustesPerfil shows the name and a read-only email, then signs out and navigates to /login', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'ana@example.test', name: 'Ana' } });
    const signOut = vi.spyOn(client, 'signOut').mockResolvedValue(undefined);
    const router = createMemoryRouter(
      [
        { path: '/ctx', element: <Outlet context={makeProjectShellContext('owner')} />, children: [{ index: true, element: <AjustesPerfil /> }] },
        { path: '/login', element: <p>login screen</p> },
      ],
      { initialEntries: ['/ctx'] },
    );
    render(<RouterProvider router={router} />);

    expect(within(await screen.findByRole('group', { name: 'Nombre' })).getByText('Ana')).toBeTruthy();
    const email = screen.getByRole('group', { name: 'Email' });
    expect(within(email).getByText('ana@example.test')).toBeTruthy();
    expect(within(email).getByText('No se puede cambiar')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('login screen')).toBeTruthy();
  });
});
