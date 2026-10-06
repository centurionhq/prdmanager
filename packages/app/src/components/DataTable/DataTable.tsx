import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useId, useRef, type ChangeEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { SortState } from '../../lib/filter-sort';
import { toggleSort } from '../../lib/filter-sort';
import { useMediaQuery } from '../../lib/use-media-query';
import styles from './DataTable.module.css';

export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly sortValue?: (row: T) => string | number | undefined;
  readonly align?: 'start' | 'end';
  readonly width?: string;
  readonly hideBelow?: 'sm';
  /** Stacks the label above the value under 640px instead of the default label/value grid row. */
  readonly stack?: 'block';
  /** Builds an href for a real, row-covering `<Link>` rendered in this cell. See `primary`. */
  readonly rowLink?: (row: T) => string;
  /** Marks this column's own rendered content (already a link or button) as the row's action,
   * stretching it to cover the row instead of making the whole `tr` a synthetic control. */
  readonly primary?: boolean;
}

export interface DataTableSelection {
  readonly selectedIds: ReadonlySet<string>;
  readonly onChange: (next: ReadonlySet<string>) => void;
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
  /** Opt-in multi-select: prepends a checkbox column and a select-all header checkbox. */
  readonly selection?: DataTableSelection;
}

const MOBILE_QUERY = '(max-width: 640px)';

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

function cellClassName(align: 'start' | 'end' | undefined, hideBelow: 'sm' | undefined, stack: 'block' | undefined, base: string | undefined): string {
  return [base, align === 'end' ? styles.alignEnd : null, hideBelow === 'sm' ? styles.hideBelowSm : null, stack === 'block' ? styles.cellBlock : null]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

function isPrimaryColumn<T>(column: DataTableColumn<T>): boolean {
  return Boolean(column.rowLink) || Boolean(column.primary);
}

function cellContent<T>(column: DataTableColumn<T>, row: T): ReactNode {
  if (column.rowLink) {
    return (
      <Link to={column.rowLink(row)} className={styles.rowLink}>
        {column.render(row)}
      </Link>
    );
  }
  if (column.primary) {
    return <span className={styles.rowLink}>{column.render(row)}</span>;
  }
  return column.render(row);
}

function selectionAnnouncement(count: number): string {
  if (count === 0) return 'Ninguna orden seleccionada';
  return count === 1 ? '1 orden seleccionada' : `${count} órdenes seleccionadas`;
}

interface SelectAllCheckboxProps {
  readonly checked: boolean;
  readonly indeterminate: boolean;
  readonly onToggle: () => void;
}

function SelectAllCheckbox({ checked, indeterminate, onToggle }: SelectAllCheckboxProps): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      aria-label="Seleccionar todas las filas"
      checked={checked}
      onChange={onToggle}
    />
  );
}

interface MobileSortBarProps<T> {
  readonly columns: readonly DataTableColumn<T>[];
  readonly sort: SortState<string> | undefined;
  readonly onSortChange: (next: SortState<string>) => void;
}

/** Visible "Ordenar por" select and direction toggle shown above the stacked list under 640px. */
function MobileSortBar<T>({ columns, sort, onSortChange }: MobileSortBarProps<T>): ReactElement | null {
  const selectId = useId();
  const sortableColumns = columns.filter((column) => column.sortValue);
  if (sortableColumns.length === 0) return null;

  function handleSelectChange(event: ChangeEvent<HTMLSelectElement>): void {
    const key = event.target.value;
    if (!key) return;
    onSortChange({ key, direction: 'asc' });
  }

  function handleToggleDirection(): void {
    if (!sort) return;
    onSortChange({ key: sort.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
  }

  const directionState = sort ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <div className={styles.mobileSort}>
      <label htmlFor={selectId} className={styles.mobileSortLabel}>
        Ordenar por
      </label>
      <select id={selectId} className={styles.mobileSortSelect} value={sort?.key ?? ''} onChange={handleSelectChange}>
        <option value="" disabled>
          Elegí una columna
        </option>
        {sortableColumns.map((column) => (
          <option key={column.key} value={column.key}>
            {column.header}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.mobileSortToggle}
        onClick={handleToggleDirection}
        disabled={!sort}
        aria-label="Invertir orden"
      >
        <SortIcon state={directionState} />
      </button>
    </div>
  );
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
  selection,
}: DataTableProps<T>): ReactElement {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const primaryColumn = columns.find(isPrimaryColumn);

  function handleSortClick(column: DataTableColumn<T>): void {
    if (!column.sortValue || !onSortChange) return;
    onSortChange(toggleSort(sort, column.key));
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: T): void {
    if (!onRowClick || !isActivationKey(event.key)) return;
    event.preventDefault();
    onRowClick(row);
  }

  const selectedIds = selection?.selectedIds;
  const pageIds = rows.map(getRowId);
  const selectedOnPage = selectedIds ? pageIds.filter((id) => selectedIds.has(id)).length : 0;
  const allSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;

  function handleToggleAll(): void {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    for (const id of pageIds) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    selection.onChange(next);
  }

  function handleToggleRow(rowId: string): void {
    if (!selection) return;
    const next = new Set(selection.selectedIds);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    selection.onChange(next);
  }

  return (
    <div className={styles.wrapper}>
      {onSortChange ? <MobileSortBar columns={columns} sort={sort} onSortChange={onSortChange} /> : null}
      {selection && isMobile ? (
        <div className={styles.selectionBar}>
          <label className={styles.selectionBarLabel}>
            <SelectAllCheckbox checked={allSelected} indeterminate={selectedOnPage > 0 && !allSelected} onToggle={handleToggleAll} />
            <span>Seleccionar todas las filas</span>
          </label>
          <span className={styles.selectionBarCount}>{selectionAnnouncement(selection.selectedIds.size)}</span>
        </div>
      ) : null}
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selection && !isMobile ? (
              <th scope="col" className={styles.selectCell}>
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={selectedOnPage > 0 && !allSelected}
                  onToggle={handleToggleAll}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const sortState = ariaSortFor(column, sort);
              const showSortButton = Boolean(column.sortValue) && !isMobile;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sortState}
                  style={column.width ? { width: column.width } : undefined}
                  className={cellClassName(column.align, column.hideBelow, undefined, styles.headerCell)}
                >
                  {showSortButton ? (
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
              <td className={styles.emptyCell} colSpan={columns.length + (selection ? 1 : 0)}>
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowId = getRowId(row);
              const selected = selectedIds ? selectedIds.has(rowId) : rowId === selectedId;
              const hasRowLink = Boolean(primaryColumn);
              return (
                <tr
                  key={rowId}
                  className={styles.row}
                  aria-selected={selection || selectedId !== undefined ? selected : undefined}
                  tabIndex={onRowClick && !hasRowLink ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick && !hasRowLink ? (event) => handleRowKeyDown(event, row) : undefined}
                >
                  {selection ? (
                    <td className={styles.selectCell}>
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        aria-label={`Seleccionar ${rowId}`}
                        checked={selected}
                        onChange={(event) => {
                          event.stopPropagation();
                          handleToggleRow(rowId);
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-label={column.header}
                      className={cellClassName(column.align, column.hideBelow, column.stack, styles.cell)}
                    >
                      {cellContent(column, row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {selection ? (
        <div role="status" className="visually-hidden">
          {selectionAnnouncement(selection.selectedIds.size)}
        </div>
      ) : null}
    </div>
  );
}
