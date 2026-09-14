import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkOrderList } from '../../src/components/WorkOrderList';
import { SelectionProvider, useSelection } from '../../src/state/selection';

describe('WorkOrderList', () => {
  it('renders every returned work order as a row', async () => {
    const fetchWorkOrders = vi.fn().mockResolvedValue([
      { id: 'WO-070', title: 'Estados de carga', status: 'done', assignedTo: null, blueprints: ['SDD-005'], sourcePath: 'x' },
    ]);

    render(
      <SelectionProvider>
        <WorkOrderList fetchWorkOrders={fetchWorkOrders} />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText('WO-070')).toBeTruthy());
    expect(screen.getByText('Estados de carga')).toBeTruthy();
  });

  it('shows an empty state when the filter matches nothing', async () => {
    const fetchWorkOrders = vi.fn().mockResolvedValue([]);
    render(
      <SelectionProvider>
        <WorkOrderList fetchWorkOrders={fetchWorkOrders} />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Sin work orders para este filtro')).toBeTruthy());
  });

  it('clicking a status chip re-fetches with that status filter', async () => {
    const fetchWorkOrders = vi.fn().mockResolvedValue([]);
    render(
      <SelectionProvider>
        <WorkOrderList fetchWorkOrders={fetchWorkOrders} />
      </SelectionProvider>,
    );
    await waitFor(() => expect(fetchWorkOrders).toHaveBeenCalledWith({ status: undefined }));

    await userEvent.click(screen.getByRole('button', { name: 'out_of_sync' }));

    await waitFor(() => expect(fetchWorkOrders).toHaveBeenCalledWith({ status: 'out_of_sync' }));
  });

  it('a keyboard user can select a row with Enter (rows are focusable and have an accessible name)', async () => {
    const fetchWorkOrders = vi.fn().mockResolvedValue([
      { id: 'WO-070', title: 'Estados de carga', status: 'done', assignedTo: null, blueprints: ['SDD-005'], sourcePath: 'x' },
    ]);

    function SelectedProbe() {
      const { selectedId } = useSelection();
      return <span data-testid="selected">{selectedId ?? 'none'}</span>;
    }

    render(
      <SelectionProvider>
        <WorkOrderList fetchWorkOrders={fetchWorkOrders} />
        <SelectedProbe />
      </SelectionProvider>,
    );

    const row = await screen.findByRole('button', { name: /WO-070/ });
    row.focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('selected').textContent).toBe('WO-070');
  });

  it('clicking a row selects that work order', async () => {
    const fetchWorkOrders = vi.fn().mockResolvedValue([
      { id: 'WO-070', title: 'Estados de carga', status: 'done', assignedTo: null, blueprints: ['SDD-005'], sourcePath: 'x' },
    ]);

    function SelectedProbe() {
      const { selectedId } = useSelection();
      return <span data-testid="selected">{selectedId ?? 'none'}</span>;
    }

    render(
      <SelectionProvider>
        <WorkOrderList fetchWorkOrders={fetchWorkOrders} />
        <SelectedProbe />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText('WO-070')).toBeTruthy());
    await userEvent.click(screen.getByText('WO-070'));

    expect(screen.getByTestId('selected').textContent).toBe('WO-070');
  });
});
