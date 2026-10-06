/**
 * `/o/:orgSlug/p/:projectSlug/entrada` (SDD-013 §"Shell y router", WO-362; SDD-065 WO-B): the real
 * feedback/artifact triage inbox — `listInbox` (SDD-065 D3 `{items,total}` envelope), filterable by
 * estado/tipo/fuente and by a free-text query, with a «Recibido» column, sort wired to the `DataTable`
 * (D2), client pagination and the automatic items folded into a collapsible block (D6).
 *
 * The URL is the source of truth for filtros, búsqueda, orden y página (D4): every control writes the
 * query string through {@link updateQuery} and the list is rebuilt from it on each render. The screen
 * fetches the inbox once (`limit` bounded by `MAX_INBOX_LIMIT`) and does filter/sort/page in the client —
 * the endpoint does not expose a sort param, so sorting by título/id across the whole set needs the full
 * filtered list (realistic inbox fits in one fetch, per D3's own note).
 *
 * Triage (WO-C): per-row Enlazar / Descartar / Marcar duplicado, a checkbox selection with a batch bar
 * against `triage-batch`, the item Drawer and the Descartados chip. Still pending: the per-row accessible
 * names (WO-D).
 */
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { MAX_INBOX_LIMIT, type InboxItemDto } from '@prdm/contracts';
import { ApiClientError, dismissFeedback, listInbox, markDuplicate, submitFeedback, triageBatch } from '../api/client.js';
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
  SelectField,
  Skeleton,
  ToastProvider,
  useToast,
  type DataTableColumn,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { LinkFeatureModal } from './entrada/LinkFeatureModal.js';
import { ItemDrawer } from './entrada/ItemDrawer.js';
import { Pagination } from './entrada/Pagination.js';
import { RegisterFeedbackModal } from './entrada/RegisterFeedbackModal.js';
import {
  ALL_SOURCES,
  ENTRADA_PAGE_SIZE,
  buildEntradaList,
  defaultDirection,
  formatReceivedDate,
  inboxSources,
  parseEntradaQuery,
  statusLabel,
  toEntradaSearchParams,
  type EntradaEstado,
  type EntradaQuery,
  type EntradaSortKey,
  type EntradaTipo,
} from './entrada/entrada-filters.js';
import { TriageActionModal, type TriageActionInput } from './entrada/TriageActionModal.js';
import styles from './entrada/Entrada.module.css';

const ESTADO_OPTIONS: readonly { value: EntradaEstado; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'new', label: 'Sin triar' },
  { value: 'triaged', label: 'Triados' },
  { value: 'dismissed', label: 'Descartados' },
  { value: 'closed', label: 'Cerrados' },
];

const TIPO_OPTIONS: readonly { value: EntradaTipo; label: string }[] = [
  { value: 'todos', label: 'Tipo: todos' },
  { value: 'FB', label: 'Tipo: FB' },
  { value: 'ART', label: 'Tipo: ART' },
];

/** The triage action waiting for its confirmation: one row (`ids` has one entry) or the batch selection. */
interface PendingAction {
  readonly mode: 'dismiss' | 'duplicate';
  readonly ids: readonly string[];
  /** True when it comes from the batch bar (goes through `triage-batch` even for one id). */
  readonly batch: boolean;
}

const PENDING_REPUBLISH_STATUS = 409;

/** Header of the collapsible block D6 folds the `agent:*` items into. */
function AutomaticGroup({
  count,
  open,
  onToggle,
  children,
}: {
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className={styles.automaticGroup} aria-label="Ítems automáticos">
      <button type="button" className={styles.automaticToggle} aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
        Automáticos ({count})
      </button>
      {open ? children : null}
    </section>
  );
}

function EntradaContent(): ReactElement {
  const { orgSlug, projectSlug } = useProjectShellContext();
  useDocumentTitle('Bandeja de entrada');
  const { show } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(() => parseEntradaQuery(searchParams), [searchParams]);

  const [automaticOpen, setAutomaticOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<InboxItemDto | undefined>(undefined);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [action, setAction] = useState<PendingAction | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const listQuery = useApiQuery(
    `inbox:${orgSlug}:${projectSlug}`,
    () => listInbox(orgSlug, projectSlug, { limit: MAX_INBOX_LIMIT }),
    [orgSlug, projectSlug],
  );
  const items = listQuery.data?.items ?? [];
  const serverTotal = listQuery.data?.total ?? items.length;

  /** Writes the next state into the URL (D4); anything changed by a control resets to page 1. */
  function updateQuery(patch: Partial<EntradaQuery>): void {
    setSearchParams(toEntradaSearchParams({ ...query, ...patch }));
  }

  useEffect(() => setSelected(new Set()), [query]);

  const counts = useMemo(() => {
    const result: Record<EntradaEstado, number> = { todos: items.length, new: 0, triaged: 0, dismissed: 0, closed: 0 };
    for (const item of items) {
      if (item.status === 'new') result.new += 1;
      if (item.status === 'triaged') result.triaged += 1;
      if (item.status === 'dismissed') result.dismissed += 1;
      if (item.status === 'closed') result.closed += 1;
    }
    return result;
  }, [items]);

  const sources = useMemo(() => inboxSources(items), [items]);
  const list = useMemo(() => buildEntradaList(items, query), [items, query]);
  const matchCount = list.manual.total + list.automatic.length;
  const rows = list.manual.items;
  const drawerItem = items.find((item) => item.id === drawerId);
  const selectedIds = useMemo(() => [...selected].sort(), [selected]);

  function toggleSelected(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAction(mode: PendingAction['mode'], ids: readonly string[], batch: boolean): void {
    setActionError(null);
    setAction({ mode, ids, batch });
  }

  function closeAction(): void {
    setAction(null);
    setActionError(null);
  }

  function finishAction(message: string, tone: 'success' | 'neutral'): void {
    closeAction();
    setSelected(new Set());
    show(message, { tone });
    listQuery.retry();
  }

  async function runSingle(pending: PendingAction, input: TriageActionInput): Promise<void> {
    const id = pending.ids[0] ?? '';
    if (pending.mode === 'dismiss') {
      await dismissFeedback(orgSlug, projectSlug, id, { reason: input.reason });
      finishAction(`${id} descartado`, 'success');
      return;
    }
    const duplicateOf = input.duplicateOf ?? '';
    await markDuplicate(orgSlug, projectSlug, id, { duplicateOf });
    finishAction(`${id} marcado como duplicado de ${duplicateOf}`, 'success');
  }

  async function runBatch(pending: PendingAction, input: TriageActionInput): Promise<void> {
    const result = await triageBatch(orgSlug, projectSlug, { action: pending.mode, ids: [...pending.ids], reason: input.reason, duplicateOf: input.duplicateOf });
    if (result.failed === 0) {
      finishAction(`${result.ok} ítems ${pending.mode === 'dismiss' ? 'descartados' : 'marcados como duplicados'}`, 'success');
      return;
    }
    const failures = result.results.filter((r) => !r.ok).map((r) => `${r.id} (${r.error ?? 'error'})`);
    finishAction(`${result.ok} actualizados; ${result.failed} no se pudieron actualizar: ${failures.join(', ')}`, 'neutral');
  }

  async function handleActionConfirm(input: TriageActionInput): Promise<void> {
    if (!action) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      if (action.batch) await runBatch(action, input);
      else await runSingle(action, input);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === PENDING_REPUBLISH_STATUS) {
        setActionError(`${action.ids.join(', ')} tiene una copia de trabajo colaborativa activa: el ${action.mode === 'dismiss' ? 'descarte' : 'cambio'} se va a aplicar recién cuando se republique el documento.`);
      } else {
        setActionError(errorMessage(err));
      }
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleRegisterConfirm(input: { text: string; source: string; title?: string; customer?: string }): Promise<void> {
    setRegisterSubmitting(true);
    setRegisterError(null);
    try {
      await submitFeedback(orgSlug, projectSlug, input);
      setRegisterOpen(false);
      show('Feedback registrado', { tone: 'success' });
      listQuery.retry();
    } catch (err) {
      setRegisterError(errorMessage(err));
    } finally {
      setRegisterSubmitting(false);
    }
  }

  function handleLinked(featureId: string): void {
    setLinkTarget(undefined);
    show(`Feedback enlazado a ${featureId}`, { tone: 'success' });
    listQuery.retry();
  }

  const columns: readonly DataTableColumn<InboxItemDto>[] = [
    {
      key: 'select',
      header: 'Seleccionar',
      render: (item) => (
        <input
          type="checkbox"
          className={styles.checkbox}
          name={`select-${item.id}`}
          aria-label={`Seleccionar ${item.id}`}
          checked={selected.has(item.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelected(item.id)}
        />
      ),
      width: '96px',
    },
    { key: 'id', header: 'Id', render: (item) => <IdTag id={item.id} />, sortValue: (item) => item.id, width: '96px' },
    { key: 'kind', header: 'Tipo', render: (item) => item.kind, sortValue: (item) => item.kind, width: '64px' },
    { key: 'title', header: 'Título', render: (item) => item.title },
    { key: 'source', header: 'Fuente', render: (item) => item.source, sortValue: (item) => item.source, width: '140px' },
    {
      key: 'receivedAt',
      header: 'Recibido',
      render: (item) => (
        <time className={`${styles.date} num`} dateTime={item.receivedAt}>
          {formatReceivedDate(item.receivedAt)}
        </time>
      ),
      sortValue: (item) => item.receivedAt,
      width: '112px',
    },
    {
      key: 'status',
      header: 'Estado',
      render: (item) => (
        <span className={styles.status}>
          {item.status === 'new' ? <span className={styles.statusDotNew} aria-hidden="true" /> : null}
          {statusLabel(item.status)}
        </span>
      ),
      sortValue: (item) => item.status,
      width: '120px',
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (item) =>
        item.status === 'dismissed' || item.status === 'duplicate' ? null : (
          <div className={styles.rowActions}>
            {item.status === 'new' ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                aria-label={`Enlazar ${item.id} a una feature`}
                onClick={(event) => {
                  event.stopPropagation();
                  setLinkTarget(item);
                }}
              >
                Enlazar a feature
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Descartar ${item.id}`}
              onClick={(event) => {
                event.stopPropagation();
                openAction('dismiss', [item.id], false);
              }}
            >
              Descartar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Marcar duplicado ${item.id}`}
              onClick={(event) => {
                event.stopPropagation();
                openAction('duplicate', [item.id], false);
              }}
            >
              Marcar duplicado
            </Button>
          </div>
        ),
      width: '320px',
    },
  ];

  if (listQuery.status === 'cargando') return <Skeleton rows={6} columns={5} />;
  if (listQuery.status === 'error') {
    return <ErrorState title="No pudimos cargar la bandeja de entrada" body={errorMessage(listQuery.error)} onRetry={listQuery.retry} />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Bandeja de entrada"
        subtitle="Feedback y artifacts que todavía no justifican una feature"
        actions={
          <Button type="button" variant="secondary" onClick={() => setRegisterOpen(true)}>
            Registrar feedback
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="Todavía no hay feedback ni artifacts para este proyecto" />
      ) : (
        <div className={styles.body}>
          <p className="visually-hidden" role="status" aria-live="polite">
            {selected.size > 0 ? `${selected.size} ítems seleccionados` : ''}
          </p>
          <div className={styles.filtersBar}>
            <FilterChips
              label="Estado"
              value={query.estado}
              onChange={(value) => updateQuery({ estado: value as EntradaEstado, page: 1 })}
              options={ESTADO_OPTIONS.map((option) => ({ value: option.value, label: option.label, count: counts[option.value] }))}
            />
            <div className={styles.selectWrapper}>
              <select
                id="entrada-tipo"
                name="tipo"
                aria-label="Tipo"
                className={styles.select}
                value={query.tipo}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => updateQuery({ tipo: event.target.value as EntradaTipo, page: 1 })}
              >
                {TIPO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" size={16} className={styles.selectIcon} />
            </div>
            <div className={styles.selectWrapper}>
              <SelectField
                label="Fuente"
                hideLabel
                value={query.fuente}
                options={[{ value: ALL_SOURCES, label: 'Todas las fuentes' }, ...sources.map((source) => ({ value: source, label: source }))]}
                onChange={(value) => updateQuery({ fuente: value, page: 1 })}
              />
            </div>
            <div className={styles.searchWrapper}>
              <SearchField
                label="Buscar en la bandeja"
                value={query.q}
                placeholder="Buscar por id, título o texto"
                onChange={(value) => updateQuery({ q: value, page: 1 })}
              />
            </div>
          </div>

          {selected.size > 0 ? (
            <div className={styles.batchBar}>
              <span className={styles.batchCount}>{selected.size} seleccionados</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => openAction('dismiss', selectedIds, true)}>
                Descartar seleccionados
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => openAction('duplicate', selectedIds, true)}>
                Marcar duplicados
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                Limpiar selección
              </Button>
            </div>
          ) : null}

          <DataTable
            caption="Bandeja de entrada"
            columns={columns}
            rows={rows}
            getRowId={(item) => item.id}
            onRowClick={(item) => setDrawerId(item.id)}
            selectedId={drawerId}
            sort={{ key: query.sort, direction: query.dir }}
            onSortChange={(next) => {
              const key = next.key as EntradaSortKey;
              updateQuery({ sort: key, dir: key === query.sort ? next.direction : defaultDirection(key), page: 1 });
            }}
            emptyState={
              <EmptyState
                title={
                  matchCount === 0
                    ? 'Ningún ítem coincide con estos filtros'
                    : 'Los ítems que coinciden son automáticos; mirá el bloque de abajo'
                }
              />
            }
          />

          <Pagination
            page={list.manual.page}
            pageCount={list.manual.pageCount}
            total={list.manual.total}
            pageSize={ENTRADA_PAGE_SIZE}
            onChange={(page) => updateQuery({ page })}
          />

          {serverTotal > items.length ? (
            <p className={styles.truncatedNote}>
              Se muestran los primeros {items.length} de {serverTotal} ítems.
            </p>
          ) : null}

          {list.automatic.length > 0 ? (
            <AutomaticGroup count={list.automatic.length} open={automaticOpen} onToggle={() => setAutomaticOpen((open) => !open)}>
              <DataTable
                caption="Ítems automáticos"
                columns={columns}
                rows={list.automatic}
                getRowId={(item) => item.id}
                onRowClick={(item) => setDrawerId(item.id)}
                selectedId={drawerId}
              />
            </AutomaticGroup>
          ) : null}
        </div>
      )}

      <LinkFeatureModal orgSlug={orgSlug} projectSlug={projectSlug} item={linkTarget} onClose={() => setLinkTarget(undefined)} onLinked={handleLinked} />

      {drawerItem !== undefined ? <ItemDrawer item={drawerItem} onClose={() => setDrawerId(undefined)} /> : null}

      {action !== null ? (
        <TriageActionModal
          mode={action.mode}
          ids={action.ids}
          targetLabel={!action.batch ? (action.ids[0] ?? '') : `${action.ids.length} ítems seleccionados`}
          submitting={actionSubmitting}
          error={actionError}
          onClose={closeAction}
          onConfirm={(input) => void handleActionConfirm(input)}
        />
      ) : null}

      <RegisterFeedbackModal
        open={registerOpen}
        submitting={registerSubmitting}
        error={registerError}
        onClose={() => {
          setRegisterOpen(false);
          setRegisterError(null);
        }}
        onConfirm={(input) => void handleRegisterConfirm(input)}
      />
    </div>
  );
}

export function Entrada(): ReactElement {
  return (
    <ToastProvider>
      <EntradaContent />
    </ToastProvider>
  );
}
