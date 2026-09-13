import type { FastifyInstance } from 'fastify';
import { computeMetrics, type GraphStore } from '@prdm/core';

export interface MetricsRouteDeps {
  store: GraphStore;
}

/** `GET /api/metrics` (SDD-005 "Contrato HTTP"): the same three success-metric sections the MCP `get_metrics` tool reports. */
export function registerMetricsRoute(app: FastifyInstance, deps: MetricsRouteDeps): void {
  app.get('/api/metrics', async () => computeMetrics(await deps.store.metricsRaw()));
}
