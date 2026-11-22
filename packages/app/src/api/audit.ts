/**
 * `GET .../audit-log` at project and organization scope (SDD-012 "Centurion Factory conectado al backend
 * SaaS", WO-342): the same redacted, keyset-paginated `AuditLogEntryDto` listing at both levels — the
 * project one restricted to that project's own entries, the org one spanning every project plus org-level
 * actions (invitations, membership).
 */
import { auditFacetsSchema, auditLogPageSchema, type AuditFacetsDto, type AuditLogEntryDto } from '@prdm/contracts';
import { buildQuery } from './build-query.js';
import { request } from './request.js';

export interface AuditLogParams {
  readonly action?: string;
  /** Inclusive lower/upper bounds on `created_at` (SDD-091 D2); a bare `YYYY-MM-DD` is read as the UTC day. */
  readonly from?: string;
  readonly to?: string;
  /** The actor as the `tipo:id` pair, split the way the server takes it (`actorType` + `actorId`). */
  readonly actorType?: string;
  readonly actorId?: string;
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface AuditLogPage {
  readonly items: AuditLogEntryDto[];
  readonly nextCursor: string | null;
  /** Entries in the filtered cut (SDD-091); absent when an older server answers without it, in which case the
   * screen simply does not draw the total. */
  readonly total?: number;
}

function auditLogQuery(params: AuditLogParams): string {
  return buildQuery({
    action: params.action,
    from: params.from,
    to: params.to,
    actorType: params.actorType,
    actorId: params.actorId,
    limit: params.limit?.toString(),
    cursor: params.cursor ?? undefined,
  });
}

/** Validates what the server sent against the shared contract and hands the screens the shape they use. A
 * mismatch throws here, with a message, instead of surfacing as "Cannot read properties of undefined" deep in a
 * render (which is how the wrong assumption about this shape reached production). */
function readPage(body: unknown): AuditLogPage {
  const parsed = auditLogPageSchema.safeParse(body);
  if (!parsed.success) throw new Error('La respuesta del registro de auditoría no tiene el formato esperado.');
  const page: AuditLogPage = { items: parsed.data.entries, nextCursor: parsed.data.nextCursor };
  // `total` is optional in the contract (SDD-091 D4): an older server does not send it, and then the key is not
  // invented here either, so the screen can tell "no total" apart from "0 entries".
  return parsed.data.total === undefined ? page : { ...page, total: parsed.data.total };
}

export function getProjectAuditLog(orgSlug: string, projectSlug: string, params: AuditLogParams = {}): Promise<AuditLogPage> {
  return request<unknown>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/audit-log${auditLogQuery(params)}`,
  ).then(readPage);
}

export function getOrgAuditLog(orgSlug: string, params: AuditLogParams = {}): Promise<AuditLogPage> {
  return request<unknown>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/audit-log${auditLogQuery(params)}`).then(readPage);
}

/** Actions and actors present in the scope, each with its count, plus the scope's own total (SDD-091 D3). This
 * is what feeds the action and person selects: the filter offers the actions that exist, not a memorised list. */
function readFacets(body: unknown): AuditFacetsDto {
  const parsed = auditFacetsSchema.safeParse(body);
  if (!parsed.success) throw new Error('Las facetas del registro de auditoría no tienen el formato esperado.');
  return parsed.data;
}

export function getProjectAuditFacets(orgSlug: string, projectSlug: string): Promise<AuditFacetsDto> {
  return request<unknown>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/audit-log/facets`).then(
    readFacets,
  );
}

export function getOrgAuditFacets(orgSlug: string): Promise<AuditFacetsDto> {
  return request<unknown>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/audit-log/facets`).then(readFacets);
}
