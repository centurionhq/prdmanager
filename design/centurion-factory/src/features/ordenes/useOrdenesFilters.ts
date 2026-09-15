/**
 * Search, filter and sort state for the Órdenes de trabajo table (WO-291), synced with the URL's
 * search params so a filtered view is shareable/bookmarkable. Extracted from OrdenesPage (WO-319).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { WorkOrder } from '../../data';
import { sortItems, type SortState } from '../../lib/filter-sort';
import {
  DEFAULT_BLUEPRINT_FILTER,
  DEFAULT_SORT,
  filterWorkOrders,
  parseStatusFilter,
  statusCounts,
  statusTotal,
  type AssigneeFilterKey,
  type OrdenesSortKey,
  type StatusFilterKey,
} from './filters';

const SORT_ACCESSORS: Record<OrdenesSortKey, (order: WorkOrder) => string | number> = {
  id: (order) => order.id,
  title: (order) => order.title,
  blueprintId: (order) => order.blueprintId,
  status: (order) => order.status,
  assignedTo: (order) => order.assignedTo ?? '',
  updatedAt: (order) => order.updatedAt,
};

export interface UseOrdenesFiltersResult {
  readonly status: StatusFilterKey;
  readonly blueprintId: string;
  readonly featureId: string | undefined;
  readonly assignee: AssigneeFilterKey;
  readonly setAssignee: (value: AssigneeFilterKey) => void;
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly sort: SortState<OrdenesSortKey>;
  readonly setSort: (sort: SortState<OrdenesSortKey>) => void;
  readonly setStatus: (value: StatusFilterKey) => void;
  readonly setBlueprintId: (value: string) => void;
  readonly resetFilters: () => void;
  readonly rows: readonly WorkOrder[];
  readonly counts: ReturnType<typeof statusCounts>;
  readonly total: number;
}

export function useOrdenesFilters(orders: readonly WorkOrder[]): UseOrdenesFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const [assignee, setAssignee] = useState<AssigneeFilterKey>('todas');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState<OrdenesSortKey>>(DEFAULT_SORT);

  const status = parseStatusFilter(searchParams.get('filtro'));
  const blueprintId = searchParams.get('blueprint') ?? DEFAULT_BLUEPRINT_FILTER;
  const featureId = searchParams.get('feature') ?? undefined;

  function setStatus(value: StatusFilterKey): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === 'todas') next.delete('filtro');
      else next.set('filtro', value);
      return next;
    });
  }

  function setBlueprintId(value: string): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === DEFAULT_BLUEPRINT_FILTER) next.delete('blueprint');
      else next.set('blueprint', value);
      return next;
    });
  }

  function resetFilters(): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('filtro');
      next.delete('blueprint');
      next.delete('feature');
      return next;
    });
    setAssignee('todas');
    setQuery('');
  }

  const filters = useMemo(() => ({ status, blueprintId, assignee, featureId, query }), [status, blueprintId, assignee, featureId, query]);
  const filteredRows = useMemo(() => filterWorkOrders(orders, filters), [orders, filters]);
  const rows = useMemo(() => sortItems(filteredRows, SORT_ACCESSORS[sort.key], sort.direction), [filteredRows, sort]);
  const counts = useMemo(() => statusCounts(orders, filters), [orders, filters]);
  const total = statusTotal(orders, status);

  return { status, blueprintId, featureId, assignee, setAssignee, query, setQuery, sort, setSort, setStatus, setBlueprintId, resetFilters, rows, counts, total };
}
