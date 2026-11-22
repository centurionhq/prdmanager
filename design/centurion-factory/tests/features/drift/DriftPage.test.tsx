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

  it('lists branch previews worst-first, with the readable label, the count and the delta against main', async () => {
    renderAt('/drift');
    const previewsTitle = await screen.findByText('Previews por rama');
    const previews = within(previewsTitle.closest('div') as HTMLElement);

    // SDD-070 D3: a `pull_request` ref reads as its PR number, and the raw value stays in the title.
    const pullRequest = previews.getByText('PR #32');
    expect(pullRequest.getAttribute('title')).toBe('Rama del reporte: 32/merge');
    expect(previews.getByText('feat/fr-002-importer')).toBeTruthy();
    expect(previews.getByText('feat/fr-003-avisos')).toBeTruthy();

    // SDD-070 D5: the badge is text, not a control.
    expect(previews.getAllByText('vista previa')).toHaveLength(3);

    // SDD-070 D2: count plus a second line with the delta against the official report (6 issues).
    expect(previews.getByText('8')).toBeTruthy();
    expect(previews.getByText('+2 vs main')).toBeTruthy();
    expect(previews.getByText('0 vs main')).toBeTruthy();
    expect(previews.getByText('-4 vs main')).toBeTruthy();

    // SDD-070 D6: worst first — +2, then 0, then -4.
    const labels = Array.from(previewsTitle.closest('div')!.querySelectorAll('li')).map(
      (row) => row.querySelector('[title^="Rama del reporte"]')?.textContent ?? '',
    );
    expect(labels).toEqual(['PR #32', 'feat/fr-002-importer', 'feat/fr-003-avisos']);
  });

  it('does not draw a "Sin datos · Esperando reporte de CI" row in the previews panel', async () => {
    renderAt('/drift');
    const previewsTitle = await screen.findByText('Previews por rama');
    const previews = within(previewsTitle.closest('div') as HTMLElement);
    expect(previews.queryByText('Sin datos')).toBeNull();
    expect(previews.queryByText('Esperando reporte de CI')).toBeNull();
    // A preview report always carries a count; the wait is an issue of the list, not a row here.
    expect(previews.queryByText('fix/scan-timeout')).toBeNull();
    expect(screen.getByText('Esperando reporte de CI')).toBeTruthy();
    expect(screen.getAllByText('fix/scan-timeout').length).toBeGreaterThan(0);
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
