/**
 * `GET .../audit-log` at project and organization scope (SDD-012 "Centurion Factory conectado al backend
 * SaaS", WO-342): the same redacted, keyset-paginated `AuditLogEntryDto` listing at both levels — the
 * project one restricted to that project's own entries, the org one spanning every project plus org-level
 * actions (invitations, membership).
 */
import { auditLogPageSchema, type AuditLogEntryDto } from '@prdm/contracts';
import { buildQuery } from './build-query.js';
import { request } from './request.js';

export interface AuditLogParams {
  readonly action?: string;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface AuditLogPage {
  readonly items: AuditLogEntryDto[];
  readonly nextCursor: string | null;
}

function auditLogQuery(params: AuditLogParams): string {
  return buildQuery({ action: params.action, limit: params.limit?.toString(), cursor: params.cursor ?? undefined });
}

/** Validates what the server sent against the shared contract and hands the screens the shape they use. A
 * mismatch throws here, with a message, instead of surfacing as "Cannot read properties of undefined" deep in a
 * render (which is how the wrong assumption about this shape reached production). */
function readPage(body: unknown): AuditLogPage {
  const parsed = auditLogPageSchema.safeParse(body);
  if (!parsed.success) throw new Error('La respuesta del registro de auditoría no tiene el formato esperado.');
  return { items: parsed.data.entries, nextCursor: parsed.data.nextCursor };
}

export function getProjectAuditLog(orgSlug: string, projectSlug: string, params: AuditLogParams = {}): Promise<AuditLogPage> {
  return request<unknown>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/audit-log${auditLogQuery(params)}`,
  ).then(readPage);
}

export function getOrgAuditLog(orgSlug: string, params: AuditLogParams = {}): Promise<AuditLogPage> {
  return request<unknown>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/audit-log${auditLogQuery(params)}`).then(readPage);
}
