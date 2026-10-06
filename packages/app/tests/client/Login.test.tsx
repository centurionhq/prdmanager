import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLoginRedirectUrl } from '../../src/api/request.js';
import * as client from '../../src/api/client.js';
import { Login } from '../../src/routes/Login.js';

function renderLogin(initialEntry = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '/', element: <p>home</p> },
    ],
    { initialEntries: [initialEntry] },
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

  describe('destination', () => {
    const GENERIC_SUBTITLE = 'Entrá con tu cuenta para ver tus organizaciones.';

    it('names organization and project from next', () => {
      renderLogin(buildLoginRedirectUrl('/o/centurionhq/p/prdmanager/planta'));

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Entrá a centurionhq');
      expect(screen.getByText('Vas a entrar al proyecto prdmanager de la organización centurionhq.')).toBeTruthy();
    });

    it('names only the organization when next has no project', () => {
      renderLogin(buildLoginRedirectUrl('/o/centurionhq/ajustes/miembros'));

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Entrá a centurionhq');
      expect(screen.getByText('Vas a entrar a la organización centurionhq.')).toBeTruthy();
    });

    it.each([
      ['no next', '/login'],
      ['an absolute next', '/login?next=https%3A%2F%2Fevil.com%2Fo%2Fcenturionhq'],
      ['a protocol-relative next', '/login?next=%2F%2Fevil.com%2Fo%2Fcenturionhq'],
    ])('stays generic with %s', (_label, entry) => {
      renderLogin(entry);

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Entrá a tu organización');
      expect(screen.getByText(GENERIC_SUBTITLE)).toBeTruthy();
    });

    it('footer carries no internal tool name or version', () => {
      // Rendered with the destination on purpose: `prdmanager` names the *project* on screen, and the
      // point of R3 is that the footer never picks it (or a version) up.
      renderLogin(buildLoginRedirectUrl('/o/centurionhq/p/prdmanager/planta'));

      const text = screen.getByRole('contentinfo').textContent ?? '';
      expect(text).not.toMatch(/prdmanager/);
      expect(text).not.toMatch(/\d+\.\d+\.\d+/);
      expect(text).toContain('Centurion Factory');
      expect(text).toContain('El acceso es por invitación: si todavía no tenés cuenta, pedile a quien te compartió el enlace que te invite.');
    });
  });
});
