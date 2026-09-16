/**
 * `/o/:orgSlug/p/:projectSlug/ordenes` (SDD-013 §"Shell y router", WO-360): every work order for this
 * project, filterable by estado/blueprint/tipo de actor and searchable by id or título, sortable by
 * column. Clicking a row opens `OrderDrawer` with that order's real context.
 */
import { ChevronDown } from 'lucide-react';
import { useMemo, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import type { WorkOrderSummary } from '@prdm/core';
import { listWorkOrders } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterChips,
  IdTag,
  PageHeader,
  SearchField,
  Skeleton,
  StatusBadge,
  ToastProvider,
  type DataTableColumn,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import type { SortState } from '../lib/filter-sort.js';
import { OrderDrawer } from './ordenes/OrderDrawer.js';
import {
  asWorkOrderStatus,
  filterWorkOrders,
  ORDENES_ACTOR_OPTIONS,
  ORDENES_BLUEPRINT_ALL,
  ORDENES_DEFAULT_SORT,
  ORDENES_STATUS_OPTIONS,
  sortWorkOrders,
  statusCounts,
  uniqueBlueprintIds,
  type OrdenesActorFilter,
  type OrdenesFilterState,
  type OrdenesSortKey,
  type OrdenesStatusFilter,
} from './ordenes/ordenes-filters.js';
import styles from './ordenes/Ordenes.module.css';
import { useProjectShellContext } from './ProjectShell.js';

function PlateSelect<T extends string>({
  label,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly children: ReactNode;
}): ReactElement {
  function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
    onChange(event.target.value as T);
  }

  return (
    <div className={styles.selectWrapper}>
      <select aria-label={label} className={styles.select} value={value} onChange={handleChange}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" size={16} className={styles.selectIcon} />
    </div>
  );
}

function blueprintCell(order: WorkOrderSummary): ReactElement {
  const [first, ...rest] = order.blueprints;
  if (!first) return <span className={styles.unassigned}>Sin blueprint</span>;
  return (
    <span>
      <IdTag id={first} />
      {rest.length > 0 ? ` +${rest.length}` : ''}
    </span>
  );
}

function buildColumns(): readonly DataTableColumn<WorkOrderSummary>[] {
  return [
    { key: 'id', header: 'Orden', render: (order) => <IdTag id={order.id} />, sortValue: (order) => order.id, width: '96px' },
    { key: 'title', header: 'Título', render: (order) => order.title },
    { key: 'blueprint', header: 'Blueprint', render: blueprintCell, sortValue: (order) => order.blueprints[0] ?? '', width: '128px' },
    {
      key: 'status',
      header: 'Estado',
      render: (order) => <StatusBadge kind="workOrder" status={asWorkOrderStatus(order.status)} />,
      sortValue: (order) => order.status,
      width: '160px',
    },
    {
      key: 'assignedTo',
      header: 'Asignada a',
      render: (order) => (order.assignedTo ? <span className="id">{order.assignedTo}</span> : <span className={styles.unassigned}>Sin asignar</span>),
      sortValue: (order) => order.assignedTo ?? '',
      width: '140px',
    },
  ];
}

function OrdenesContent(): ReactElement {
  const { orgSlug, projectSlug } = useProjectShellContext();
  useDocumentTitle('Órdenes de trabajo');

  const [status, setStatus] = useState<OrdenesStatusFilter>('todas');
  const [blueprintId, setBlueprintId] = useState(ORDENES_BLUEPRINT_ALL);
  const [actor, setActor] = useState<OrdenesActorFilter>('todos');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState<OrdenesSortKey>>(ORDENES_DEFAULT_SORT);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  const listQuery = useApiQuery(
    `work-orders:${orgSlug}:${projectSlug}`,
    () => listWorkOrders(orgSlug, projectSlug),
    [orgSlug, projectSlug],
  );

  const filters: OrdenesFilterState = useMemo(() => ({ status, blueprintId, actor, query }), [status, blueprintId, actor, query]);
  const orders = listQuery.data ?? [];
  const filtered = useMemo(() => filterWorkOrders(orders, filters), [orders, filters]);
  const rows = useMemo(() => sortWorkOrders(filtered, sort), [filtered, sort]);
  const counts = useMemo(() => statusCounts(orders, filters), [orders, filters]);
  const blueprintIds = useMemo(() => uniqueBlueprintIds(orders), [orders]);

  function resetFilters(): void {
    setStatus('todas');
    setBlueprintId(ORDENES_BLUEPRINT_ALL);
    setActor('todos');
    setQuery('');
  }

  if (listQuery.status === 'cargando') return <Skeleton rows={8} columns={5} />;
  if (listQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar las órdenes de trabajo" body={errorMessage(listQuery.error)} onRetry={listQuery.retry} />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Órdenes de trabajo"
        subtitle={`${orders.length} ${orders.length === 1 ? 'orden' : 'órdenes'} en ${blueprintIds.length} blueprints`}
        actions={<SearchField label="Buscar órdenes" value={query} onChange={setQuery} placeholder="Buscar órdenes" />}
      />

      {orders.length === 0 ? (
        <EmptyState title="Todavía no hay órdenes de trabajo para este proyecto" />
      ) : (
        <div className={styles.body}>
          <div className={styles.filtersBar}>
            <FilterChips
              label="Estado"
              value={status}
              onChange={(value) => setStatus(value as OrdenesStatusFilter)}
              options={ORDENES_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label, count: counts[option.value] }))}
            />
            <div className={styles.selects}>
              <PlateSelect label="Blueprint" value={blueprintId} onChange={setBlueprintId}>
                <option value={ORDENES_BLUEPRINT_ALL}>Blueprint: todos</option>
                {blueprintIds.map((id) => (
                  <option key={id} value={id}>
                    Blueprint: {id}
                  </option>
                ))}
              </PlateSelect>
              <PlateSelect label="Asignada a" value={actor} onChange={setActor}>
                {ORDENES_ACTOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </PlateSelect>
            </div>
          </div>

          <DataTable
            caption="Órdenes de trabajo"
            columns={buildColumns()}
            rows={rows}
            getRowId={(order) => order.id}
            sort={sort}
            onSortChange={(next) => setSort(next as SortState<OrdenesSortKey>)}
            onRowClick={(order) => setOpenId(order.id)}
            selectedId={openId}
            emptyState={
              <EmptyState
                title="Ninguna orden coincide con estos filtros"
                action={{ label: 'Quitar filtros', onClick: resetFilters }}
              />
            }
          />

          {rows.length > 0 ? (
            <p className={styles.footer}>
              Mostrando <span className="num">{rows.length}</span> de <span className="num">{orders.length}</span> órdenes
            </p>
          ) : null}
        </div>
      )}

      {openId ? (
        <OrderDrawer
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          workOrderId={openId}
          onClose={() => setOpenId(undefined)}
          onChanged={() => listQuery.retry()}
        />
      ) : null}
    </div>
  );
}

export function Ordenes(): ReactElement {
  return (
    <ToastProvider>
      <OrdenesContent />
    </ToastProvider>
  );
}
