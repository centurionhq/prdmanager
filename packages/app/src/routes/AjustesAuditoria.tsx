/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/auditoria` (SDD-013 §"Shell y router"): the project's own
 * redacted audit trail (WO-342's `getProjectAuditLog`), with an exact-action filter and "Cargar más"
 * keyset pagination (WO-365).
 *
 * Deliberately manages its own `cargando`/`error`/`listo` state instead of `useApiQuery` — that hook
 * (SDD-013 §"Capa de datos") always replaces its cached page wholesale on every call, with no way to
 * *append* a further page or reset itself an in-flight fetch when the action filter changes mid-load.
 *
 * SDD-056/PRD-036: the body (filter, table, pagination) is `audit/AuditLogView`, shared with the organisation's
 * screen; this one only chooses the log and puts its heading above it.
 */
import type { ReactElement } from 'react';
import { SectionHeader } from '../components/index.js';
import { getProjectAuditLog } from '../api/client.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { AuditLogView } from './audit/AuditLogView.js';
import styles from './audit/AuditScreen.module.css';

export function AjustesAuditoria(): ReactElement {
  const { orgSlug, projectSlug } = useProjectShellContext();
  useDocumentTitle('Ajustes · auditoría');

  return (
    <div className={styles.screen}>
      <SectionHeader title="Auditoría" subtitle="Lo que pasó en este proyecto, quién lo hizo y cuándo." />
      <AuditLogView scopeKey={`${orgSlug}/${projectSlug}`} load={(params) => getProjectAuditLog(orgSlug, projectSlug, params)} />
    </div>
  );
}
