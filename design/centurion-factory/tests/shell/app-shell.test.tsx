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

describe('AppShell', () => {
  it('offers a skip link to the main content', () => {
    renderAt('/');
    const skip = screen.getByRole('link', { name: 'Saltar al contenido' });
    expect(skip.getAttribute('href')).toBe('#contenido');
    expect(screen.getByRole('main').id).toBe('contenido');
  });

  it('marks the current section in the desktop sidebar', () => {
    renderAt('/ordenes');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Órdenes de trabajo' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Planta' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps Documentos active on a document detail route', () => {
    renderAt('/documentos/SDD-011');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByRole('link', { name: 'Documentos' }).getAttribute('aria-current')).toBe('page');
  });

  it('sets the document title from the route', async () => {
    renderAt('/drift');
    expect(document.title).toBe('Drift · Centurion Factory');
  });

  it('updates the title and active link when navigating', async () => {
    const user = userEvent.setup();
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    await user.click(within(nav).getByRole('link', { name: 'Documentos' }));
    expect(document.title).toBe('Documentos · Centurion Factory');
    expect(screen.getByRole('heading', { level: 1, name: 'Documentos' })).toBeTruthy();
  });

  it('renders the mobile bottom bar with short labels', () => {
    renderAt('/');
    const bar = screen.getByRole('navigation', { name: 'Navegación móvil' });
    expect(within(bar).getByRole('link', { name: 'Planta' }).getAttribute('aria-current')).toBe('page');
    expect(within(bar).getByRole('link', { name: 'Docs' })).toBeTruthy();
  });

  it('announces the drift badge with its meaning', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(within(nav).getByText('3 errores de drift', { selector: '.visually-hidden' })).toBeTruthy();
  });

  it('renders login outside the app shell', () => {
    renderAt('/login');
    expect(screen.queryByRole('navigation', { name: 'Navegación principal' })).toBeNull();
  });
});

describe('RootLayout', () => {
  it('provides toasts to every route, including login', async () => {
    const { useToast } = await import('../../src/components');
    function Probe() {
      const { show } = useToast();
      return (
        <button type="button" onClick={() => show('Guardado')}>
          Probar
        </button>
      );
    }
    const { RootLayout } = await import('../../src/components/shell/RootLayout');
    const router = createMemoryRouter([{ element: <RootLayout />, children: [{ path: '/', element: <Probe /> }] }]);
    render(<RouterProvider router={router} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Probar' }));
    expect(screen.getByRole('status').textContent).toContain('Guardado');
  });
});
