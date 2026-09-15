/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/auditoria` (SDD-013 §"Shell y router"): the project's own
 * redacted audit trail (WO-342's `getProjectAuditLog`), paginated by `useApiQuery`'s cargando/vacio/
 * error/listo states.
 */
import type { ReactElement } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../components/index.js';
import { getProjectAuditLog } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { AuditLogTable } from './audit-log-table.js';

export function AjustesAuditoria(): ReactElement {
  const { orgSlug, projectSlug } = useProjectShellContext();
  useDocumentTitle('Ajustes · auditoría');

  const query = useApiQuery(
    `project-audit-log:${orgSlug}:${projectSlug}`,
    () => getProjectAuditLog(orgSlug, projectSlug),
    [orgSlug, projectSlug],
    (page) => page.items.length === 0,
  );

  if (query.status === 'cargando') return <Skeleton rows={5} />;
  if (query.status === 'error') {
    return <ErrorState title="No pudimos cargar la auditoría" body={errorMessage(query.error)} onRetry={query.retry} />;
  }
  if (query.status === 'vacio' || !query.data) {
    return <EmptyState title="Todavía no hay actividad registrada" />;
  }

  return <AuditLogTable items={query.data.items} />;
}
