/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/commits` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-341): newest-first, keyset-paginated commit listing.
 */
import type { CommitDto } from '@prdm/contracts';
import { buildQuery } from './build-query.js';
import { request } from './request.js';

export interface ListCommitsParams {
  readonly limit?: number;
  readonly cursor?: string | null;
}

export interface CommitsPage {
  readonly items: CommitDto[];
  readonly nextCursor: string | null;
}

export function listCommits(orgSlug: string, projectSlug: string, params: ListCommitsParams = {}): Promise<CommitsPage> {
  const query = buildQuery({ limit: params.limit?.toString(), cursor: params.cursor ?? undefined });
  return request<CommitsPage>(
    `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/commits${query}`,
  );
}
