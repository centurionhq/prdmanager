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

  describe('pedir acceso', () => {
    const NEXT = buildLoginRedirectUrl('/o/centurionhq/p/prdmanager/planta');

    async function openRequestStep() {
      renderLogin(NEXT);
      await userEvent.click(screen.getByRole('button', { name: 'Pedir acceso a centurionhq' }));
      await screen.findByRole('heading', { name: 'Pedí acceso a centurionhq' });
    }

    it('offers the action only with a known organization', () => {
      renderLogin(NEXT);
      expect(screen.getByRole('button', { name: 'Pedir acceso a centurionhq' })).toBeTruthy();
    });

    it.each([
      ['no next', '/login'],
      ['an absolute next', '/login?next=https%3A%2F%2Fevil.com%2Fo%2Fcenturionhq'],
      ['a protocol-relative next', '/login?next=%2F%2Fevil.com%2Fo%2Fcenturionhq'],
    ])('has no access action with %s', (_label, entry) => {
      renderLogin(entry);
      expect(screen.queryByRole('button', { name: /Pedir acceso/ })).toBeNull();
    });

    it('shows a confirmation that never promises an email reply', async () => {
      const create = vi.spyOn(client, 'createAccessRequest').mockResolvedValue({ ok: true });
      await openRequestStep();

      await userEvent.type(screen.getByLabelText('Email'), 'nueva@example.test');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

      await waitFor(() => expect(create).toHaveBeenCalledWith('centurionhq', { email: 'nueva@example.test' }));
      const status = await screen.findByRole('status');
      expect(status.textContent).toContain('quedó registrado');
      expect(status.textContent).toContain('Ajustes → Miembros');
      expect(status.textContent).not.toMatch(/te escrib|respuesta por email|plazo/i);
      expect(status.textContent).not.toContain('nueva@example.test');
    });

    it('sends name and message only when they have content', async () => {
      const create = vi.spyOn(client, 'createAccessRequest').mockResolvedValue({ ok: true });
      await openRequestStep();

      await userEvent.type(screen.getByLabelText('Email'), 'nueva@example.test');
      await userEvent.type(screen.getByLabelText('Nombre (opcional)'), 'Nueva Persona');
      await userEvent.type(screen.getByLabelText('Mensaje (opcional)'), 'Necesito entrar');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

      await waitFor(() =>
        expect(create).toHaveBeenCalledWith('centurionhq', { email: 'nueva@example.test', name: 'Nueva Persona', message: 'Necesito entrar' }),
      );
    });

    it('does not call the API with an invalid email', async () => {
      const create = vi.spyOn(client, 'createAccessRequest').mockResolvedValue({ ok: true });
      await openRequestStep();

      await userEvent.type(screen.getByLabelText('Email'), 'no-es-un-email');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

      expect(await screen.findByText('Ingresá un email válido.')).toBeTruthy();
      expect(create).not.toHaveBeenCalled();
    });

    it('shows the server error tied to the form and keeps what was typed', async () => {
      vi.spyOn(client, 'createAccessRequest').mockRejectedValue(new client.ApiClientError(500, 'unknown', 'no pudimos registrar tu pedido'));
      await openRequestStep();

      await userEvent.type(screen.getByLabelText('Email'), 'nueva@example.test');
      await userEvent.click(screen.getByRole('button', { name: 'Enviar pedido' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('no pudimos registrar tu pedido');
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('nueva@example.test');
    });

    it('goes back to the credentials step with "Volver"', async () => {
      await openRequestStep();

      await userEvent.click(screen.getByRole('button', { name: 'Volver' }));

      expect(await screen.findByRole('button', { name: 'Entrar' })).toBeTruthy();
    });
  });
});
