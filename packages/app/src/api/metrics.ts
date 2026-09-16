/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/metrics` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-337): agent/human efficiency, system integrity and traceability, for
 * the Métricas screen.
 */
import type { SuccessMetricsDto } from '@prdm/contracts';
import { request } from './request.js';

export function getMetrics(orgSlug: string, projectSlug: string): Promise<SuccessMetricsDto> {
  return request<SuccessMetricsDto>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/metrics`,
  );
}
