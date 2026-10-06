import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from '../../../src/components/DataTable/DataTable';
import type { SortState } from '../../../src/lib/filter-sort';

/** Simulates `window.matchMedia` matching (or not) the DataTable's 640px mobile breakpoint. */
function mockMobileMediaQuery(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

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

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

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

  it('keeps a cell\'s plain text content as just the value, not the header, for existing consumers', () => {
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    const cell = screen.getByRole('cell', { name: 'WO-304' });
    expect(cell.textContent).toBe('WO-304');
    expect(cell.getAttribute('data-label')).toBe('Orden');
  });

  it('stacks the label above the value when a column sets stack: "block"', () => {
    const columns = makeColumns().map((column) => (column.key === 'title' ? { ...column, stack: 'block' as const } : column));
    render(<DataTable caption="Órdenes" columns={columns} rows={rows} getRowId={(row) => row.id} />);
    const cell = screen.getByRole('cell', { name: 'Escaneo incremental por hash de archivo' });
    expect(cell.className).toContain('cellBlock');
  });

  it('builds the mobile label from a generated ::before with a separator, in a two-column grid, never as a real text node', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/components/DataTable/DataTable.module.css'), 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*\.cell\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^;]*1fr[^}]*\}/);
    expect(css).toMatch(/\.cell::before\s*\{[^}]*content:\s*attr\(data-label\)/);
    expect(css).toMatch(/\.cellBlock\s*\{[^}]*flex-direction:\s*column/);
  });

  describe('mobile sorting', () => {
    it('keeps the header sort button on desktop', () => {
      mockMobileMediaQuery(false);
      const onSortChange = vi.fn();
      render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} onSortChange={onSortChange} />);
      expect(screen.getByRole('button', { name: 'Orden' })).toBeTruthy();
    });

    it('replaces the header sort button with plain text on mobile, keeping aria-sort on the columnheader', () => {
      mockMobileMediaQuery(true);
      const sort: SortState<string> = { key: 'id', direction: 'asc' };
      render(
        <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} sort={sort} onSortChange={vi.fn()} />,
      );
      expect(screen.queryByRole('button', { name: 'Orden' })).toBeNull();
      const header = screen.getByRole('columnheader', { name: 'Orden' });
      expect(header.getAttribute('aria-sort')).toBe('ascending');
    });

    it('renders a native "Ordenar por" select and a direction toggle when sorting is enabled', async () => {
      mockMobileMediaQuery(true);
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} onSortChange={onSortChange} />);

      const select = screen.getByRole('combobox', { name: 'Ordenar por' });
      await user.selectOptions(select, 'updated');
      expect(onSortChange).toHaveBeenCalledWith({ key: 'updated', direction: 'asc' });
    });

    it('toggles the sort direction from the direction button, keeping the same key', async () => {
      mockMobileMediaQuery(true);
      const user = userEvent.setup();
      const onSortChange = vi.fn();
      const sort: SortState<string> = { key: 'updated', direction: 'asc' };
      render(
        <DataTable
          caption="Órdenes"
          columns={makeColumns()}
          rows={rows}
          getRowId={(row) => row.id}
          sort={sort}
          onSortChange={onSortChange}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Invertir orden' }));
      expect(onSortChange).toHaveBeenCalledWith({ key: 'updated', direction: 'desc' });
    });

    it('does not render the mobile sort controls when no column is sortable', () => {
      mockMobileMediaQuery(true);
      const columns: readonly DataTableColumn<Row>[] = [{ key: 'title', header: 'Título', render: (row) => row.title }];
      render(<DataTable caption="Órdenes" columns={columns} rows={rows} getRowId={(row) => row.id} onSortChange={vi.fn()} />);
      expect(screen.queryByRole('combobox', { name: 'Ordenar por' })).toBeNull();
    });
  });

  describe('row links', () => {
    function columnsWithRowLink(): readonly DataTableColumn<Row>[] {
      return [
        { key: 'id', header: 'Orden', render: (row) => row.id, sortValue: (row) => row.id, rowLink: (row) => `/ordenes/${row.id}` },
        { key: 'title', header: 'Título', render: (row) => row.title },
      ];
    }

    it('renders a real Link covering the row instead of a focusable tr', () => {
      render(
        <MemoryRouter>
          <DataTable caption="Órdenes" columns={columnsWithRowLink()} rows={rows} getRowId={(row) => row.id} />
        </MemoryRouter>,
      );
      const link = screen.getByRole('link', { name: 'WO-304' });
      expect(link.getAttribute('href')).toBe('/ordenes/WO-304');
      const row = link.closest('tr');
      expect(row?.hasAttribute('tabindex')).toBe(false);
    });

    it('still calls onRowClick as a mouse shortcut when a rowLink column is present', async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      render(
        <MemoryRouter>
          <DataTable
            caption="Órdenes"
            columns={columnsWithRowLink()}
            rows={rows}
            getRowId={(row) => row.id}
            onRowClick={onRowClick}
          />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole('cell', { name: 'Escaneo incremental por hash de archivo' }));
      expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    });

    it('marks a column as primary to stretch its own rendered content across the row', () => {
      const columns: readonly DataTableColumn<Row>[] = [
        { key: 'id', header: 'Orden', render: (row) => <a href={`/ordenes/${row.id}`}>{row.id}</a>, primary: true },
        { key: 'title', header: 'Título', render: (row) => row.title },
      ];
      render(<DataTable caption="Órdenes" columns={columns} rows={rows} getRowId={(row) => row.id} />);
      const link = screen.getByRole('link', { name: 'WO-304' });
      const row = link.closest('tr');
      expect(row?.hasAttribute('tabindex')).toBe(false);
    });
  });
});

describe('DataTable selection', () => {
  function renderSelectable(selected: readonly string[], extra: { onRowClick?: (row: Row) => void; rows?: readonly Row[]; emptyState?: ReactNode } = {}) {
    const onChange = vi.fn();
    render(
      <DataTable
        caption="Órdenes"
        columns={makeColumns()}
        rows={extra.rows ?? rows}
        getRowId={(row) => row.id}
        onRowClick={extra.onRowClick}
        emptyState={extra.emptyState}
        selection={{ selectedIds: new Set(selected), onChange }}
      />,
    );
    return onChange;
  }

  function selectAll(): HTMLInputElement {
    return screen.getByRole('checkbox', { name: 'Seleccionar todas las filas' }) as HTMLInputElement;
  }

  it('renders no checkbox without the selection prop', () => {
    render(<DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('renders a checkbox per row plus select-all with accessible names', () => {
    renderSelectable([]);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Seleccionar todas las filas' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar WO-304' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar WO-310' })).toBeTruthy();
  });

  it('adds a row id preserving the already selected ones', async () => {
    const user = userEvent.setup();
    const onChange = renderSelectable(['WO-310']);
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar WO-304' }));
    const next = onChange.mock.calls[0]?.[0] as ReadonlySet<string>;
    expect([...next].sort()).toEqual(['WO-304', 'WO-310']);
  });

  it('removes a row id when its checkbox is unchecked, keeping the others', async () => {
    const user = userEvent.setup();
    const onChange = renderSelectable(['WO-304', 'WO-310']);
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar WO-304' }));
    const next = onChange.mock.calls[0]?.[0] as ReadonlySet<string>;
    expect([...next]).toEqual(['WO-310']);
  });

  it('does not mutate the received selectedIds set', async () => {
    const user = userEvent.setup();
    const selectedIds = new Set(['WO-310']);
    const onChange = vi.fn();
    render(
      <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} selection={{ selectedIds, onChange }} />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar WO-304' }));
    expect([...selectedIds]).toEqual(['WO-310']);
  });

  it('select-all with empty selection selects every row of the page', async () => {
    const user = userEvent.setup();
    const onChange = renderSelectable([]);
    await user.click(selectAll());
    expect([...(onChange.mock.calls[0]?.[0] as ReadonlySet<string>)].sort()).toEqual(['WO-304', 'WO-310']);
  });

  it('select-all with every row selected removes them, preserving ids from other pages', async () => {
    const user = userEvent.setup();
    const onChange = renderSelectable(['WO-304', 'WO-310']);
    await user.click(selectAll());
    expect((onChange.mock.calls[0]?.[0] as ReadonlySet<string>).size).toBe(0);
  });

  it('select-all keeps ids outside the page when deselecting', async () => {
    const user = userEvent.setup();
    const onChange = renderSelectable(['WO-304', 'WO-310', 'WO-999']);
    await user.click(selectAll());
    expect([...(onChange.mock.calls[0]?.[0] as ReadonlySet<string>)]).toEqual(['WO-999']);
  });

  it('select-all with a partial selection selects the union', async () => {
    const user = userEvent.setup();
    const onChange = renderSelectable(['WO-304']);
    await user.click(selectAll());
    expect([...(onChange.mock.calls[0]?.[0] as ReadonlySet<string>)].sort()).toEqual(['WO-304', 'WO-310']);
  });

  it('reflects partial and full selection on the select-all checkbox', () => {
    renderSelectable(['WO-304']);
    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);
  });

  it('checks select-all when every row is selected and is not indeterminate', () => {
    renderSelectable(['WO-304', 'WO-310']);
    expect(selectAll().checked).toBe(true);
    expect(selectAll().indeterminate).toBe(false);
  });

  it('is not indeterminate without selection', () => {
    renderSelectable([]);
    expect(selectAll().indeterminate).toBe(false);
    expect(selectAll().checked).toBe(false);
  });

  it('exposes aria-selected on every row from selectedIds', () => {
    renderSelectable(['WO-310']);
    expect(screen.getByRole('cell', { name: 'WO-310' }).closest('tr')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('cell', { name: 'WO-304' }).closest('tr')?.getAttribute('aria-selected')).toBe('false');
  });

  it('announces the batch size in a status region', () => {
    const { unmount } = render(
      <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} selection={{ selectedIds: new Set(['a', 'b']), onChange: vi.fn() }} />,
    );
    expect(screen.getByRole('status').textContent).toBe('2 órdenes seleccionadas');
    unmount();
    const one = render(
      <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} selection={{ selectedIds: new Set(['a']), onChange: vi.fn() }} />,
    );
    expect(screen.getByRole('status').textContent).toBe('1 orden seleccionada');
    one.unmount();
    renderSelectable([]);
    expect(screen.getByRole('status').textContent).toBe('Ninguna orden seleccionada');
  });

  it('does not call onRowClick when a row checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    const onChange = renderSelectable([], { onRowClick });
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar WO-304' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('extends the empty state colSpan by one for the selection column', () => {
    renderSelectable([], { rows: [], emptyState: <span>Vacío</span> });
    const cell = screen.getByText('Vacío').closest('td');
    expect(cell?.colSpan).toBe(makeColumns().length + 1);
  });

  describe('select-all placement', () => {
    function selectAllCheckboxes(): HTMLElement[] {
      return screen.getAllByRole('checkbox').filter((box) => box.getAttribute('aria-label') === 'Seleccionar todas las filas');
    }

    it('on desktop renders select-all inside the thead', () => {
      mockMobileMediaQuery(false);
      renderSelectable([]);
      expect(selectAll().closest('thead')).not.toBeNull();
    });

    it('on desktop renders a single select-all that lives in the table', () => {
      mockMobileMediaQuery(false);
      renderSelectable([]);
      expect(selectAllCheckboxes()).toHaveLength(1);
      expect(selectAll().closest('table')).not.toBeNull();
    });

    it('on mobile keeps a single select-all outside the table and the row checkboxes', () => {
      mockMobileMediaQuery(true);
      renderSelectable([]);
      expect(selectAllCheckboxes()).toHaveLength(1);
      expect(selectAll().closest('table')).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Seleccionar WO-304' })).toBeTruthy();
    });

    it('on mobile leaves no focusable control in the hidden thead', () => {
      mockMobileMediaQuery(true);
      renderSelectable([]);
      const thead = screen.getAllByRole('columnheader')[0]?.closest('thead');
      expect(thead?.querySelector('input, button, a, select')).toBeNull();
    });

    it('on mobile the bar select-all selects every row of the page', async () => {
      mockMobileMediaQuery(true);
      const user = userEvent.setup();
      const onChange = renderSelectable([]);
      await user.click(selectAll());
      expect([...(onChange.mock.calls[0]?.[0] as ReadonlySet<string>)].sort()).toEqual(['WO-304', 'WO-310']);
    });

    it('on mobile shows the same count text as the status region', () => {
      mockMobileMediaQuery(true);
      const { unmount } = render(
        <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} selection={{ selectedIds: new Set(), onChange: vi.fn() }} />,
      );
      expect(screen.getAllByText('Ninguna orden seleccionada')).toHaveLength(2);
      unmount();
      render(
        <DataTable caption="Órdenes" columns={makeColumns()} rows={rows} getRowId={(row) => row.id} selection={{ selectedIds: new Set(['WO-304', 'WO-310']), onChange: vi.fn() }} />,
      );
      expect(screen.getAllByText('2 órdenes seleccionadas')).toHaveLength(2);
      expect(screen.getByRole('status').textContent).toBe('2 órdenes seleccionadas');
    });
  });
});

describe('DataTable stacked layout CSS', () => {
  it('scopes the stacked grid under .table so it beats the td display reset', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/components/DataTable/DataTable.module.css'), 'utf8');
    expect(css).toMatch(/\.table \.cell\s*\{\s*display:\s*grid/);
  });
});
