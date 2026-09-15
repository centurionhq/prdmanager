import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('AjustesLayout', () => {
  it('renders the Ajustes title and subtitle as the only h1', () => {
    // A section with no screen yet (AjustesPlaceholderPage) so a not-yet-rebuilt sibling
    // placeholder's own <h1> (e.g. MiembrosPage before WO-305) does not create a false failure.
    renderAt('/ajustes/general');
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeTruthy();
    expect(screen.getByText('Proyecto prdmanager, organización Centurion HQ y tu cuenta')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('groups the sub-nav by project, organization and account', () => {
    renderAt('/ajustes/miembros');
    const nav = screen.getByRole('navigation', { name: 'Ajustes' });
    expect(within(nav).getByText('Proyecto prdmanager')).toBeTruthy();
    expect(within(nav).getByText('Centurion HQ')).toBeTruthy();
    expect(within(nav).getByText('Tu cuenta')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'General' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Miembros de la organización' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Tokens personales' })).toBeTruthy();
  });

  it('marks the current settings section with aria-current', () => {
    renderAt('/ajustes/tokens');
    const nav = screen.getByRole('navigation', { name: 'Ajustes' });
    expect(within(nav).getByRole('link', { name: 'Tokens de CI' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Miembros' }).getAttribute('aria-current')).toBeNull();
  });

  it('redirects /ajustes to the members settings', () => {
    const router = renderAt('/ajustes');
    expect(router.state.location.pathname).toBe('/ajustes/miembros');
  });

  it('renders a placeholder for sections that are not designed yet, with a way back', async () => {
    const user = userEvent.setup();
    const router = renderAt('/ajustes/general');
    expect(screen.getByText('Esta sección todavía no está diseñada.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Volver a Miembros' }));
    expect(router.state.location.pathname).toBe('/ajustes/miembros');
  });

  it('renders a placeholder for every undesigned section', () => {
    for (const path of [
      '/ajustes/general',
      '/ajustes/integraciones',
      '/ajustes/miembros-organizacion',
      '/ajustes/auditoria',
      '/ajustes/perfil',
      '/ajustes/tokens-personales',
    ]) {
      renderAt(path);
      expect(screen.getByText('Esta sección todavía no está diseñada.')).toBeTruthy();
      cleanup();
    }
  });
});
