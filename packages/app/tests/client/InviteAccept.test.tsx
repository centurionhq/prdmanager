import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { InviteAccept } from '../../src/routes/InviteAccept.js';

function renderInvite(path: string, hash: string) {
  window.location.hash = hash;
  const router = createMemoryRouter(
    [
      { path: '/invite/:id', element: <InviteAccept /> },
      { path: '/', element: <p>home</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

describe('InviteAccept', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('shows an "invalid link" message when the fragment has no secret', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    renderInvite('/invite/inv_1', '');

    expect(await screen.findByText('Enlace inválido')).toBeTruthy();
  });

  it('asks for name and password for a signed-out visitor, and validates them', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    const accept = vi.spyOn(client, 'acceptInvitation');
    renderInvite('/invite/inv_1', '#s=topsecret');

    expect(await screen.findByLabelText('Nombre')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Creá tu cuenta' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }));
    expect(await screen.findByText(/Ingresá tu nombre/)).toBeTruthy();
    expect(accept).not.toHaveBeenCalled();
  });

  it('accepts as a new user with name+password and never leaks the secret in a URL', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue(null);
    const accept = vi.spyOn(client, 'acceptInvitation').mockResolvedValue({ userId: 'u1', organizationId: 'org1' });
    renderInvite('/invite/inv_1', '#s=topsecret');

    await screen.findByLabelText('Nombre');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Jane Doe');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'correct-horse-battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }));

    await waitFor(() => expect(accept).toHaveBeenCalledWith('inv_1', { secret: 'topsecret', name: 'Jane Doe', password: 'correct-horse-battery-staple' }));
    expect(await screen.findByText('Invitación aceptada')).toBeTruthy();
  });

  it('only needs a confirm click for an already signed-in user', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'a@example.test', name: 'A' } });
    const accept = vi.spyOn(client, 'acceptInvitation').mockResolvedValue({ userId: 'u1', organizationId: 'org1' });
    renderInvite('/invite/inv_1', '#s=topsecret');

    await screen.findByText(/Ya iniciaste sesión/);
    expect(screen.queryByLabelText('Nombre')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión y aceptar' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('inv_1', { secret: 'topsecret' }));
  });
});
