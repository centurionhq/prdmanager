/**
 * `/o/:orgSlug/p/:projectSlug/documents` (SDD-013 §"Documentos"): every document in the project —
 * searchable by id/título, filterable by tipo/estado de flujo, sortable by column — plus "Nuevo
 * documento" gated to `edit_document`. Ports `Documentos.dc.html` onto real data via `useProjectShellContext`
 * (the project's real role, never a simulated one) and `useApiQuery` (WO-349).
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  can,
  DOCUMENT_KINDS,
  DOCUMENT_WORKFLOW_STATES,
  type DocumentKind,
  type DocumentSummary,
  type DocumentWorkflowState,
} from '@prdm/contracts';
import { relativeDate } from '../collab/blame-gutter.js';
import { listDocuments } from '../api/client.js';
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
  type DataTableColumn,
} from '../components/index.js';
import { searchItems, sortItems, type SortState } from '../lib/filter-sort.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { NewDocumentModal } from './new-document-modal.js';
import styles from './DocumentsList.module.css';

const PAGE_SIZE = 10;

const KIND_LABEL: Record<DocumentKind, string> = {
  MRD: 'Mercado',
  PRD: 'Producto',
  FR: 'Feature request',
  SDD: 'Blueprint',
  ADR: 'Decisión',
  WO: 'Orden de trabajo',
  ART: 'Artefacto',
  FB: 'Feedback',
};

const STATE_LABEL: Record<DocumentWorkflowState, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  published: 'Publicado',
  archived: 'Archivado',
};

const KIND_OPTIONS = [{ value: '', label: 'Todos' }, ...DOCUMENT_KINDS.map((kind) => ({ value: kind, label: kind }))];

function columns(orgSlug: string, projectSlug: string): readonly DataTableColumn<DocumentSummary>[] {
  return [
    {
      key: 'docId',
      header: 'Id',
      render: (row) => <IdTag id={row.docId} />,
      sortValue: (row) => row.docId,
      rowLink: (row) => `/o/${orgSlug}/p/${projectSlug}/documents/${row.docId}`,
    },
    { key: 'kind', header: 'Tipo', render: (row) => KIND_LABEL[row.kind], sortValue: (row) => KIND_LABEL[row.kind] },
    { key: 'title', header: 'Título', render: (row) => row.title, sortValue: (row) => row.title },
    {
      key: 'workflowState',
      header: 'Estado de flujo',
      render: (row) => <StatusBadge kind="workflow" status={row.workflowState} />,
      sortValue: (row) => STATE_LABEL[row.workflowState],
    },
    {
      key: 'updatedAt',
      header: 'Actualizado',
      align: 'end',
      render: (row) => relativeDate(row.updatedAt),
      sortValue: (row) => row.updatedAt,
    },
  ];
}

export function DocumentsList(): ReactElement {
  const { orgSlug, projectSlug, subject } = useProjectShellContext();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<DocumentKind | ''>('');
  const [stateFilter, setStateFilter] = useState<DocumentWorkflowState | ''>('');
  const [sort, setSort] = useState<SortState<string>>({ key: 'updatedAt', direction: 'desc' });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useDocumentTitle('Documentos');

  const query = useApiQuery(
    `documents:${orgSlug}:${projectSlug}:${kindFilter}:${stateFilter}`,
    () => listDocuments(orgSlug, projectSlug, { kind: kindFilter || undefined, workflowState: stateFilter || undefined }),
    [orgSlug, projectSlug, kindFilter, stateFilter],
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, kindFilter, stateFilter]);

  const canCreate = can(subject, 'edit_document');

  const documents = query.data ?? [];
  const searched = searchItems(documents, search, (doc) => [doc.docId, doc.title]);
  const sorted = sortItems(searched, columns(orgSlug, projectSlug).find((c) => c.key === sort.key)?.sortValue ?? (() => undefined), sort.direction);
  const visible = sorted.slice(0, visibleCount);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Documentos"
        subtitle="Mercado, producto, feature requests, blueprints, decisiones, feedback y artefactos de prdmanager"
        actions={canCreate ? <NewDocumentModal orgSlug={orgSlug} projectSlug={projectSlug} onCreated={() => query.retry()} /> : undefined}
      />

      <div className={styles.filters}>
        <div className={styles.search}>
          <SearchField label="Buscar por id o título" value={search} onChange={setSearch} placeholder="Buscar por id o título" hideLabel={false} />
        </div>
        <FilterChips label="Tipo" options={KIND_OPTIONS} value={kindFilter} onChange={(value) => setKindFilter(value as DocumentKind | '')} />
        <div className={styles.stateField}>
          <label htmlFor="documents-filter-state" className={styles.stateLabel}>
            Estado
          </label>
          <select
            id="documents-filter-state"
            className={styles.stateSelect}
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as DocumentWorkflowState | '')}
          >
            <option value="">Todos los estados</option>
            {DOCUMENT_WORKFLOW_STATES.map((state) => (
              <option key={state} value={state}>
                {STATE_LABEL[state]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {query.status === 'cargando' && <Skeleton rows={5} />}
      {query.status === 'error' && <ErrorState title="No pudimos cargar los documentos" body={errorMessage(query.error)} onRetry={query.retry} />}
      {query.status === 'vacio' && <EmptyState title="Todavía no hay documentos en este proyecto" />}

      {query.status === 'listo' && (
        <>
          <DataTable
            caption="Documentos"
            columns={columns(orgSlug, projectSlug)}
            rows={visible}
            getRowId={(row) => row.id}
            sort={sort}
            onSortChange={setSort}
            emptyState={<span>No hay documentos que coincidan con la búsqueda.</span>}
          />
          <div className={styles.footer}>
            <span className={styles.count}>
              {sorted.length} documento{sorted.length === 1 ? '' : 's'} · mostrando {visible.length}
            </span>
            {visibleCount < sorted.length && (
              <button type="button" className={styles.stateSelect} onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Mostrar {Math.min(PAGE_SIZE, sorted.length - visibleCount)} más
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
