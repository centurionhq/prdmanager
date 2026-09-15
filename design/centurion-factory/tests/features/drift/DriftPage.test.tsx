import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('DriftPage', () => {
  it('shows "Drift" as the only h1, with the report subtitle', () => {
    renderAt('/drift');
    expect(screen.getByRole('heading', { level: 1, name: 'Drift' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Reporte oficial de/)).toBeTruthy();
  });

  it('shows a skeleton while loading', () => {
    renderAt('/drift?estado=cargando');
    expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
  });

  it('shows the empty state', () => {
    renderAt('/drift?estado=vacio');
    expect(screen.getByText('No hay drift pendiente de revisar.')).toBeTruthy();
  });

  it('summarizes errors, warnings and governed references', async () => {
    renderAt('/drift');
    const summary = await screen.findByRole('region', { name: 'Resumen de drift' });
    expect(summary.textContent).toContain('7');
    expect(summary.textContent).toContain('errores');
    expect(summary.textContent).toContain('avisos');
    expect(summary.textContent).toContain('3.254');
    expect(summary.textContent).toContain('referencias gobernadas');
    expect(summary.textContent).toContain('99,6 % del código sincronizado');
  });

  it('lists branch previews with their badge, relative time and issue count', async () => {
    renderAt('/drift');
    const previewsTitle = await screen.findByText('Previews por rama');
    const previews = within(previewsTitle.closest('div') as HTMLElement);
    expect(previews.getByText('feat/fr-002-importer')).toBeTruthy();
    expect(previews.getAllByText('vista previa').length).toBeGreaterThan(0);
    expect(previews.getByText('hace 26 min')).toBeTruthy();
  });

  it('shows "Esperando reporte de CI" for a branch awaiting its first report', async () => {
    renderAt('/drift');
    const previewsTitle = await screen.findByText('Previews por rama');
    const previews = within(previewsTitle.closest('div') as HTMLElement);
    expect(previews.getByText('fix/scan-timeout')).toBeTruthy();
    expect(previews.getByText('Esperando reporte de CI')).toBeTruthy();
    expect(previews.getByText('Sin datos')).toBeTruthy();
  });

  it('lists the report history with date, commit, token and issue count', async () => {
    renderAt('/drift');
    const history = await screen.findByText('Historial');
    const table = history.closest('#historial')!;
    expect(table.textContent).toContain('15/09/2026');
    expect(table.textContent).toContain('8f2c1d4');
    expect(table.textContent).toContain('prdm_ci_7f3a…');
    expect(table.textContent).toContain('6');
  });

  it('links "Ver historial" to the history section', async () => {
    renderAt('/drift');
    await screen.findByText('Historial');
    expect(screen.getByRole('link', { name: 'Ver historial' }).getAttribute('href')).toBe('#historial');
    expect(document.getElementById('historial')).toBeTruthy();
  });

  it('renders the "Reconocer drift" primary action', async () => {
    renderAt('/drift');
    expect(await screen.findByRole('button', { name: 'Reconocer drift' })).toBeTruthy();
  });
});
