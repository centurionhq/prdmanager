/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/line-board` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-335): the Planta board — one lane per feature across the six-station
 * pipeline, plus the current andon (line stop), if any.
 */
import type { LineBoardDto } from '@prdm/contracts';
import { request } from './request.js';

export function getLineBoard(orgSlug: string, projectSlug: string): Promise<LineBoardDto> {
  return request<LineBoardDto>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/line-board`,
  );
}
