import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { Login } from '../../src/routes/Login.js';

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '/', element: <p>home</p> },
    ],
    { initialEntries: ['/login'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('Login', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects submission with client-side validation before calling the API', async () => {
    const signIn = vi.spyOn(client, 'signInWithPassword');
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText(/email válido/)).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in and navigates to "/" on success', async () => {
    vi.spyOn(client, 'signInWithPassword').mockResolvedValue({ user: { id: 'u1', email: 'a@example.test', name: 'A' } });
    renderLogin();

    await userEvent.type(screen.getByLabelText('Email'), 'a@example.test');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'correct-horse-battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => expect(screen.getByText('home')).toBeTruthy());
  });

  it('shows the server error message when sign-in fails', async () => {
    const { ApiClientError } = client;
    vi.spyOn(client, 'signInWithPassword').mockRejectedValue(new ApiClientError(401, 'unauthorized', 'Invalid email or password'));
    renderLogin();

    await userEvent.type(screen.getByLabelText('Email'), 'a@example.test');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Invalid email or password');
  });

  it('switches to the TOTP step when the server reports twoFactorRedirect', async () => {
    vi.spyOn(client, 'signInWithPassword').mockResolvedValue({ twoFactorRedirect: true });
    const verifyTotp = vi.spyOn(client, 'verifyTotpCode').mockResolvedValue({ user: { id: 'u1', email: 'root@example.test', name: 'Root' } });
    renderLogin();

    await userEvent.type(screen.getByLabelText('Email'), 'root@example.test');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'correct-horse-battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByLabelText('Código')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Código'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));

    await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(screen.getByText('home')).toBeTruthy());
  });
});
