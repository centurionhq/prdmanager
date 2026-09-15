import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, WORK_ORDERS } from '../../../src/data';
import { routes } from '../../../src/router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('OrdenesPage', () => {
  it('shows a skeleton while loading', () => {
    renderAt('/ordenes?estado=cargando');
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('shows an error state with a retry action', () => {
    renderAt('/ordenes?estado=error');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows the empty state when the demo forces it', () => {
    renderAt('/ordenes?estado=vacio');
    expect(screen.getByText('Todavía no hay órdenes de trabajo')).toBeTruthy();
  });

  it('shows the computed subtitle and every order once loaded', async () => {
    renderAt('/ordenes?estado=listo');
    const table = await screen.findByRole('table');
    expect(screen.getByText(`${WORK_ORDERS.length} órdenes en ${BLUEPRINTS.length} blueprints`)).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(WORK_ORDERS.length + 1); // + header row
  });

  it('renders a status chip per option with a computed count', async () => {
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    const group = screen.getByRole('radiogroup', { name: 'Estado' });
    expect(within(group).getByRole('radio', { name: /Todas/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Tomadas por mí/ })).toBeTruthy();
  });

  it('filtering by a status chip updates the URL and the visible rows', async () => {
    const user = userEvent.setup();
    const router = renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: /Hechas/ }));
    expect(router.state.location.search).toContain('filtro=done');
    const table = screen.getByRole('table');
    const doneCount = WORK_ORDERS.filter((wo) => wo.status === 'done').length;
    expect(within(table).getAllByRole('row')).toHaveLength(doneCount + 1);
  });

  it('"Tomadas por mí" is naturally empty and offers Quitar filtros', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: /Tomadas por mí/ }));
    expect(await screen.findByText('Ninguna orden coincide con estos filtros.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(await screen.findByText(`${WORK_ORDERS.length} órdenes en ${BLUEPRINTS.length} blueprints`)).toBeTruthy();
  });

  it('filtering by blueprint narrows the rows', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Blueprint' }), 'SDD-012');
    const table = screen.getByRole('table');
    const expected = WORK_ORDERS.filter((wo) => wo.blueprintId === 'SDD-012').length;
    expect(within(table).getAllByRole('row')).toHaveLength(expected + 1);
  });

  it('filtering by "Asignada a: sin asignar" narrows the rows', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Asignada a' }), 'sin-asignar');
    const table = screen.getByRole('table');
    const expected = WORK_ORDERS.filter((wo) => !wo.assignedTo).length;
    expect(within(table).getAllByRole('row')).toHaveLength(expected + 1);
  });

  it('searching narrows the rows by id, title or blueprint', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar órdenes' }), 'WO-310');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2); // header + the one match
    expect(within(table).getByText('WO-310')).toBeTruthy();
  });

  it('deep-links from the Árbol with ?feature= pre-filter the table', async () => {
    renderAt('/ordenes?estado=listo&feature=FR-002');
    const table = await screen.findByRole('table');
    const expected = WORK_ORDERS.filter((wo) => wo.featureId === 'FR-002').length;
    expect(within(table).getAllByRole('row')).toHaveLength(expected + 1);
  });

  it('sorts by a column when its header is clicked', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    const header = screen.getByRole('columnheader', { name: /Orden/ });
    await user.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
  });

  it('shows the footer with the visible and total counts', async () => {
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    const footer = screen.getByText(/^Mostrando/);
    expect(footer.textContent).toBe(`Mostrando ${WORK_ORDERS.length} de ${WORK_ORDERS.length} órdenes`);
  });
});
