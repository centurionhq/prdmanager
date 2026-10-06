/**
 * `/o/:orgSlug/p/:projectSlug/ordenes` (SDD-013 §"Shell y router", WO-360): every work order for this
 * project, filtered, searched and paged server-side (SDD-064) with the URL as source of truth; sortable by
 * column within the visible page. Clicking a row opens `OrderDrawer` with that order's real context.
 */
import { ChevronDown } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { WorkOrderPage, WorkOrderSummary } from '@prdm/core';
import { getProfile, queryWorkOrders } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import {
  Button,
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
  ORDENES_ACTOR_OPTIONS,
  ORDENES_ACTOR_SELF_OPTION,
  ORDENES_BLUEPRINT_ALL,
  ORDENES_DEFAULT_SORT,
  ORDENES_NO_HANDLE_HINT,
  ORDENES_PAGE_SIZE,
  ORDENES_STATUS_OPTIONS,
  parseActorFilter,
  parsePage,
  parseStatusFilter,
  sortWorkOrders,
  toWorkOrderQuery,
  type OrdenesActorFilter,
  type OrdenesSortKey,
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

  const [searchParams, setSearchParams] = useSearchParams();
  const [sort, setSort] = useState<SortState<OrdenesSortKey>>(ORDENES_DEFAULT_SORT);
  const [openId, setOpenId] = useState<string | undefined>(undefined);

  // The URL is the source of truth for every filter and the page (SDD-064 D6).
  const status = parseStatusFilter(searchParams.get('status'));
  const blueprintId = searchParams.get('blueprint') ?? ORDENES_BLUEPRINT_ALL;
  const actor = parseActorFilter(searchParams.get('actor'));
  const query = searchParams.get('q') ?? '';
  const page = parsePage(searchParams.get('page'));

  const profileQuery = useApiQuery('profile', () => getProfile(), []);
  const handle = profileQuery.data?.handle ?? null;
  const profileReady = profileQuery.status !== 'cargando';
  const effectiveActor: OrdenesActorFilter = actor === 'mio' && handle === null ? 'todos' : actor;

  const listQuery = useApiQuery(
    `work-orders:${orgSlug}:${projectSlug}:${status}:${blueprintId}:${effectiveActor}:${query}:${page}`,
    () => queryWorkOrders(orgSlug, projectSlug, toWorkOrderQuery({ status, blueprintId, actor: effectiveActor, query, page, handle })),
    [orgSlug, projectSlug, status, blueprintId, effectiveActor, query, page],
    (result) => result.total === 0,
  );

  // Keeps the last loaded page on screen while the next one loads, so typing in the search field
  // never unmounts it (a filter change would otherwise flash the skeleton on every keystroke).
  const lastDataRef = useRef<WorkOrderPage | undefined>(undefined);
  if (listQuery.data) lastDataRef.current = listQuery.data;
  const data = listQuery.data ?? (listQuery.status === 'cargando' ? lastDataRef.current : undefined);
  const items = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const rows = useMemo(() => sortWorkOrders(items, sort), [items, sort]);

  const statusOptions = ORDENES_STATUS_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    count: data ? data.statusCounts[option.value === 'todas' ? 'all' : option.value] : undefined,
  }));

  // The full blueprint catalogue is no longer downloaded (FB-070), so the select offers the blueprints
  // of the visible page plus the active one, which must always be present.
  const blueprintIds = useMemo(() => {
    const ids = new Set(items.flatMap((order) => order.blueprints));
    if (blueprintId !== ORDENES_BLUEPRINT_ALL) ids.add(blueprintId);
    return Array.from(ids).sort((a, b) => a.localeCompare(b, 'es'));
  }, [items, blueprintId]);

  function setParam(key: string, value: string | undefined, { replace = false, keepPage = false } = {}): void {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
        if (!keepPage) next.delete('page');
        return next;
      },
      { replace },
    );
  }

  function setPage(next: number): void {
    setParam('page', next > 1 ? String(next) : undefined, { keepPage: true });
  }

  function resetFilters(): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const key of ['status', 'blueprint', 'actor', 'q', 'page']) next.delete(key);
      return next;
    });
  }

  if (listQuery.status === 'cargando' && !data) return <Skeleton rows={8} columns={5} />;
  if (listQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar las órdenes de trabajo" body={errorMessage(listQuery.error)} onRetry={listQuery.retry} />;
  }

  const hasActiveFilter = status !== 'todas' || blueprintId !== ORDENES_BLUEPRINT_ALL || effectiveActor !== 'todos' || query !== '';
  const offset = (page - 1) * ORDENES_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / ORDENES_PAGE_SIZE));
  const selfUnavailable = profileReady && handle === null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Órdenes de trabajo"
        subtitle={`${total} ${total === 1 ? 'orden' : 'órdenes'}`}
        actions={<SearchField label="Buscar órdenes" value={query} onChange={(value) => setParam('q', value, { replace: true })} placeholder="Buscar órdenes" />}
      />

      {total === 0 && !hasActiveFilter ? (
        <EmptyState title="Todavía no hay órdenes de trabajo para este proyecto" />
      ) : (
        <div className={styles.body}>
          <div className={styles.filtersBar}>
            <FilterChips
              label="Estado"
              value={status}
              onChange={(value) => setParam('status', value === 'todas' ? undefined : value)}
              options={statusOptions}
            />
            <div className={styles.selects}>
              <PlateSelect label="Blueprint" value={blueprintId} onChange={(value) => setParam('blueprint', value === ORDENES_BLUEPRINT_ALL ? undefined : value)}>
                <option value={ORDENES_BLUEPRINT_ALL}>Blueprint: todos</option>
                {blueprintIds.map((id) => (
                  <option key={id} value={id}>
                    Blueprint: {id}
                  </option>
                ))}
              </PlateSelect>
              <PlateSelect label="Asignada a" value={effectiveActor} onChange={(value) => setParam('actor', value === 'todos' ? undefined : value)}>
                {ORDENES_ACTOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value={ORDENES_ACTOR_SELF_OPTION.value} disabled={selfUnavailable}>
                  {selfUnavailable ? `${ORDENES_ACTOR_SELF_OPTION.label} — ${ORDENES_NO_HANDLE_HINT}` : ORDENES_ACTOR_SELF_OPTION.label}
                </option>
              </PlateSelect>
            </div>
            {selfUnavailable ? <p className={styles.actorHint}>{ORDENES_NO_HANDLE_HINT}</p> : null}
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

          {total > 0 ? (
            <p className={styles.footer}>
              Mostrando <span className="num">{items.length === 0 ? 0 : offset + items.length}</span> de <span className="num">{total}</span> órdenes
            </p>
          ) : null}

          {totalPages > 1 ? (
            <div className={styles.pagination}>
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Página anterior
              </Button>
              <span>
                Página {page} de {totalPages}
              </span>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Página siguiente
              </Button>
            </div>
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
