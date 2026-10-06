/**
 * `/o/:orgSlug/p/:projectSlug/ordenes` (SDD-013 §"Shell y router", WO-360): every work order for this
 * project, filtered, searched and paged server-side (SDD-064) with the URL as source of truth; sortable by
 * column within the visible page. Clicking a row opens `OrderDrawer` with that order's real context.
 *
 * SDD-086 §D6/§D7: the table can select several rows, and the batch bar over that selection archives or
 * takes them through `POST .../work-orders/batch` — per-item results, never aborting the rest. With no
 * orders at all, the empty state says where they come from (a blueprint's `## Tareas` checklist) and
 * opens the way to Construir.
 */
import { ChevronDown, ClipboardCheck, GitCommitHorizontal } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { DeliverableKind, WorkOrderPage, WorkOrderSummary } from '@prdm/core';
import { batchWorkOrders, getProfile, queryWorkOrders } from '../api/client.js';
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
  useToast,
  type DataTableColumn,
} from '../components/index.js';
import { projectBasePath } from '../components/shell/project-nav.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import type { SortState } from '../lib/filter-sort.js';
import { WORK_PROFILE_COPY } from './inicio/work-profiles.js';
import { BatchOrderModal, type BatchOrderAction, type BatchOrderInput } from './ordenes/BatchOrderModal.js';
import { DELIVERABLE_COPY_LIST, deliverableCopy } from './ordenes/deliverable-label.js';
import { OrderDrawer } from './ordenes/OrderDrawer.js';
import {
  asWorkOrderStatus,
  ORDENES_ACTOR_OPTIONS,
  ORDENES_ACTOR_SELF_OPTION,
  ORDENES_BLUEPRINT_ALL,
  countDeliverables,
  matchesDeliverable,
  ORDENES_DEFAULT_SORT,
  ORDENES_DELIVERABLE_OPTIONS,
  ORDENES_NO_HANDLE_HINT,
  ORDENES_PAGE_SIZE,
  ORDENES_STATUS_OPTIONS,
  parseActorFilter,
  parseDeliverableFilter,
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

/** The server's own cap on one batch (`batchWorkOrdersInputSchema`: 1..200 ids), refused locally so the
 * user never gets a bare "invalid body" from a body they built by selecting across pages. */
const BATCH_LIMIT = 200;

interface BatchFailure {
  readonly id: string;
  readonly error: string;
}

/**
 * One line for the toast: the count when everything went through, otherwise the count plus the items that
 * did not — named with the server's own message, capped so a 200-item failure stays readable (the full,
 * per-item list stays on the screen below).
 */
function batchToastMessage(action: BatchOrderAction, applied: number, total: number, failures: readonly BatchFailure[]): string {
  const archive = action === 'archive';
  const singular = archive ? 'archivada' : 'tomada';
  const plural = archive ? 'archivadas' : 'tomadas';
  if (failures.length === 0) return applied === 1 ? `1 orden ${singular}` : `${applied} órdenes ${plural}`;

  const named = failures.slice(0, 3).map((failure) => `${failure.id} (${failure.error})`).join(', ');
  const rest = failures.length > 3 ? ` y ${failures.length - 3} más` : '';
  return `${applied} de ${total} ${plural}; no se pudieron ${archive ? 'archivar' : 'tomar'}: ${named}${rest}`;
}

function DeliverableMarker({ kind, label }: { readonly kind: DeliverableKind; readonly label: string }): ReactElement {
  const Icono = kind === 'gate' ? ClipboardCheck : GitCommitHorizontal;
  return (
    <span className={styles.deliverable}>
      <Icono aria-hidden="true" size={14} className={styles.deliverableIcon} />
      {label}
    </span>
  );
}

function deliverableCell(order: WorkOrderSummary): ReactElement {
  const copy = deliverableCopy(order.deliverableKind);
  return <DeliverableMarker kind={copy.kind} label={copy.label} />;
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
    { key: 'deliverable', header: 'Entregable', render: deliverableCell, width: '112px' },
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
  const { orgSlug, projectSlug, workProfile } = useProjectShellContext();
  useDocumentTitle('Órdenes de trabajo');

  const navigate = useNavigate();
  const { show } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sort, setSort] = useState<SortState<OrdenesSortKey>>(ORDENES_DEFAULT_SORT);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [batchAction, setBatchAction] = useState<BatchOrderAction | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchFailures, setBatchFailures] = useState<readonly BatchFailure[]>([]);

  // The URL is the source of truth for every filter and the page (SDD-064 D6).
  const status = parseStatusFilter(searchParams.get('status'));
  const blueprintId = searchParams.get('blueprint') ?? ORDENES_BLUEPRINT_ALL;
  const actor = parseActorFilter(searchParams.get('actor'));
  const tipo = parseDeliverableFilter(searchParams.get('tipo'));
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
  const rows = useMemo(() => sortWorkOrders(items.filter((order) => matchesDeliverable(order, tipo)), sort), [items, tipo, sort]);
  const deliverableCounts = useMemo(() => countDeliverables(items), [items]);
  const selectedIds = useMemo(() => [...selected].sort(), [selected]);

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
      for (const key of ['status', 'blueprint', 'actor', 'tipo', 'q', 'page']) next.delete(key);
      return next;
    });
  }

  function closeBatch(): void {
    setBatchAction(null);
    setBatchError(null);
  }

  /**
   * One batch over the current selection (SDD-086 §D6). A whole request that fails — no permission for
   * that action, an invalid body — keeps the selection and reports inside the modal; a per-item failure is
   * data (`ok: false`) that never aborts the rest, so the list refreshes either way.
   */
  async function runBatch(action: BatchOrderAction, input: BatchOrderInput): Promise<void> {
    if (selectedIds.length > BATCH_LIMIT) {
      setBatchError(`El lote acepta hasta ${BATCH_LIMIT} órdenes. Quitá algunas de la selección y volvé a intentar.`);
      return;
    }

    setBatchSubmitting(true);
    setBatchError(null);
    try {
      const result = await batchWorkOrders(orgSlug, projectSlug, {
        action,
        ids: selectedIds,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      });
      const failures = result.results
        .filter((item) => !item.ok)
        .map((item) => ({ id: item.id, error: item.error ?? 'el servidor no dijo por qué' }));
      const applied = action === 'archive' ? result.archived : result.claimed;

      setBatchFailures(failures);
      setSelected(new Set());
      closeBatch();
      listQuery.retry();
      show(batchToastMessage(action, applied, result.results.length, failures), {
        tone: failures.length === 0 ? 'success' : 'neutral',
      });
    } catch (err) {
      setBatchError(errorMessage(err));
    } finally {
      setBatchSubmitting(false);
    }
  }

  /** SDD-086 §D7: with no orders at all, the way out is where they come from — Construir. Whoever has a
   * work profile lands on their own path; without one, the line's own start (the business case). */
  function goToConstruir(): void {
    const destination = WORK_PROFILE_COPY[workProfile ?? 'negocio'].destination;
    void navigate(`${projectBasePath(orgSlug, projectSlug)}/${destination}`);
  }

  if (listQuery.status === 'cargando' && !data) return <Skeleton rows={8} columns={5} />;
  if (listQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar las órdenes de trabajo" body={errorMessage(listQuery.error)} onRetry={listQuery.retry} />;
  }

  const hasActiveFilter = status !== 'todas' || blueprintId !== ORDENES_BLUEPRINT_ALL || effectiveActor !== 'todos' || tipo !== 'todas' || query !== '';
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
        <EmptyState
          title="Todavía no hay órdenes de trabajo para este proyecto"
          body="Las órdenes no se crean a mano: se generan del checklist «## Tareas» de un blueprint publicado (un SDD o un ADR)."
          action={{ label: 'Ir a Construir', onClick: goToConstruir }}
        />
      ) : (
        <div className={styles.body}>
          <div className={styles.filtersBar}>
            <FilterChips
              label="Estado"
              value={status}
              onChange={(value) => setParam('status', value === 'todas' ? undefined : value)}
              options={statusOptions}
            />
            <FilterChips
              label="Tipo"
              value={tipo}
              onChange={(value) => setParam('tipo', value === 'todas' ? undefined : value)}
              options={ORDENES_DELIVERABLE_OPTIONS.map((option) => ({ ...option, count: deliverableCounts[option.value] }))}
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

          <ul className={styles.deliverableLegend} aria-label="Cómo se cierra cada tipo de entregable">
            {DELIVERABLE_COPY_LIST.map((copy) => (
              <li key={copy.kind}>
                <DeliverableMarker kind={copy.kind} label={copy.label} /> — {copy.legend}
              </li>
            ))}
          </ul>

          {selected.size >= 2 ? (
            <div className={styles.batchBar} role="group" aria-label="Acciones en lote">
              <span className={styles.batchCount}>{selected.size} órdenes seleccionadas</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => setBatchAction('archive')}>
                Archivar seleccionadas
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setBatchAction('claim')}>
                Tomar seleccionadas
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Limpiar selección
              </Button>
            </div>
          ) : null}

          {batchFailures.length > 0 ? (
            <ul aria-label="Órdenes que no se pudieron actualizar" className={styles.batchFailures}>
              {batchFailures.map((failure) => (
                <li key={failure.id}>
                  <IdTag id={failure.id} /> — {failure.error}
                </li>
              ))}
            </ul>
          ) : null}

          <DataTable
            caption="Órdenes de trabajo"
            columns={buildColumns()}
            rows={rows}
            getRowId={(order) => order.id}
            sort={sort}
            onSortChange={(next) => setSort(next as SortState<OrdenesSortKey>)}
            onRowClick={(order) => setOpenId(order.id)}
            selectedId={openId}
            selection={{ selectedIds: selected, onChange: setSelected }}
            emptyState={
              <EmptyState
                title="Ninguna orden coincide con estos filtros"
                action={{ label: 'Quitar filtros', onClick: resetFilters }}
              />
            }
          />

          {total > 0 ? (
            <p className={styles.footer}>
              Mostrando <span className="num">{rows.length === 0 ? 0 : offset + rows.length}</span> de <span className="num">{total}</span> órdenes
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

      {batchAction ? (
        <BatchOrderModal
          action={batchAction}
          ids={selectedIds}
          handle={handle}
          submitting={batchSubmitting}
          error={batchError}
          onClose={closeBatch}
          onConfirm={(input) => void runBatch(batchAction, input)}
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
