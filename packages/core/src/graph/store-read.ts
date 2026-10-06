import neo4j, { type Driver } from 'neo4j-driver';
import type { NodeLabel } from '../domain/schema.js';
import { buildScopedLuceneQuery } from './lucene.js';
import { BRANCH, FULL_GRAPH, GET_NODE, LIST_WORK_ORDERS, METRICS_RAW, QUERY_WORK_ORDERS, MAX_DEPTH, SEARCH, UP_FILTER, DOWN_FILTER, WORK_ORDER_CONTEXT } from './queries.js';
import type { MetricsRaw, NodeDetail, SearchHit, Subgraph, WorkOrderContextRaw, WorkOrderPage, WorkOrderQueryFilter, WorkOrderSummary } from './types.js';

async function read<T>(driver: Driver, database: string, query: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const { records } = await driver.executeQuery(query, params, { database, routing: neo4j.routing.READ });
  return records.map((r) => r.toObject() as T);
}

export async function getNode(driver: Driver, database: string, projectId: string, id: string): Promise<NodeDetail | null> {
  const rows = await read<NodeDetail>(driver, database, GET_NODE, { projectId, id });
  return rows[0] ?? null;
}

export async function search(
  driver: Driver,
  database: string,
  projectId: string,
  text: string,
  options: { labels?: NodeLabel[]; limit?: number } = {},
): Promise<SearchHit[]> {
  const query = buildScopedLuceneQuery(text, projectId);
  if (!query) return [];
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 100);
  return read<SearchHit>(driver, database, SEARCH, {
    query,
    projectId,
    labels: options.labels ?? [],
    fetch: neo4j.int(Math.min(limit * 20, 500)),
    limit: neo4j.int(limit),
  });
}

export async function branch(driver: Driver, database: string, projectId: string, id: string): Promise<Subgraph> {
  const rows = await read<Subgraph>(driver, database, BRANCH, { projectId, id, up: UP_FILTER, down: DOWN_FILTER, depth: neo4j.int(MAX_DEPTH) });
  return rows[0] ?? { nodes: [], edges: [] };
}

export async function fullGraph(driver: Driver, database: string, projectId: string): Promise<Subgraph> {
  const rows = await read<Subgraph>(driver, database, FULL_GRAPH, { projectId });
  return rows[0] ?? { nodes: [], edges: [] };
}

export async function listWorkOrders(
  driver: Driver,
  database: string,
  projectId: string,
  filter: { status?: string; blueprint?: string } = {},
): Promise<WorkOrderSummary[]> {
  return read<WorkOrderSummary>(driver, database, LIST_WORK_ORDERS, { projectId, status: filter.status ?? null, blueprint: filter.blueprint ?? null });
}

const DEFAULT_WORK_ORDER_LIMIT = 25;
const MAX_WORK_ORDER_LIMIT = 200;

export async function queryWorkOrders(driver: Driver, database: string, projectId: string, filter: WorkOrderQueryFilter = {}): Promise<WorkOrderPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_WORK_ORDER_LIMIT, 1), MAX_WORK_ORDER_LIMIT);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = await read<WorkOrderPage>(driver, database, QUERY_WORK_ORDERS, {
    projectId,
    status: filter.status ?? null,
    blueprint: filter.blueprint ?? null,
    actorKind: filter.actorKind ?? null,
    assignedTo: filter.assignedTo ?? null,
    // El Cypher compara contra `toLower(...)`: normalizamos el término una sola vez acá.
    q: filter.q ? filter.q.toLowerCase() : null,
    limit: neo4j.int(limit),
    offset: neo4j.int(offset),
  });
  // Los tres CALL agregan, así que siempre hay exactamente una fila.
  if (!rows[0]) throw new Error('work orders query returned no rows');
  return rows[0];
}

export async function workOrderContext(driver: Driver, database: string, projectId: string, id: string): Promise<WorkOrderContextRaw | null> {
  const rows = await read<WorkOrderContextRaw>(driver, database, WORK_ORDER_CONTEXT, { projectId, id });
  return rows[0] ?? null;
}

export async function metricsRaw(driver: Driver, database: string, projectId: string): Promise<MetricsRaw> {
  const rows = await read<MetricsRaw>(driver, database, METRICS_RAW, { projectId });
  const row = rows[0];
  if (!row) throw new Error('metrics query returned no rows');
  return row;
}
