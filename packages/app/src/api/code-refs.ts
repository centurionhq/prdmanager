/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/code-refs` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-341): every governed code reference persisted from the project's last
 * baseline ingestion, read-only.
 */
import type { CodeRefDto } from '@prdm/contracts';
import { request } from './request.js';

export function listCodeRefs(orgSlug: string, projectSlug: string): Promise<CodeRefDto[]> {
  return request<{ refs: CodeRefDto[] }>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/code-refs`,
  ).then((r) => r.refs);
}
