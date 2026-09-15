/** OrdenesPage's filters bar, DataTable and "Mostrando N de M" footer line. */
import type { ReactElement } from 'react';
import { DataTable, EmptyState } from '../../components';
import { BLUEPRINTS, type WorkOrder } from '../../data';
import type { SortState } from '../../lib/filter-sort';
import type { OrdenesSortKey } from './filters';
import { ordenesColumns } from './ordenesColumns';
import { OrdenesFiltersBar } from './OrdenesFiltersBar';
import styles from './OrdenesPage.module.css';
import type { UseOrdenesFiltersResult } from './useOrdenesFilters';
import type { UseOrderDrawerStateResult } from './useOrderDrawerState';

export interface OrdenesTableProps {
  readonly filters: UseOrdenesFiltersResult;
  readonly drawer: UseOrderDrawerStateResult;
}

export function OrdenesTable({ filters, drawer }: OrdenesTableProps): ReactElement {
  return (
    <>
      <OrdenesFiltersBar
        status={filters.status}
        onStatusChange={filters.setStatus}
        counts={filters.counts}
        blueprintId={filters.blueprintId}
        onBlueprintChange={filters.setBlueprintId}
        blueprints={BLUEPRINTS}
        assignee={filters.assignee}
        onAssigneeChange={filters.setAssignee}
      />

      <DataTable
        caption="Órdenes de trabajo"
        columns={ordenesColumns()}
        rows={filters.rows}
        getRowId={(order: WorkOrder) => order.id}
        sort={filters.sort}
        onSortChange={(next) => filters.setSort(next as SortState<OrdenesSortKey>)}
        onRowClick={drawer.openOrderDrawer}
        selectedId={drawer.openOrderId}
        emptyState={
          <EmptyState
            title="Ninguna orden coincide con estos filtros."
            body="Probá quitar alguno de los filtros activos."
            action={{ label: 'Quitar filtros', onClick: filters.resetFilters }}
          />
        }
      />

      {filters.rows.length > 0 ? (
        <p className={styles.footer}>
          Mostrando <span className="num">{filters.rows.length}</span> de <span className="num">{filters.total}</span> órdenes
        </p>
      ) : null}
    </>
  );
}
