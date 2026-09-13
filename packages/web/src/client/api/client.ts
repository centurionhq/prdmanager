import type {
  DocKind,
  FolderMap,
  NodeDetail,
  NodeLabel,
  RefreshReport,
  SearchHit,
  Subgraph,
  SuccessMetrics,
  TreeNode,
  WorkOrderContextRaw,
  WorkOrderSummary,
} from '@prdm/core';
import { request } from './request';

export { ApiClientError, type ApiErrorCode } from './api-client-error';

/**
 * `GET /api/project` response (mirrors `packages/web/src/summary.ts`'s `WebProjectSummary`, defined locally
 * instead of imported: that file lives outside `tsconfig.client.json`'s `rootDir: 'src/client'`, and the client
 * only ever needs the shape, not the server's `scanDocuments` implementation).
 */
export interface WebProjectSummary {
  id: string;
  name: string;
  folders: FolderMap;
  lifecycle: Readonly<Record<DocKind, string>>;
  counts: Record<DocKind, number>;
}

export interface SearchParams {
  q: string;
  labels?: NodeLabel[];
  limit?: number;
}

export interface WorkOrdersFilter {
  status?: string;
  blueprint?: string;
}

export interface TreeResponse {
  forest: TreeNode[];
}

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

/** `GET /api/project` (SDD-005 "Contrato HTTP"). */
export function getProject(): Promise<WebProjectSummary> {
  return request<WebProjectSummary>('/api/project');
}

/** `GET /api/node/:id` (SDD-005 "Contrato HTTP"). */
export function getNode(id: string): Promise<NodeDetail> {
  return request<NodeDetail>(`/api/node/${encodeURIComponent(id)}`);
}

/** `GET /api/search` (SDD-005 "Contrato HTTP"): `q` required, `labels`/`limit` optional. */
export function search(params: SearchParams): Promise<SearchHit[]> {
  const query = buildQuery({
    q: params.q,
    labels: params.labels && params.labels.length > 0 ? params.labels.join(',') : undefined,
    limit: params.limit !== undefined ? String(params.limit) : undefined,
  });
  return request<SearchHit[]>(`/api/search${query}`);
}

/** `GET /api/branch/:id` (SDD-005 "Contrato HTTP"). */
export function getBranch(id: string): Promise<Subgraph> {
  return request<Subgraph>(`/api/branch/${encodeURIComponent(id)}`);
}

/** `GET /api/full-graph` (SDD-005 "Contrato HTTP"): an empty graph is a valid 200. */
export function getFullGraph(): Promise<Subgraph> {
  return request<Subgraph>('/api/full-graph');
}

/** `GET /api/tree` (SDD-005 "Contrato HTTP"): `root` optional. */
export function getTree(root?: string): Promise<TreeResponse> {
  const query = buildQuery({ root });
  return request<TreeResponse>(`/api/tree${query}`);
}

/** `GET /api/work-orders` (SDD-005 "Contrato HTTP"): both filters optional. */
export function listWorkOrders(filter: WorkOrdersFilter = {}): Promise<WorkOrderSummary[]> {
  const query = buildQuery({ status: filter.status, blueprint: filter.blueprint });
  return request<WorkOrderSummary[]>(`/api/work-orders${query}`);
}

/** `GET /api/work-orders/:id` (SDD-005 "Contrato HTTP"). */
export function getWorkOrder(id: string): Promise<WorkOrderContextRaw> {
  return request<WorkOrderContextRaw>(`/api/work-orders/${encodeURIComponent(id)}`);
}

/** `GET /api/drift` (SDD-005 "Contrato HTTP"): `engine.inspect()`, never a mutating refresh. */
export function getDrift(): Promise<RefreshReport> {
  return request<RefreshReport>('/api/drift');
}

/** `GET /api/metrics` (SDD-005 "Contrato HTTP"). */
export function getMetrics(): Promise<SuccessMetrics> {
  return request<SuccessMetrics>('/api/metrics');
}
