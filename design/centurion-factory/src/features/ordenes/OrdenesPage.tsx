import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { DataTable, EmptyState, ErrorState, IdTag, PageHeader, SearchField, Skeleton, StatusBadge, type DataTableColumn } from '../../components';
import { BLUEPRINTS, WORK_ORDERS, type WorkOrder } from '../../data';
import { sortItems, type SortState } from '../../lib/filter-sort';
import { useDemoState } from '../../lib/use-demo-state';
import { formatDateEs } from './format';
import {
  DEFAULT_BLUEPRINT_FILTER,
  DEFAULT_SORT,
  filterWorkOrders,
  statusCounts,
  statusTotal,
  type AssigneeFilterKey,
  type OrdenesSortKey,
  type StatusFilterKey,
} from './filters';
import { OrdenesFiltersBar } from './OrdenesFiltersBar';
import { OrderDrawer } from './OrderDrawer';
import styles from './OrdenesPage.module.css';

const SORT_ACCESSORS: Record<OrdenesSortKey, (order: WorkOrder) => string | number> = {
  id: (order) => order.id,
  title: (order) => order.title,
  blueprintId: (order) => order.blueprintId,
  status: (order) => order.status,
  assignedTo: (order) => order.assignedTo ?? '',
  updatedAt: (order) => order.updatedAt,
};

function columns(): readonly DataTableColumn<WorkOrder>[] {
  return [
    { key: 'id', header: 'Orden', render: (order) => <IdTag id={order.id} />, sortValue: (order) => order.id, width: '96px' },
    { key: 'title', header: 'Título', render: (order) => order.title },
    { key: 'blueprintId', header: 'Blueprint', render: (order) => <IdTag id={order.blueprintId} />, sortValue: (order) => order.blueprintId, width: '112px' },
    {
      key: 'status',
      header: 'Estado',
      render: (order) => <StatusBadge kind="workOrder" status={order.status} />,
      sortValue: (order) => order.status,
      width: '160px',
    },
    {
      key: 'assignedTo',
      header: 'Asignada a',
      render: (order) =>
        order.assignedTo ? <span className="id">{order.assignedTo}</span> : <span className={styles.unassigned}>Sin asignar</span>,
      sortValue: (order) => order.assignedTo ?? '',
      width: '140px',
    },
    {
      key: 'updatedAt',
      header: 'Actualizada',
      render: (order) => <span className="num">{formatDateEs(order.updatedAt)}</span>,
      sortValue: (order) => order.updatedAt,
      align: 'end',
      width: '112px',
    },
  ];
}

/** Órdenes de trabajo: search, filter, sort and page through every work order (WO-291). */
export function OrdenesPage(): ReactElement {
  const { state, retry } = useDemoState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<readonly WorkOrder[]>(WORK_ORDERS);
  const [assignee, setAssignee] = useState<AssigneeFilterKey>('todas');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState<OrdenesSortKey>>(DEFAULT_SORT);

  const status = (searchParams.get('filtro') as StatusFilterKey | null) ?? 'todas';
  const blueprintId = searchParams.get('blueprint') ?? DEFAULT_BLUEPRINT_FILTER;
  const featureId = searchParams.get('feature') ?? undefined;
  const openOrderId = searchParams.get('orden') ?? undefined;
  const openOrder = orders.find((order) => order.id === openOrderId);

  // The Drawer must stay mounted while it closes so its dialog controller can return focus to
  // the row that opened it; unmounting it the instant `orden` leaves the URL would instead drop
  // focus to <body>. `drawerOrder` keeps the last opened order around; `open` below still tracks
  // the URL, so the dialog itself closes normally.
  const [drawerOrder, setDrawerOrder] = useState<WorkOrder | undefined>(undefined);
  useEffect(() => {
    if (openOrder) setDrawerOrder(openOrder);
  }, [openOrder]);

  function openOrderDrawer(order: WorkOrder): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('orden', order.id);
      return next;
    });
  }

  function closeOrderDrawer(): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('orden');
      return next;
    });
  }

  function updateOrder(next: WorkOrder): void {
    setOrders((previous) => previous.map((order) => (order.id === next.id ? next : order)));
  }

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

  const filters = useMemo(
    () => ({ status, blueprintId, assignee, featureId, query }),
    [status, blueprintId, assignee, featureId, query],
  );

  const filteredRows = useMemo(() => filterWorkOrders(orders, filters), [orders, filters]);
  const rows = useMemo(() => sortItems(filteredRows, SORT_ACCESSORS[sort.key], sort.direction), [filteredRows, sort]);
  const counts = useMemo(() => statusCounts(orders, filters), [orders, filters]);
  const total = statusTotal(orders, status);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Órdenes de trabajo"
        subtitle={`${orders.length} órdenes en ${BLUEPRINTS.length} blueprints`}
        actions={<SearchField label="Buscar órdenes" value={query} onChange={setQuery} placeholder="Buscar órdenes" hideLabel />}
      />

      {state === 'cargando' ? <Skeleton rows={8} columns={6} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar las órdenes" body="Algo falló al traerlas. Volvé a intentarlo." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState title="Todavía no hay órdenes de trabajo" body="Cuando se generen órdenes para este proyecto, van a aparecer acá." />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.body}>
          <OrdenesFiltersBar
            status={status}
            onStatusChange={setStatus}
            counts={counts}
            blueprintId={blueprintId}
            onBlueprintChange={setBlueprintId}
            blueprints={BLUEPRINTS}
            assignee={assignee}
            onAssigneeChange={setAssignee}
          />

          <DataTable
            caption="Órdenes de trabajo"
            columns={columns()}
            rows={rows}
            getRowId={(order) => order.id}
            sort={sort}
            onSortChange={(next) => setSort(next as SortState<OrdenesSortKey>)}
            onRowClick={openOrderDrawer}
            selectedId={openOrderId}
            emptyState={
              <EmptyState
                title="Ninguna orden coincide con estos filtros."
                body="Probá quitar alguno de los filtros activos."
                action={{ label: 'Quitar filtros', onClick: resetFilters }}
              />
            }
          />

          {rows.length > 0 ? (
            <p className={styles.footer}>
              Mostrando <span className="num">{rows.length}</span> de <span className="num">{total}</span> órdenes
            </p>
          ) : null}

          {drawerOrder ? (
            <OrderDrawer order={drawerOrder} open={Boolean(openOrder)} onClose={closeOrderDrawer} onUpdate={updateOrder} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
