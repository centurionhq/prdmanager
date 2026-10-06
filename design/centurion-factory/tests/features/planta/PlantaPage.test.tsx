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

describe('PlantaPage', () => {
  it('shows "Planta" as the only h1', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Planta' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows a skeleton for the board and KPIs while loading', () => {
    renderAt('/?estado=cargando');
    expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 2, name: 'La línea' })).toBeNull();
  });

  it('shows the empty state with a "Crear un documento" action', async () => {
    const user = userEvent.setup();
    const router = renderAt('/?estado=vacio');
    expect(screen.getByText('Todavía no hay features en la línea.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Crear un documento' }));
    expect(router.state.location.pathname + router.state.location.search).toBe('/documentos?nuevo=1');
  });

  it('shows the error state and retries', async () => {
    const user = userEvent.setup();
    renderAt('/?estado=error');
    expect(screen.getByText('No pudimos leer el reporte oficial de main.')).toBeTruthy();
    expect(screen.getByText('Reintentá o revisá que el token de CI siga vigente.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'La línea' })).toBeTruthy();
  });

  it('renders the KPI strip with es-AR formatted values', async () => {
    renderAt('/');
    expect(await screen.findByText('5 min')).toBeTruthy();
    expect(screen.getByText('99,6 %')).toBeTruthy();
    expect(screen.getByText('100 %')).toBeTruthy();
    // WO-648: the demo data happens to have commitsTraced === commitsWithRefs (166/250), so the two
    // commit cells read the same number -- only their labels tell them apart.
    expect(screen.getAllByText('66,4 %')).toHaveLength(2);
  });

  it('links "Ver todo el drift" to /drift and "Ver órdenes" to /ordenes', async () => {
    renderAt('/');
    await screen.findByRole('heading', { level: 2, name: 'La línea' });
    expect(screen.getByRole('link', { name: 'Ver todo el drift' }).getAttribute('href')).toBe('/drift');
    expect(screen.getByRole('link', { name: 'Ver órdenes' }).getAttribute('href')).toBe('/ordenes');
  });

  it('links "Nuevo documento" to /documentos?nuevo=1', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Nuevo documento' }).getAttribute('href')).toBe('/documentos?nuevo=1');
  });

  it('navigates to /documentos?q=... when the search is submitted', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    const search = screen.getByRole('searchbox', { name: 'Buscar documentos, órdenes o código' });
    await user.type(search, 'importador{Enter}');
    expect(router.state.location.pathname + router.state.location.search).toBe('/documentos?q=importador');
  });

  it('shows the out_of_sync order title in paro', async () => {
    renderAt('/');
    const ordersHeading = await screen.findByRole('heading', { level: 2, name: 'Órdenes en curso' });
    const column = ordersHeading.closest('.column') as HTMLElement;
    const parada = within(column).getByText('Resumen del importador en la CLI');
    expect(parada.className).toContain('orderTitleParo');
  });
});
