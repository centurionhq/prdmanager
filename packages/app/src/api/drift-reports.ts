/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports` (SDD-010 §Dashboard,
 * WO-199): the code-report-backed drift dashboard, distinct from `./graph.js`'s `getDrift` (the
 * blueprint/work-order drift the graph screen already shows from `PgProjectEngine.inspect()`).
 */
import type { DriftDashboardDto, DriftIssueDto, DriftReportDetailDto } from '@prdm/contracts';
import { request } from './request.js';

function projectBase(orgSlug: string, projectSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}`;
}

export function getDriftDashboard(orgSlug: string, projectSlug: string): Promise<DriftDashboardDto> {
  return request<DriftDashboardDto>(`${projectBase(orgSlug, projectSlug)}/drift/reports`);
}

/** `GET .../drift/issues` (SDD-012, WO-340): the blueprint/work-order drift the Centurion Factory Drift
 * screen shows, each already attributed to its feature/blueprint/station. */
export function getDriftIssues(orgSlug: string, projectSlug: string): Promise<DriftIssueDto[]> {
  return request<{ issues: DriftIssueDto[] }>(`${projectBase(orgSlug, projectSlug)}/drift/issues`).then((r) => r.issues);
}

/** `GET .../drift/reports/:reportId` (SDD-012, WO-340): one code-report's full issue list. */
export function getDriftReportDetail(orgSlug: string, projectSlug: string, reportId: string): Promise<DriftReportDetailDto> {
  return request<DriftReportDetailDto>(`${projectBase(orgSlug, projectSlug)}/drift/reports/${encodeURIComponent(reportId)}`);
}
