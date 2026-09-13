import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { listWorkOrders } from '../../src/client/api/client';
import { WorkOrderList } from '../../src/client/components/WorkOrderList';
import { SelectionProvider, useSelection } from '../../src/client/state/selection';

vi.mock('../../src/client/api/client', () => ({ listWorkOrders: vi.fn() }));

const mockListWorkOrders = vi.mocked(listWorkOrders);

describe('WorkOrderList', () => {
  it('renders every returned work order as a row', async () => {
    mockListWorkOrders.mockResolvedValue([
      { id: 'WO-070', title: 'Estados de carga', status: 'done', assignedTo: null, blueprints: ['SDD-005'], sourcePath: 'x' },
    ]);

    render(
      <SelectionProvider>
        <WorkOrderList />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText('WO-070')).toBeTruthy());
    expect(screen.getByText('Estados de carga')).toBeTruthy();
  });

  it('shows an empty state when the filter matches nothing', async () => {
    mockListWorkOrders.mockResolvedValue([]);
    render(
      <SelectionProvider>
        <WorkOrderList />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Sin work orders para este filtro')).toBeTruthy());
  });

  it('clicking a status chip re-fetches with that status filter', async () => {
    mockListWorkOrders.mockResolvedValue([]);
    render(
      <SelectionProvider>
        <WorkOrderList />
      </SelectionProvider>,
    );
    await waitFor(() => expect(mockListWorkOrders).toHaveBeenCalledWith({ status: undefined }));

    await userEvent.click(screen.getByRole('button', { name: 'out_of_sync' }));

    await waitFor(() => expect(mockListWorkOrders).toHaveBeenCalledWith({ status: 'out_of_sync' }));
  });

  it('a keyboard user can select a row with Enter (rows are focusable and have an accessible name)', async () => {
    mockListWorkOrders.mockResolvedValue([
      { id: 'WO-070', title: 'Estados de carga', status: 'done', assignedTo: null, blueprints: ['SDD-005'], sourcePath: 'x' },
    ]);

    function SelectedProbe() {
      const { selectedId } = useSelection();
      return <span data-testid="selected">{selectedId ?? 'none'}</span>;
    }

    render(
      <SelectionProvider>
        <WorkOrderList />
        <SelectedProbe />
      </SelectionProvider>,
    );

    const row = await screen.findByRole('button', { name: /WO-070/ });
    row.focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByTestId('selected').textContent).toBe('WO-070');
  });

  it('clicking a row selects that work order', async () => {
    mockListWorkOrders.mockResolvedValue([
      { id: 'WO-070', title: 'Estados de carga', status: 'done', assignedTo: null, blueprints: ['SDD-005'], sourcePath: 'x' },
    ]);

    function SelectedProbe() {
      const { selectedId } = useSelection();
      return <span data-testid="selected">{selectedId ?? 'none'}</span>;
    }

    render(
      <SelectionProvider>
        <WorkOrderList />
        <SelectedProbe />
      </SelectionProvider>,
    );

    await waitFor(() => expect(screen.getByText('WO-070')).toBeTruthy());
    await userEvent.click(screen.getByText('WO-070'));

    expect(screen.getByTestId('selected').textContent).toBe('WO-070');
  });
});
