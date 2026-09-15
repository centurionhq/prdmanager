/**
 * `/o/:orgSlug/p/:projectSlug/entrada` (SDD-013 §"Shell y router", WO-362): the real feedback/artifact
 * triage inbox — `listInbox`, filterable by estado (`new`/`triaged`) and tipo (`FB`/`ART`), "Enlazar a
 * feature" (`getFeedbackCandidates` + `triageFeedback`) and "Registrar feedback" (`submitFeedback`).
 */
import { ChevronDown } from 'lucide-react';
import { useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import type { InboxItemDto } from '@prdm/contracts';
import { listInbox, submitFeedback } from '../api/client.js';
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
  Skeleton,
  ToastProvider,
  useToast,
  type DataTableColumn,
} from '../components/index.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { LinkFeatureModal } from './entrada/LinkFeatureModal.js';
import { RegisterFeedbackModal } from './entrada/RegisterFeedbackModal.js';
import styles from './entrada/Entrada.module.css';

type EstadoFilter = 'todos' | 'new' | 'triaged';
type TipoFilter = 'todos' | 'FB' | 'ART';

const ESTADO_OPTIONS: readonly { value: EstadoFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'new', label: 'Sin triar' },
  { value: 'triaged', label: 'Triados' },
];

function matchesEstado(item: InboxItemDto, estado: EstadoFilter): boolean {
  return estado === 'todos' || item.status === estado;
}

function matchesTipo(item: InboxItemDto, tipo: TipoFilter): boolean {
  return tipo === 'todos' || item.kind === tipo;
}

function statusLabel(status: string): string {
  if (status === 'new') return 'Sin triar';
  if (status === 'triaged') return 'Triado';
  return status;
}

function EntradaContent(): ReactElement {
  const { orgSlug, projectSlug } = useProjectShellContext();
  useDocumentTitle('Bandeja de entrada');
  const { show } = useToast();

  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [tipo, setTipo] = useState<TipoFilter>('todos');
  const [linkTarget, setLinkTarget] = useState<InboxItemDto | undefined>(undefined);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const listQuery = useApiQuery(`inbox:${orgSlug}:${projectSlug}`, () => listInbox(orgSlug, projectSlug), [orgSlug, projectSlug]);
  const items = listQuery.data ?? [];

  const counts = useMemo(() => {
    const result: Record<EstadoFilter, number> = { todos: items.length, new: 0, triaged: 0 };
    for (const item of items) {
      if (item.status === 'new') result.new += 1;
      if (item.status === 'triaged') result.triaged += 1;
    }
    return result;
  }, [items]);

  const rows = useMemo(() => items.filter((item) => matchesEstado(item, estado) && matchesTipo(item, tipo)), [items, estado, tipo]);

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
    { key: 'id', header: 'Id', render: (item) => <IdTag id={item.id} />, sortValue: (item) => item.id, width: '96px' },
    { key: 'kind', header: 'Tipo', render: (item) => item.kind, sortValue: (item) => item.kind, width: '64px' },
    { key: 'title', header: 'Título', render: (item) => item.title },
    { key: 'source', header: 'Fuente', render: (item) => item.source, sortValue: (item) => item.source, width: '140px' },
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
        item.status === 'new' ? (
          <Button type="button" variant="primary" size="sm" onClick={() => setLinkTarget(item)}>
            Enlazar a feature
          </Button>
        ) : null,
      width: '160px',
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
          <div className={styles.filtersBar}>
            <FilterChips
              label="Estado"
              value={estado}
              onChange={(value) => setEstado(value as EstadoFilter)}
              options={ESTADO_OPTIONS.map((option) => ({ value: option.value, label: option.label, count: counts[option.value] }))}
            />
            <div className={styles.selectWrapper}>
              <select aria-label="Tipo" className={styles.select} value={tipo} onChange={(event: ChangeEvent<HTMLSelectElement>) => setTipo(event.target.value as TipoFilter)}>
                <option value="todos">Tipo: todos</option>
                <option value="FB">Tipo: FB</option>
                <option value="ART">Tipo: ART</option>
              </select>
              <ChevronDown aria-hidden="true" size={16} className={styles.selectIcon} />
            </div>
          </div>

          <DataTable
            caption="Bandeja de entrada"
            columns={columns}
            rows={rows}
            getRowId={(item) => item.id}
            emptyState={<EmptyState title="Ningún ítem coincide con estos filtros" />}
          />
        </div>
      )}

      <LinkFeatureModal orgSlug={orgSlug} projectSlug={projectSlug} item={linkTarget} onClose={() => setLinkTarget(undefined)} onLinked={handleLinked} />

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
