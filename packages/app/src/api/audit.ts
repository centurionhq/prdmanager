/**
 * `GET .../audit-log` at project and organization scope (SDD-012 "Centurion Factory conectado al backend
 * SaaS", WO-342): the same redacted, keyset-paginated `AuditLogEntryDto` listing at both levels — the
 * project one restricted to that project's own entries, the org one spanning every project plus org-level
 * actions (invitations, membership).
 */
import type { AuditLogEntryDto } from '@prdm/contracts';
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

export function getProjectAuditLog(orgSlug: string, projectSlug: string, params: AuditLogParams = {}): Promise<AuditLogPage> {
  return request<AuditLogPage>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/audit-log${auditLogQuery(params)}`,
  );
}

export function getOrgAuditLog(orgSlug: string, params: AuditLogParams = {}): Promise<AuditLogPage> {
  return request<AuditLogPage>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/audit-log${auditLogQuery(params)}`);
}
