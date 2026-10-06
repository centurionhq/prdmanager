import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, WORK_ORDERS } from '../../../src/data';
import { routes } from '../../../src/router';

const activeOrders = () => WORK_ORDERS.filter((wo) => wo.status !== 'archived');

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

  it('hides the order/blueprint count subtitle in the error state (WO-317)', () => {
    renderAt('/ordenes?estado=error');
    expect(screen.queryByText(/órdenes en .* blueprints/)).toBeNull();
  });

  it('shows the empty state when the demo forces it', () => {
    renderAt('/ordenes?estado=vacio');
    expect(screen.getByText('Todavía no hay órdenes de trabajo')).toBeTruthy();
  });

  it('hides the order/blueprint count subtitle in the empty state (WO-317)', () => {
    renderAt('/ordenes?estado=vacio');
    expect(screen.queryByText(/órdenes en .* blueprints/)).toBeNull();
  });

  it('shows the computed subtitle and every order once loaded', async () => {
    renderAt('/ordenes?estado=listo');
    const table = await screen.findByRole('table');
    expect(screen.getByText(`${WORK_ORDERS.length} órdenes en ${BLUEPRINTS.length} blueprints`)).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(activeOrders().length + 1); // + header row
  });

  it('falls back to "Todas" for an unknown ?filtro= value (WO-318)', async () => {
    renderAt('/ordenes?estado=listo&filtro=algo-inventado');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(activeOrders().length + 1);
    const group = screen.getByRole('radiogroup', { name: 'Estado' });
    expect(within(group).getByRole('radio', { name: /Todas/ }).getAttribute('aria-checked')).toBe('true');
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
    expect(footer.textContent).toBe(`Mostrando ${activeOrders().length} de ${activeOrders().length} órdenes`);
  });

  it('the "Archivadas" chip lists only the archived order', async () => {
    const user = userEvent.setup();
    const router = renderAt('/ordenes?estado=listo');
    const table = await screen.findByRole('table');
    await user.click(within(screen.getByRole('radiogroup', { name: 'Estado' })).getByRole('radio', { name: /Archivadas/ }));
    expect(router.state.location.search).toContain('filtro=archived');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('WO-215')).toBeTruthy();
    expect(screen.getByText(/^Mostrando/).textContent).toBe('Mostrando 1 de 1 órdenes');
  });

  it('?orden= opens the drawer for that order', async () => {
    renderAt('/ordenes?estado=listo&orden=WO-310');
    expect(await screen.findByRole('dialog', { name: 'Resumen del importador en la CLI' })).toBeTruthy();
  });

  it('clicking a row opens its drawer and closing it returns focus to the row', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo');
    await screen.findByRole('table');
    const row = screen.getByRole('cell', { name: 'WO-310' }).closest('tr');
    if (!row) throw new Error('row not found');
    await user.click(row);
    expect(screen.getByRole('dialog', { name: 'Resumen del importador en la CLI' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(document.activeElement).toBe(row);
  });

  it('taking a pending order updates its row and the chip counts', async () => {
    const user = userEvent.setup();
    renderAt('/ordenes?estado=listo&orden=WO-311');
    const dialog = await screen.findByRole('dialog', { name: 'Test de importación de 2.000 documentos' });
    const pendingBefore = within(screen.getByRole('radiogroup', { name: 'Estado' })).getByRole('radio', { name: /Pendientes/ });
    const pendingCountBefore = pendingBefore.textContent;

    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    const modal = screen.getByRole('dialog', { name: 'Tomar orden' });
    await user.click(within(modal).getByRole('button', { name: 'Tomar orden' }));

    const row = screen.getByRole('cell', { name: 'WO-311' }).closest('tr');
    if (!row) throw new Error('row not found');
    expect(within(row).getByText('En curso')).toBeTruthy();
    const pendingAfter = within(screen.getByRole('radiogroup', { name: 'Estado' })).getByRole('radio', { name: /Pendientes/ });
    expect(pendingAfter.textContent).not.toBe(pendingCountBefore);
  });
});
