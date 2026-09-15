/**
 * Documentos list (WO-286): every mock document (mercado, producto, feature requests, blueprints,
 * decisiones, feedback y artefactos), filterable by kind and workflow state, searchable by id or
 * title, sortable, with a "Nuevo documento" flow that adds a local draft.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, DataTable, EmptyState, ErrorState, PageHeader, SearchField, Skeleton, useToast } from '../../components';
import { DOCUMENTS, type ProjectDocument } from '../../data';
import { filterItems, searchItems, sortItems, toggleSort, type SortState } from '../../lib/filter-sort';
import { useDemoState } from '../../lib/use-demo-state';
import { buildDocumentColumns } from './columns';
import { DocumentFilters, type KindFilterValue, type WorkflowFilterValue } from './DocumentFilters';
import styles from './DocumentosPage.module.css';
import type { ListedDocumentKind } from './helpers';
import { NewDocumentModal } from './NewDocumentModal';

const SUBTITLE = 'Mercado, producto, feature requests, blueprints, decisiones, feedback y artefactos de prdmanager';

function nextIdFor(documents: readonly ProjectDocument[], kind: ListedDocumentKind): string {
  const prefix = `${kind}-`;
  const maxNumber = documents
    .filter((doc) => doc.id.startsWith(prefix))
    .map((doc) => Number.parseInt(doc.id.slice(prefix.length), 10))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
}

function createDraftDocument(documents: readonly ProjectDocument[], kind: ListedDocumentKind, title: string): ProjectDocument {
  const id = nextIdFor(documents, kind);
  return {
    id,
    kind,
    title,
    workflowState: 'draft',
    origin: 'collab',
    sourcePath: `docs/${kind.toLowerCase()}/${id}.md`,
    updatedAt: new Date().toISOString(),
    updatedBy: 'ana-rios',
    tags: [],
    blocks: [{ id: `${id}-b1`, type: 'h1', text: title, author: 'ana-rios' }],
    sample: false,
  };
}

export function DocumentosPage(): ReactElement {
  const navigate = useNavigate();
  const { show } = useToast();
  const { state, retry } = useDemoState();
  const [searchParams] = useSearchParams();

  const [documents, setDocuments] = useState<readonly ProjectDocument[]>(DOCUMENTS);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [kindFilter, setKindFilter] = useState<KindFilterValue>('all');
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilterValue>('all');
  const [sort, setSort] = useState<SortState<string>>({ key: 'updatedAt', direction: 'desc' });
  const [modalOpen, setModalOpen] = useState(() => searchParams.get('nuevo') === '1');

  const now = useMemo(() => new Date(), []);
  const columns = useMemo(() => buildDocumentColumns(now), [now]);

  const filteredSorted = useMemo(() => {
    const predicates = [
      (doc: ProjectDocument) => kindFilter === 'all' || doc.kind === kindFilter,
      (doc: ProjectDocument) => workflowFilter === 'all' || doc.workflowState === workflowFilter,
    ];
    const filtered = filterItems(documents, predicates);
    const searched = searchItems(filtered, search, (doc) => [doc.id, doc.title]);
    return sortItems(searched, columns.find((column) => column.key === sort.key)?.sortValue ?? (() => undefined), sort.direction);
  }, [documents, kindFilter, workflowFilter, search, sort, columns]);

  function clearFilters(): void {
    setSearch('');
    setKindFilter('all');
    setWorkflowFilter('all');
  }

  function handleCreate(kind: ListedDocumentKind, title: string): void {
    const draft = createDraftDocument(documents, kind, title);
    setDocuments((current) => [draft, ...current]);
    show('Documento creado', { tone: 'success' });
  }

  const footerLabel =
    filteredSorted.length === documents.length
      ? `${documents.length} documentos`
      : `${documents.length} documentos · ${filteredSorted.length} coinciden con los filtros`;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Documentos"
        subtitle={SUBTITLE}
        actions={
          state === 'listo' ? (
            <>
              <SearchField label="Buscar por id o título" value={search} onChange={setSearch} placeholder="Buscar por id o título" />
              <Button type="button" variant="primary" onClick={() => setModalOpen(true)}>
                Nuevo documento
              </Button>
            </>
          ) : null
        }
      />

      {state === 'cargando' ? <Skeleton rows={6} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar los documentos." body="Revisá tu conexión e intentá de nuevo." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState
          title="No hay documentos todavía"
          body="Creá el primero para empezar a versionarlo."
          action={{ label: 'Nuevo documento', onClick: () => setModalOpen(true) }}
        />
      ) : null}

      {state === 'listo' ? (
        <>
          <DocumentFilters
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
            workflowFilter={workflowFilter}
            onWorkflowFilterChange={setWorkflowFilter}
          />

          <DataTable
            caption="Documentos"
            columns={columns}
            rows={filteredSorted}
            getRowId={(doc) => doc.id}
            sort={sort}
            onSortChange={setSort}
            onRowClick={(doc) => navigate(`/documentos/${doc.id}`)}
            emptyState={
              <div className={styles.emptyFilterResult}>
                <p>Ningún documento coincide con estos filtros.</p>
                <Button type="button" variant="secondary" onClick={clearFilters}>
                  Quitar filtros
                </Button>
              </div>
            }
          />

          <footer className={styles.footer}>
            <span className="num">{footerLabel}</span>
          </footer>
        </>
      ) : null}

      <NewDocumentModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={handleCreate} />
    </div>
  );
}
