import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Guardar cambios' });
}

/** The toast region is also role="status", so status messages are found by content. */
function findStatusContaining(text: string): HTMLElement {
  const match = screen.getAllByRole('status').find((element) => element.textContent?.includes(text));
  if (!match) throw new Error(`No status region contains "${text}"`);
  return match;
}

describe('SsoPage', () => {
  it('renders the section title and description', () => {
    renderAt('/ajustes/sso');
    expect(screen.getByRole('heading', { level: 2, name: 'Autenticación y SSO' })).toBeTruthy();
    expect(
      screen.getByText('Cómo entra la gente de Centurion HQ. Aplica a todos los proyectos de la organización.'),
    ).toBeTruthy();
  });

  it('starts on OIDC with the Okta fields and disables Guardar cambios', () => {
    renderAt('/ajustes/sso');
    expect(screen.getByRole('radio', { name: 'OIDC' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('https://centurionhq.okta.com')).toBeTruthy();
    expect(screen.getByText('0oa8f2c1d4kq7Zm3x697')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reemplazar' })).toBeTruthy();
    expect(saveButton().hasAttribute('disabled')).toBe(true);
  });

  it('switches to SAML fields, marking the form dirty', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/sso');

    await user.click(screen.getByRole('radio', { name: 'SAML 2.0' }));

    expect(screen.getByRole('textbox', { name: 'Metadata URL' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Entity ID' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subí el certificado X.509' })).toBeTruthy();
    expect(saveButton().hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy();
  });

  it('shows verified and pending domains with the right status', () => {
    renderAt('/ajustes/sso');
    const verifiedRow = screen.getByText('centurionhq.com').closest('tr');
    if (!verifiedRow) throw new Error('verified row missing');
    expect(within(verifiedRow).getByText('Verificado')).toBeTruthy();

    const pendingRow = screen.getByText('centurion.dev').closest('tr');
    if (!pendingRow) throw new Error('pending row missing');
    expect(within(pendingRow).getByText('Pendiente de verificación')).toBeTruthy();
  });

  it('expands the pending domain to show the TXT record and lets you retry verification', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/sso');

    await user.click(screen.getByRole('button', { name: /centurion\.dev/ }));
    expect(screen.getByText(/prdm-verify=4f1c9e/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Verificar ahora' }));
    expect(
      await screen.findByText('Todavía no encontramos el registro TXT. Puede tardar hasta una hora.'),
    ).toBeTruthy();
  });

  it('reflects the initial access rules and reveals the default role while JIT is on', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/sso');

    expect(screen.getByRole('switch', { name: 'Exigir SSO para todos los miembros' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      screen.getByRole('switch', { name: 'Crear cuentas automáticamente al primer ingreso (JIT)' }).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Rol por defecto en la organización' })).toBeTruthy();

    await user.click(
      screen.getByRole('switch', { name: 'Crear cuentas automáticamente al primer ingreso (JIT)' }),
    );
    expect(screen.queryByRole('combobox', { name: 'Rol por defecto en la organización' })).toBeNull();
    expect(saveButton().hasAttribute('disabled')).toBe(false);
  });

  it('tests the connection and shows the success status', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/sso');

    await user.click(screen.getByRole('button', { name: 'Probar conexión' }));
    expect(findStatusContaining('Conexión correcta. Okta devolvió ana.rios@centurionhq.com')).toBeTruthy();
  });

  it('saves changes, shows a toast and disables the button again', async () => {
    const user = userEvent.setup();
    renderAt('/ajustes/sso');

    await user.click(screen.getByRole('switch', { name: 'Permitir email y contraseña para admins de emergencia' }));
    expect(saveButton().hasAttribute('disabled')).toBe(false);

    await user.click(saveButton());
    expect(await screen.findByText('Guardado')).toBeTruthy();
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();
  });
});
