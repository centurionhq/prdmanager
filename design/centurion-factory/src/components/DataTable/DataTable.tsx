import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import type { SortState } from '../../lib/filter-sort';
import { toggleSort } from '../../lib/filter-sort';
import styles from './DataTable.module.css';

export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly sortValue?: (row: T) => string | number | undefined;
  readonly align?: 'start' | 'end';
  readonly width?: string;
  readonly hideBelow?: 'sm';
}

export interface DataTableProps<T> {
  readonly caption: string;
  readonly columns: readonly DataTableColumn<T>[];
  readonly rows: readonly T[];
  readonly getRowId: (row: T) => string;
  readonly sort?: SortState<string>;
  readonly onSortChange?: (next: SortState<string>) => void;
  readonly onRowClick?: (row: T) => void;
  readonly selectedId?: string;
  readonly emptyState?: ReactNode;
}

function ariaSortFor<T>(column: DataTableColumn<T>, sort: SortState<string> | undefined): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortValue) return undefined;
  if (sort?.key !== column.key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

function SortIcon({ state }: { readonly state: 'ascending' | 'descending' | 'none' }): ReactElement {
  if (state === 'ascending') return <ChevronUp aria-hidden="true" size={14} className={styles.sortIcon} />;
  if (state === 'descending') return <ChevronDown aria-hidden="true" size={14} className={styles.sortIcon} />;
  return <ArrowUpDown aria-hidden="true" size={14} className={styles.sortIcon} />;
}

function cellClassName(align: 'start' | 'end' | undefined, hideBelow: 'sm' | undefined, base: string | undefined): string {
  return [base, align === 'end' ? styles.alignEnd : null, hideBelow === 'sm' ? styles.hideBelowSm : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

/**
 * A real `<table>` with sortable headers (`aria-sort`), keyboard-reachable rows and a
 * CSS-only stacked layout under 640px. See the tables on Ordenes.dc.html / Documentos.dc.html.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  sort,
  onSortChange,
  onRowClick,
  selectedId,
  emptyState,
}: DataTableProps<T>): ReactElement {
  function handleSortClick(column: DataTableColumn<T>): void {
    if (!column.sortValue || !onSortChange) return;
    onSortChange(toggleSort(sort, column.key));
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: T): void {
    if (!onRowClick || !isActivationKey(event.key)) return;
    event.preventDefault();
    onRowClick(row);
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortState = ariaSortFor(column, sort);
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sortState}
                  style={column.width ? { width: column.width } : undefined}
                  className={cellClassName(column.align, column.hideBelow, styles.headerCell)}
                >
                  {column.sortValue ? (
                    <button type="button" className={styles.sortButton} onClick={() => handleSortClick(column)}>
                      {column.header}
                      <SortIcon state={sortState ?? 'none'} />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyState ? (
            <tr>
              <td className={styles.emptyCell} colSpan={columns.length}>
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowId = getRowId(row);
              const selected = rowId === selectedId;
              return (
                <tr
                  key={rowId}
                  className={styles.row}
                  aria-selected={selectedId === undefined ? undefined : selected}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (event) => handleRowKeyDown(event, row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} data-label={column.header} className={cellClassName(column.align, column.hideBelow, styles.cell)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
