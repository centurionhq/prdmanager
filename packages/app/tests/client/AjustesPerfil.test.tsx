import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { AjustesPerfil } from '../../src/routes/AjustesPerfil.js';

function renderAjustesPerfil() {
  const router = createMemoryRouter([{ path: '/perfil', element: <AjustesPerfil /> }], { initialEntries: ['/perfil'] });
  render(<RouterProvider router={router} />);
}

describe('AjustesPerfil (WO-432)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a set-once form when the caller has no handle yet', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'tano@example.com', name: 'Tano' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderAjustesPerfil();

    expect(await screen.findByLabelText('Handle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar handle' })).toBeTruthy();
  });

  it('shows the handle read-only once it is already set, with no form', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'tano@example.com', name: 'Tano' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: 'tano', workProfile: null });

    renderAjustesPerfil();

    expect(await screen.findByText('dev:tano')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar handle' })).toBeNull();
  });

  it('sets the handle and then displays it read-only', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'tano@example.com', name: 'Tano' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
    const setHandle = vi.spyOn(client, 'setProfileHandle').mockResolvedValue({ handle: 'tano' });

    renderAjustesPerfil();

    const input = await screen.findByLabelText('Handle');
    await userEvent.type(input, 'tano');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar handle' }));

    await waitFor(() => expect(setHandle).toHaveBeenCalledWith({ handle: 'tano' }));
    expect(await screen.findByText('dev:tano')).toBeTruthy();
  });

  it('surfaces a server error (e.g. handle already taken) without crashing', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'tano@example.com', name: 'Tano' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });
    vi.spyOn(client, 'setProfileHandle').mockRejectedValue(new client.ApiClientError(409, 'conflict', 'handle "tano" is not available'));

    renderAjustesPerfil();

    const input = await screen.findByLabelText('Handle');
    await userEvent.type(input, 'tano');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar handle' }));

    expect(await screen.findByText('handle "tano" is not available')).toBeTruthy();
  });

  it('muestra el Nombre como dato de solo lectura con la leyenda del Email (WO-608)', async () => {
    vi.spyOn(client, 'getSession').mockResolvedValue({ user: { id: 'u1', email: 'tano@example.com', name: 'Tano' } });
    vi.spyOn(client, 'getProfile').mockResolvedValue({ handle: null, workProfile: null });

    renderAjustesPerfil();

    const nombre = await screen.findByRole('group', { name: 'Nombre' });
    expect(within(nombre).getByText('Tano')).toBeTruthy();
    expect(within(nombre).getByText('No se puede cambiar')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Nombre' })).toBeNull();
  });
});
