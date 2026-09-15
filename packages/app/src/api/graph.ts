/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/graph/*` and `.../drift` (SDD-007
 * "PgProjectEngine", WO-142): mirrors `packages/web/src/client/api/client.ts`'s
 * `getFullGraph`/`getTree`/`getNode`/`listWorkOrders`/`getDrift` shapes exactly, scoped to an
 * org/project, so `@prdm/ui`'s components (which only take injected fetcher props, never call a
 * concrete backend themselves) work unchanged here.
 */
import type { NodeDetail, RefreshReport, Subgraph, TreeNode, WorkOrderStatus, WorkOrderSummary } from '@prdm/core';
import { request } from './request.js';

export interface TreeResponse {
  forest: TreeNode[];
}

export interface WorkOrdersFilter {
  status?: WorkOrderStatus;
  blueprint?: string;
}

function graphBase(orgSlug: string, projectSlug: string): string {
  return `/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/graph`;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function getFullGraph(orgSlug: string, projectSlug: string): Promise<Subgraph> {
  return request<Subgraph>(`${graphBase(orgSlug, projectSlug)}/full`);
}

export function getTree(orgSlug: string, projectSlug: string, root?: string): Promise<TreeResponse> {
  return request<TreeResponse>(`${graphBase(orgSlug, projectSlug)}/tree${buildQuery({ root })}`);
}

export function getNode(orgSlug: string, projectSlug: string, id: string): Promise<NodeDetail> {
  return request<NodeDetail>(`${graphBase(orgSlug, projectSlug)}/node/${encodeURIComponent(id)}`);
}

export function listWorkOrders(orgSlug: string, projectSlug: string, filter: WorkOrdersFilter = {}): Promise<WorkOrderSummary[]> {
  return request<WorkOrderSummary[]>(`${graphBase(orgSlug, projectSlug)}/work-orders${buildQuery({ status: filter.status, blueprint: filter.blueprint })}`);
}

export function getDrift(orgSlug: string, projectSlug: string): Promise<RefreshReport> {
  return request<RefreshReport>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/drift`);
}

/** `POST .../drift/acknowledge` (WO-140): admin-only server-side, gated the same way client-side. */
export function acknowledgeDrift(orgSlug: string, projectSlug: string, target: string): Promise<{ report: RefreshReport }> {
  return request<{ report: RefreshReport }>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/drift/acknowledge`, {
    method: 'POST',
    body: { target },
  });
}
