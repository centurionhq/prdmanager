import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from '../../src/components/DataTable/DataTable';
import type { SortState } from '../../src/lib/filter-sort';

interface Row {
  readonly id: string;
  readonly title: string;
  readonly updated: string;
}

const rows: readonly Row[] = [
  { id: 'WO-304', title: 'Escaneo incremental por hash de archivo', updated: '2026-09-14' },
  { id: 'WO-310', title: 'Resumen del importador en la CLI', updated: '2026-09-15' },
];

function makeColumns(): readonly DataTableColumn<Row>[] {
  return [
    { key: 'id', header: 'Orden', render: (row) => row.id, sortValue: (row) => row.id },
    { key: 'title', header: 'Título', render: (row) => row.title },
    { key: 'updated', header: 'Actualizada', render: (row) => row.updated, sortValue: (row) => row.updated, align: 'end' },
  ];
}

describe('DataTable', () => {
  it('renders a real table with a visually hidden caption as its accessible name', () => {
    render(<DataTable caption="Órdenes de trabajo" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    expect(screen.getByRole('table', { name: 'Órdenes de trabajo' })).toBeTruthy();
  });

  it('renders a column header for every column', () => {
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    expect(screen.getByRole('columnheader', { name: 'Orden' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Título' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Actualizada' })).toBeTruthy();
  });

  it('renders every row and cell', () => {
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    expect(screen.getByRole('cell', { name: 'WO-304' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Resumen del importador en la CLI' })).toBeTruthy();
  });

  it('marks a sortable header with aria-sort="none" when not the active sort', () => {
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    const header = screen.getByRole('columnheader', { name: 'Orden' });
    expect(header.getAttribute('aria-sort')).toBe('none');
  });

  it('marks the active sort column as ascending or descending', () => {
    const sort: SortState<string> = { key: 'updated', direction: 'desc' };
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} sort={sort} />);
    expect(screen.getByRole('columnheader', { name: /Actualizada/ }).getAttribute('aria-sort')).toBe('descending');
  });

  it('does not set aria-sort on a column without a sortValue', () => {
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    expect(screen.getByRole('columnheader', { name: 'Título' }).hasAttribute('aria-sort')).toBe(false);
  });

  it('calls onSortChange with the toggled sort state when a sortable header is clicked', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} onSortChange={onSortChange} />,
    );
    await user.click(screen.getByRole('button', { name: 'Orden' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'id', direction: 'asc' });
  });

  it('calls onRowClick when a row is clicked', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} onRowClick={onRowClick} />);
    await user.click(screen.getByRole('cell', { name: 'WO-304' }));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('calls onRowClick when Enter is pressed on a focused row', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} onRowClick={onRowClick} />);
    const row = screen.getByRole('cell', { name: 'WO-304' }).closest('tr');
    if (!row) throw new Error('row not found');
    row.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('calls onRowClick when Space is pressed on a focused row', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} onRowClick={onRowClick} />);
    const row = screen.getByRole('cell', { name: 'WO-310' }).closest('tr');
    if (!row) throw new Error('row not found');
    row.focus();
    await user.keyboard(' ');
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('marks the selected row with aria-selected', () => {
    render(
      <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} selectedId="WO-310" />,
    );
    const selectedRow = screen.getByRole('cell', { name: 'WO-310' }).closest('tr');
    const otherRow = screen.getByRole('cell', { name: 'WO-304' }).closest('tr');
    expect(selectedRow?.getAttribute('aria-selected')).toBe('true');
    expect(otherRow?.getAttribute('aria-selected')).toBe('false');
  });

  it('renders the given emptyState instead of rows when there are none', () => {
    render(
      <DataTable
        caption="Órdenes"
        columns={makeColumns()}
        rows={[]}
        getRowId={(row) => row.id}
        emptyState={<span>Ninguna orden coincide con estos filtros.</span>}
      />,
    );
    expect(screen.getByText('Ninguna orden coincide con estos filtros.')).toBeTruthy();
    expect(screen.queryByRole('cell', { name: 'WO-304' })).toBeNull();
  });

  it('renders no data rows when rows are empty and no emptyState is given', () => {
    const { container } = render(<DataTable caption="Órdenes" columns={makeColumns()} rows={[]} getRowId={(row) => row.id} />);
    expect(within(container).queryAllByRole('row')).toHaveLength(1); // just the header row
  });
});
