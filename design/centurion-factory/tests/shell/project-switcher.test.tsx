import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('sidebar project switcher and settings', () => {
  it('shows the current organization and project and links to project selection', () => {
    renderAt('/');
    const nav = screen.getByRole('complementary');
    const switcher = within(nav).getByRole('link', { name: 'Cambiar de proyecto. Actual: prdmanager en Centurion HQ' });
    expect(switcher.getAttribute('href')).toBe('/proyectos');
  });

  it('keeps Ajustes active on every settings route', () => {
    renderAt('/ajustes/tokens');
    const settings = within(screen.getByRole('complementary')).getByRole('link', { name: 'Ajustes' });
    expect(settings.getAttribute('aria-current')).toBe('page');
  });

  it('redirects /ajustes to the members settings', () => {
    const router = renderAt('/ajustes');
    expect(router.state.location.pathname).toBe('/ajustes/miembros');
  });
});

describe('mobile bottom bar', () => {
  it('lists Planta, Árbol, Docs, Órdenes, Drift and a Más menu', () => {
    renderAt('/');
    const bar = screen.getByRole('navigation', { name: 'Navegación móvil' });
    const labels = within(bar).getAllByRole('link').map((link) => link.textContent);
    expect(labels).toEqual(['Planta', 'Árbol', 'Docs', 'Órdenes', 'Drift']);
    expect(within(bar).getByRole('button', { name: 'Más' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('only sets aria-controls on the Más button while its sheet is open (WO-317)', () => {
    renderAt('/');
    const bar = screen.getByRole('navigation', { name: 'Navegación móvil' });
    const more = within(bar).getByRole('button', { name: 'Más' });
    expect(more.getAttribute('aria-controls')).toBeNull();
  });

  it('opens Más with the remaining destinations and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const bar = screen.getByRole('navigation', { name: 'Navegación móvil' });
    const more = within(bar).getByRole('button', { name: 'Más' });
    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('list', { name: 'Más destinos' });
    expect(more.getAttribute('aria-controls')).toBe(menu.id);
    expect(within(menu).getByRole('link', { name: 'Bandeja de entrada' })).toBeTruthy();
    expect(within(menu).getByRole('link', { name: 'Ajustes' })).toBeTruthy();
    expect(within(menu).getByRole('link', { name: 'Cambiar de proyecto' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
  });
});
