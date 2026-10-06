/**
 * `/o/:orgSlug/ajustes/auditoria` (SDD-013 §"Shell y router"): the organization-wide redacted audit
 * trail (WO-342's `getOrgAuditLog`), spanning every project plus org-level actions (invitations,
 * membership) — same table, exact-action filter and "Cargar más" keyset pagination as the project-scoped
 * screen (WO-365).
 *
 * Deliberately manages its own `cargando`/`error`/`listo` state instead of `useApiQuery`, for the same
 * reason `AjustesAuditoria.tsx` does: that hook can't append a further page or reset an in-flight fetch
 * when the action filter changes mid-load.
 *
 * SDD-056/PRD-036: the body (filter, table, pagination) is `audit/AuditLogView`, shared with the project's
 * screen. It lives in `OrgShell`, not under the project's Ajustes layout, so it keeps its own `h1`.
 */
import type { ReactElement } from 'react';
import { PageHeader } from '../components/index.js';
import { getOrgAuditLog } from '../api/client.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import { AuditLogView } from './audit/AuditLogView.js';
import styles from './audit/AuditScreen.module.css';

export function OrgAjustesAuditoria(): ReactElement {
  const { orgSlug, currentOrg } = useOrgShellContext();
  useDocumentTitle('Auditoría de la organización');

  return (
    <div className={styles.screen}>
      <PageHeader title={`Auditoría de ${currentOrg.name}`} subtitle="Lo que pasó en todos los proyectos y en la organización, quién lo hizo y cuándo." />
      <AuditLogView scopeKey={orgSlug} load={(params) => getOrgAuditLog(orgSlug, params)} />
    </div>
  );
}
