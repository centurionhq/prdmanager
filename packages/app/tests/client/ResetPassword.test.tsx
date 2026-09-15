import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as client from '../../src/api/client.js';
import { ResetPassword } from '../../src/routes/ResetPassword.js';

function renderAt(initialEntry: string) {
  const router = createMemoryRouter([{ path: '/reset-password', element: <ResetPassword /> }], { initialEntries: [initialEntry] });
  render(<RouterProvider router={router} />);
}

describe('ResetPassword', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the request form without a token and validates the email first', async () => {
    const requestReset = vi.spyOn(client, 'requestPasswordReset');
    renderAt('/reset-password');

    expect(screen.getByRole('heading', { name: 'Restablecer contraseña' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(await screen.findByText(/email válido/)).toBeTruthy();
    expect(requestReset).not.toHaveBeenCalled();
  });

  it('sends a request with redirectTo pointed at this same page and shows a generic confirmation', async () => {
    const requestReset = vi.spyOn(client, 'requestPasswordReset').mockResolvedValue({ status: true, message: 'ok' });
    renderAt('/reset-password');

    await userEvent.type(screen.getByLabelText('Email'), 'a@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    expect(await screen.findByText(/Revisá tu email/)).toBeTruthy();
    expect(requestReset).toHaveBeenCalledWith('a@example.test', expect.stringContaining('/reset-password'));
  });

  it('shows the completion form with a token in the URL and validates password length + confirmation', async () => {
    renderAt('/reset-password?token=tok123');

    expect(screen.getByRole('heading', { name: 'Elegí una nueva contraseña' })).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'short');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(/Mínimo 12 caracteres/)).toBeTruthy();
    expect(screen.getByText(/no coinciden/)).toBeTruthy();
  });

  it('completes the reset and shows a success screen', async () => {
    const complete = vi.spyOn(client, 'completePasswordReset').mockResolvedValue({ status: true });
    renderAt('/reset-password?token=tok123');

    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'a-brand-new-password');
    await userEvent.type(screen.getByLabelText('Confirmar contraseña'), 'a-brand-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Contraseña actualizada')).toBeTruthy();
    expect(complete).toHaveBeenCalledWith('tok123', 'a-brand-new-password');
  });
});
