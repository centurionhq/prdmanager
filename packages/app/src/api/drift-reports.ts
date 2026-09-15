/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports` (SDD-010 §Dashboard,
 * WO-199): the code-report-backed drift dashboard, distinct from `./graph.js`'s `getDrift` (the
 * blueprint/work-order drift the graph screen already shows from `PgProjectEngine.inspect()`).
 */
import type { DriftDashboardDto } from '@prdm/contracts';
import { request } from './request.js';

export function getDriftDashboard(orgSlug: string, projectSlug: string): Promise<DriftDashboardDto> {
  return request<DriftDashboardDto>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/drift/reports`);
}
