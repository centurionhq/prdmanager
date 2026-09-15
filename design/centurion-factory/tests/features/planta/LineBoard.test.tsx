import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LineBoard } from '../../../src/features/planta/LineBoard';

function renderBoard() {
  return render(
    <MemoryRouter>
      <LineBoard />
    </MemoryRouter>,
  );
}

describe('LineBoard', () => {
  it('shows the "La línea" heading', () => {
    renderBoard();
    expect(screen.getByRole('heading', { level: 2, name: 'La línea' })).toBeTruthy();
  });

  it('renders the six station headers from STATION_LABELS', () => {
    const { container } = renderBoard();
    const headers = Array.from(container.querySelectorAll('.stationHeader')).map((el) => el.textContent);
    expect(headers).toEqual(['Ingesta', 'Definición', 'Diseño', 'Planificación', 'Ejecución', 'Cierre']);
  });

  it('gives the stopped station header the andon background', () => {
    const { container } = renderBoard();
    const header = Array.from(container.querySelectorAll('.stationHeader')).find((el) => el.textContent === 'Ejecución');
    expect(header?.className).toContain('stationHeaderAndon');
  });

  it('shows an andon summary line naming the stopped station and feature', () => {
    renderBoard();
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && (element.textContent ?? '').includes('Línea detenida en Ejecución')),
    ).toBeTruthy();
    expect(within(screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('Línea detenida')).closest('p')!, ).getByText('FR-002')).toBeTruthy();
  });

  it('renders a row per selected feature with its id and title', () => {
    const { container } = renderBoard();
    const rows = container.querySelectorAll('.rows > li');
    expect(rows.length).toBe(6);
    expect(within(rows[0] as HTMLElement).getByText('FR-002')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Importador incremental de repositorios')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('PRD-006')).toBeTruthy();
  });

  it('renders the FR-002 progress label with its segmented bar', () => {
    renderBoard();
    expect(screen.getByText('14/22 · 3 paradas')).toBeTruthy();
  });

  it('renders the row link to the tree and the andon label link to drift', () => {
    renderBoard();
    const rowLink = screen.getByRole('link', {
      name: 'FR-002 Importador incremental de repositorios, estación Ejecución, 14 de 22 órdenes hechas, línea detenida: 3 órdenes fuera de sincronía',
    });
    expect(rowLink.getAttribute('href')).toBe('/arbol/FR-002');

    const andonLink = screen.getByRole('link', { name: '14/22 · 3 paradas' });
    expect(andonLink.getAttribute('href')).toBe('/drift?feature=FR-002');
  });

  it('gives every row an accessible name describing station and progress', () => {
    renderBoard();
    expect(
      screen.getByRole('link', {
        name: 'PRD-006 Rediseño del frontend de Centurion Factory con datos mock, estación Diseño, 0 de 4 órdenes hechas',
      }),
    ).toBeTruthy();
  });

  it('renders closed features in a muted row', () => {
    renderBoard();
    const closedLabel = screen.getByText('cerrada · 245/245');
    const row = closedLabel.closest('li');
    expect(row?.className).toContain('rowClosed');
  });
});
