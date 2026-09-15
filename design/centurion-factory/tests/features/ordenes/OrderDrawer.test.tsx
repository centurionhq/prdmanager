import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../src/components';
import { getWorkOrder, type WorkOrder } from '../../../src/data';
import { OrderDrawer } from '../../../src/features/ordenes/OrderDrawer';

function renderDrawer(orderId: string, onUpdate = vi.fn(), onClose = vi.fn()) {
  const order = getWorkOrder(orderId);
  if (!order) throw new Error(`${orderId} missing from mock data`);
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <ToastProvider>
          <OrderDrawer order={order} open onClose={onClose} onUpdate={onUpdate} />
        </ToastProvider>
      ),
    },
    { path: '/documentos/:id', element: <p>documento</p> },
  ]);
  render(<RouterProvider router={router} />);
  return { order, onUpdate, onClose };
}

describe('OrderDrawer', () => {
  it('shows the WO/feature/blueprint line, title, status and assignee', () => {
    renderDrawer('WO-310');
    expect(screen.getByRole('dialog', { name: 'Resumen del importador en la CLI' })).toBeTruthy();
    expect(screen.getByText('WO-310')).toBeTruthy();
    expect(screen.getByText('FR-002')).toBeTruthy();
    expect(screen.getByText(/Asignada a/).textContent).toContain('agent:claude');
  });

  it('shows the out_of_sync explanation box only for an out-of-sync order', () => {
    renderDrawer('WO-310');
    expect(screen.getByText(/SDD-012 cambió el 15\/09/)).toBeTruthy();
  });

  it('renders the acceptance criteria checklist and governed code sync status', () => {
    renderDrawer('WO-310');
    expect(screen.getByText('El resumen separa archivos nuevos, modificados, borrados y omitidos')).toBeTruthy();
    const codeHeading = screen.getByRole('heading', { level: 3, name: 'Código gobernado' });
    const codeSection = codeHeading.parentElement;
    if (!codeSection) throw new Error('Código gobernado section not found');
    expect(within(codeSection).getByText('Fuera de sincronía')).toBeTruthy();
    expect(within(codeSection).getByText('Sincronizado')).toBeTruthy();
  });

  it('lets a governed path wrap so its status badge never clips (WO-316)', () => {
    renderDrawer('WO-310');
    const path = screen.getByText('packages/cli/src/commands/import.ts');
    expect(path.className).toContain('id');
    expect(path.className).toContain('pathText');
    const row = path.closest('li');
    if (!row) throw new Error('path row not found');
    expect(within(row).getByText('Sincronizado')).toBeTruthy();
  });

  it('renders the commit history', () => {
    renderDrawer('WO-310');
    expect(screen.getByText('3c1a5af')).toBeTruthy();
    expect(screen.getByText(/importer summary/)).toBeTruthy();
  });

  it('always offers "Ver blueprint" linking to the blueprint document', () => {
    renderDrawer('WO-310');
    expect(screen.getByRole('link', { name: 'Ver blueprint' }).getAttribute('href')).toBe('/documentos/SDD-012');
  });

  it('pending: "Tomar orden" opens a modal and confirming assigns and moves it to in_progress', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDrawer('WO-311');
    await user.click(screen.getByRole('button', { name: 'Tomar orden' }));
    const dialog = screen.getByRole('dialog', { name: 'Tomar orden' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Asignar a' }), 'dev:martin');
    await user.click(within(dialog).getByRole('button', { name: 'Tomar orden' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'WO-311', status: 'in_progress', assignedTo: 'dev:martin' }));
    expect((await screen.findByRole('status')).textContent).toContain('Orden tomada');
  });

  it('in_progress: "Completar" validates the SHA and, once valid, marks the order done', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDrawer('WO-304');
    await user.click(screen.getByRole('button', { name: 'Completar' }));
    const dialog = screen.getByRole('dialog', { name: 'Completar orden' });
    const confirmButton = within(dialog).getByRole('button', { name: 'Completar' });

    await user.click(confirmButton);
    expect(screen.getByRole('alert').textContent).toContain('Pegá el SHA del commit');
    expect(onUpdate).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole('textbox', { name: /SHA del commit con Refs/ }), 'deadbee');
    await user.click(confirmButton);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'WO-304', status: 'done' }));
    const updated = onUpdate.mock.calls[0]?.[0] as WorkOrder;
    expect(updated.commitShas).toContain('deadbee');
    expect((await screen.findByRole('status')).textContent).toContain('Orden completada');
  });

  it('out_of_sync: "Retomar orden" moves it back to in_progress without opening a modal', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderDrawer('WO-310');
    await user.click(screen.getByRole('button', { name: 'Retomar orden' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'WO-310', status: 'in_progress' }));
    expect((await screen.findByRole('status')).textContent).toContain('Orden retomada');
  });

  it('done: shows no primary action', () => {
    renderDrawer('WO-058');
    expect(screen.queryByRole('button', { name: 'Tomar orden' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Completar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retomar orden' })).toBeNull();
  });
});
