/**
 * Column definitions for the Documentos table (WO-286), split out so DocumentosPage.tsx stays
 * focused on state and composition.
 */
import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { IdTag, Severity, StatusBadge, type DataTableColumn } from '../../components';
import { validationIssuesForDocument, type ProjectDocument } from '../../data';
import styles from './DocumentosPage.module.css';
import { formatUpdated, kindLabel, summarizeValidation, type ListedDocumentKind } from './helpers';

function ValidationCell({ doc }: { readonly doc: ProjectDocument }): ReactElement {
  const errorCount = validationIssuesForDocument(doc.id).filter((issue) => issue.severity === 'error').length;
  const summary = summarizeValidation(errorCount);

  if (summary.errorCount === 0) {
    return (
      <span className={styles.validationOk}>
        <Check aria-hidden="true" size={16} />
        {summary.label}
      </span>
    );
  }
  return <Severity severity="error" label={summary.label} />;
}

export function buildDocumentColumns(now: Date): readonly DataTableColumn<ProjectDocument>[] {
  return [
    {
      key: 'id',
      header: 'Id',
      width: '112px',
      render: (doc) => <IdTag id={doc.id} />,
      sortValue: (doc) => doc.id,
    },
    {
      key: 'kind',
      header: 'Tipo',
      width: '136px',
      render: (doc) => kindLabel(doc.kind as ListedDocumentKind),
      sortValue: (doc) => kindLabel(doc.kind as ListedDocumentKind),
    },
    {
      key: 'title',
      header: 'Título',
      render: (doc) => doc.title,
      sortValue: (doc) => doc.title,
    },
    {
      key: 'workflowState',
      header: 'Estado de flujo',
      width: '150px',
      render: (doc) => <StatusBadge kind="workflow" status={doc.workflowState} />,
      sortValue: (doc) => doc.workflowState,
    },
    {
      key: 'validation',
      header: 'Validación',
      width: '150px',
      render: (doc) => <ValidationCell doc={doc} />,
    },
    {
      key: 'updatedAt',
      header: 'Actualizado',
      width: '130px',
      align: 'end',
      render: (doc) => <span className="num">{formatUpdated(doc.updatedAt, now)}</span>,
      sortValue: (doc) => new Date(doc.updatedAt).getTime(),
    },
  ];
}
