/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/graph/*` and `.../drift` (SDD-007
 * "PgProjectEngine", WO-142): mirrors `packages/web/src/client/api/client.ts`'s
 * `getFullGraph`/`getTree`/`getNode`/`listWorkOrders`/`getDrift` shapes exactly, scoped to an
 * org/project, so `@prdm/ui`'s components (which only take injected fetcher props, never call a
 * concrete backend themselves) work unchanged here.
 */
import type { NodeDetail, RefreshReport, Subgraph, TreeNode, WorkOrderStatus, WorkOrderSummary } from '@prdm/core';
import type { SearchHitDto, SearchResultDto } from '@prdm/contracts';
import { request } from './request.js';
import { buildQuery } from './build-query.js';

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

/** `GET .../graph/search` (SDD-012, WO-337): free-text search over the project graph (features,
 * blueprints, work orders, artifacts, feedback), ranked by relevance — the Arbol screen's search box. */
export function searchGraph(orgSlug: string, projectSlug: string, q: string): Promise<SearchHitDto[]> {
  return request<SearchResultDto>(`${graphBase(orgSlug, projectSlug)}/search${buildQuery({ q })}`).then((r) => r.results);
}

/** `GET .../graph/branch/:nodeId` (SDD-012, WO-337): one feature's own subtree (its blueprints, work
 * orders and artifacts) — same `Subgraph` shape as {@link getFullGraph}, just scoped to one root instead
 * of the whole project, for the tree view's focused-branch mode. */
export function getFeatureBranch(orgSlug: string, projectSlug: string, nodeId: string): Promise<Subgraph> {
  return request<Subgraph>(`${graphBase(orgSlug, projectSlug)}/branch/${encodeURIComponent(nodeId)}`);
}

/** `POST .../drift/acknowledge` (WO-140): admin-only server-side, gated the same way client-side. */
export function acknowledgeDrift(orgSlug: string, projectSlug: string, target: string): Promise<{ report: RefreshReport }> {
  return request<{ report: RefreshReport }>(`/api/app/organizations/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectSlug)}/drift/acknowledge`, {
    method: 'POST',
    body: { target },
  });
}
