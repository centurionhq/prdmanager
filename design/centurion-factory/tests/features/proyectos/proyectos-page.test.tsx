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

function projectNames(): string[] {
  const table = screen.getByRole('table', { name: 'Proyectos de Centurion HQ' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => (within(row).getAllByRole('cell')[0]?.textContent ?? '').split('centurion-hq/')[0] ?? '');
}

describe('ProyectosPage: accessibility', () => {
  it('offers a skip link to its main content (WO-317)', () => {
    renderAt('/proyectos');
    const skip = screen.getByRole('link', { name: 'Saltar al contenido' });
    expect(skip.getAttribute('href')).toBe('#contenido-proyectos');
    expect(screen.getByRole('main').id).toBe('contenido-proyectos');
  });
});

describe('ProyectosPage: top bar', () => {
  it('renders the wordmark, org switcher, settings link and person', async () => {
    renderAt('/proyectos');
    expect(screen.getByText('Centurion Factory')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Centurion HQ/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ajustes de la organización' }).getAttribute('href')).toBe('/ajustes/sso');
    expect(screen.getByText('Ana Ríos')).toBeTruthy();
  });

  it('opens the org menu with Centurion HQ checked and account creation disabled', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos');
    await user.click(screen.getByRole('button', { name: /Centurion HQ/ }));

    const menu = screen.getByRole('menu', { name: 'Organizaciones' });
    const current = within(menu).getByRole('menuitemradio', { name: 'Centurion HQ' });
    expect(current.getAttribute('aria-checked')).toBe('true');

    const create = within(menu).getByRole('menuitemradio', { name: 'Crear organización' });
    expect(create.hasAttribute('disabled')).toBe(true);
    expect(within(menu).getByText('Pedíselo a un superadmin')).toBeTruthy();
  });
});

describe('ProyectosPage: demo states', () => {
  it('shows a skeleton while loading', async () => {
    renderAt('/proyectos?estado=cargando');
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('shows the empty state with a next action', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos?estado=vacio');
    expect(screen.getByText('Todavía no hay proyectos')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Nuevo proyecto' }));
    expect(screen.getByRole('dialog', { name: 'Nuevo proyecto' })).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    renderAt('/proyectos?estado=error');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });
});

describe('ProyectosPage: listo', () => {
  it('renders the page title and the total project count', async () => {
    renderAt('/proyectos');
    expect(await screen.findByRole('heading', { level: 1, name: 'Proyectos' })).toBeTruthy();
    expect(screen.getByText('5 proyectos en Centurion HQ')).toBeTruthy();
  });

  it('shows Activos/Archivados/Todos filter chips with counts', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(screen.getByRole('radio', { name: /Activos/ }).textContent).toContain('4');
    expect(screen.getByRole('radio', { name: /Archivados/ }).textContent).toContain('1');
    expect(screen.getByRole('radio', { name: /Todos/ })).toBeTruthy();
  });

  it('defaults to Activos, hiding the archived project', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(projectNames().join(' ')).not.toContain('centurion-core');
  });

  it('orders projects by last activity, most recent first', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(projectNames()[0]).toContain('prdmanager');
  });

  it('shows the mono slug and document count for each project', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(screen.getByText('centurion-hq/prdmanager')).toBeTruthy();
    expect(screen.getByText('292 docs')).toBeTruthy();
  });

  it('shows the drift summary per project', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(screen.getByText('3 errores')).toBeTruthy();
    expect(screen.getByText('1 aviso')).toBeTruthy();
    expect(screen.getByText('Sin drift')).toBeTruthy();
    expect(screen.getByText('Esperando primer reporte de CI')).toBeTruthy();
  });

  it('labels the line status accessibly with where it reached and where it stopped', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(screen.getByText('Llega a Cierre, detenida en Ejecución', { selector: '.visually-hidden' })).toBeTruthy();
  });

  it('switches to Archivados and shows only the archived project', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos');
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: /Archivados/ }));
    const names = projectNames().join(' ');
    expect(names).toContain('centurion-core');
    expect(names).not.toContain('prdmanager');
  });

  it('filters by the search field', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos');
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: /Todos/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar proyectos' }), 'ystream');
    expect(projectNames()).toEqual(['ystream']);
  });

  it('navigates to / when clicking the prdmanager row', async () => {
    const user = userEvent.setup();
    const router = renderAt('/proyectos');
    await screen.findByRole('table');
    await user.click(screen.getByText('prdmanager'));
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows a toast when clicking a row for any other project', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos');
    await screen.findByRole('table');
    await user.click(screen.getByText('ystream'));
    expect(await screen.findByText('Este diseño solo tiene datos de prdmanager')).toBeTruthy();
  });

  it('shows the muted note about missing access at the bottom', async () => {
    renderAt('/proyectos');
    await screen.findByRole('table');
    expect(screen.getByText('¿No ves un proyecto? Pedile acceso a un admin de Centurion HQ.')).toBeTruthy();
  });
});

describe('ProyectosPage: new project', () => {
  it('derives the slug from the name and validates it', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Nuevo proyecto' }));

    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Data Report MS 2');
    expect(screen.getByRole('textbox', { name: 'Slug' })).toHaveProperty('value', 'data-report-ms-2');

    const slugField = screen.getByRole('textbox', { name: 'Slug' });
    await user.clear(slugField);
    await user.type(slugField, 'Not Valid!!');
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect(screen.getByText('Usá minúsculas, números y guiones.')).toBeTruthy();
  });

  it('creates the project, shows a toast and adds a row', async () => {
    const user = userEvent.setup();
    renderAt('/proyectos');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Nuevo proyecto' }));

    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), 'nuevo-proyecto');
    await user.click(screen.getByRole('button', { name: 'Crear proyecto' }));

    expect(await screen.findByText('Proyecto creado')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Nuevo proyecto' })).toBeNull();
    expect(screen.getByText('nuevo-proyecto')).toBeTruthy();
  });
});
