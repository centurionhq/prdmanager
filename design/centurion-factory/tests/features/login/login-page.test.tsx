import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../src/router';

function renderLogin() {
  const router = createMemoryRouter(routes, { initialEntries: ['/login'] });
  render(<RouterProvider router={router} />);
  return router;
}

/** The toast region is always mounted with role="status", so status messages are scoped by text. */
function expectStatusMessage(text: string): void {
  const message = screen.getByText(text);
  expect(message.closest('[role="status"]')).toBeTruthy();
}

// Guards against a failed assertion leaving fake timers active for later tests.
afterEach(() => {
  vi.useRealTimers();
});

describe('LoginPage: SSO mode (default)', () => {
  it('renders the wordmark, heading and subtitle', () => {
    renderLogin();
    expect(screen.getByText('Centurion Factory')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Entrá a tu organización' })).toBeTruthy();
    expect(screen.getByText('El acceso es solo por invitación.')).toBeTruthy();
  });

  it('renders exactly one h1 on the page', () => {
    renderLogin();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders the footer lines from the canvas', () => {
    renderLogin();
    expect(screen.getByText('¿Te invitaron? Abrí el enlace del email para crear tu cuenta.')).toBeTruthy();
    expect(screen.getByText('Centurion Factory · prdmanager 0.2.0')).toBeTruthy();
  });

  it('shows a validation message when submitting without an email', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Continuar con SSO' }));
    expect(screen.getByText('Escribí tu email de trabajo.')).toBeTruthy();
  });

  it('marks #sso-email invalid and describes it by the validation error (WO-317)', async () => {
    const user = userEvent.setup();
    renderLogin();
    const emailField = screen.getByRole('textbox', { name: 'Email de trabajo' });
    expect(emailField.getAttribute('aria-invalid')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Continuar con SSO' }));

    const error = screen.getByText('Escribí tu email de trabajo.');
    expect(emailField.id).toBe('sso-email');
    expect(emailField.getAttribute('aria-invalid')).toBe('true');
    expect(emailField.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('shows the Okta redirect status and navigates to /proyectos after 1200ms for a centurionhq.com email', async () => {
    const user = userEvent.setup();
    const router = renderLogin();
    await user.type(screen.getByRole('textbox', { name: 'Email de trabajo' }), 'ana.rios@centurionhq.com');

    vi.useFakeTimers();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuar con SSO' }));
    });

    expectStatusMessage('Redirigiendo a Okta de Centurion HQ…');
    expect(router.state.location.pathname).toBe('/login');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(router.state.location.pathname).toBe('/proyectos');
    vi.useRealTimers();
  });

  it('tells the user their domain has no SSO configured for any other domain', async () => {
    const user = userEvent.setup();
    const router = renderLogin();

    await user.type(screen.getByRole('textbox', { name: 'Email de trabajo' }), 'foo@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Continuar con SSO' }));

    expect(
      screen.getByText(
        'Tu organización no tiene SSO configurado para gmail.com. Entrá con email y contraseña o pedile acceso a tu admin.',
      ),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows the same redirect status when continuing with Google Workspace', () => {
    const router = renderLogin();
    vi.useFakeTimers();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google Workspace' }));
    });
    expectStatusMessage('Redirigiendo a Google Workspace…');

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(router.state.location.pathname).toBe('/proyectos');
    vi.useRealTimers();
  });

  it('shows the same redirect status when continuing with Microsoft Entra ID', () => {
    renderLogin();
    vi.useFakeTimers();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuar con Microsoft Entra ID' }));
    });
    expectStatusMessage('Redirigiendo a Microsoft Entra ID…');
    vi.useRealTimers();
  });

  it('moves focus to the password mode email field when switching modes', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Usar email y contraseña' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email' }));
  });
});

describe('LoginPage: password mode', () => {
  async function switchToPassword() {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Usar email y contraseña' }));
    return user;
  }

  it('toggles the password visibility with an aria-pressed control', async () => {
    const user = await switchToPassword();
    const toggle = screen.getByRole('button', { name: 'Mostrar' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Contraseña').getAttribute('type')).toBe('password');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Ocultar' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Contraseña').getAttribute('type')).toBe('text');
  });

  it('shows a toast when asking to reset the password', async () => {
    const user = await switchToPassword();
    await user.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
    expect(await screen.findByText('Te mandamos un enlace para restablecerla')).toBeTruthy();
  });

  it('shows an error and marks the password field invalid on wrong credentials', async () => {
    const user = await switchToPassword();
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ana.rios@centurionhq.com');
    await user.type(screen.getByLabelText('Contraseña'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('Email o contraseña incorrectos. Revisá los datos o pedí un nuevo acceso a tu admin.');
    expect(screen.getByLabelText('Contraseña').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Contraseña').getAttribute('aria-describedby')).toBe(error.id);
    expect(screen.getByRole('textbox', { name: 'Email' }).getAttribute('aria-describedby')).toBe(error.id);
  });

  it('navigates to /proyectos with the demo credentials', async () => {
    const user = await switchToPassword();
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'ana.rios@centurionhq.com');
    await user.type(screen.getByLabelText('Contraseña'), 'centurion');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Proyectos' })).toBeTruthy();
  });

  it('moves focus back to the SSO email field when switching back', async () => {
    const user = await switchToPassword();
    await user.click(screen.getByRole('button', { name: 'Volver al acceso con SSO' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Email de trabajo' }));
  });
});
