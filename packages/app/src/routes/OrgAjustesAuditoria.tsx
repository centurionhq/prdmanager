/**
 * `/o/:orgSlug/ajustes/auditoria` (SDD-013 §"Shell y router"): the organization-wide redacted audit
 * trail (WO-342's `getOrgAuditLog`), spanning every project plus org-level actions (invitations,
 * membership) — same table and loading states as the project-scoped one.
 */
import type { ReactElement } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../components/index.js';
import { getOrgAuditLog } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useApiQuery } from '../api/use-api-query.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import { AuditLogTable } from './audit-log-table.js';

export function OrgAjustesAuditoria(): ReactElement {
  const { orgSlug } = useOrgShellContext();
  useDocumentTitle('Auditoría de la organización');

  const query = useApiQuery(`org-audit-log:${orgSlug}`, () => getOrgAuditLog(orgSlug), [orgSlug], (page) => page.items.length === 0);

  if (query.status === 'cargando') return <Skeleton rows={5} />;
  if (query.status === 'error') {
    return <ErrorState title="No pudimos cargar la auditoría" body={errorMessage(query.error)} onRetry={query.retry} />;
  }
  if (query.status === 'vacio' || !query.data) {
    return <EmptyState title="Todavía no hay actividad registrada" />;
  }

  return <AuditLogTable items={query.data.items} />;
}
