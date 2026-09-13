import type { FastifyInstance } from 'fastify';
import type { GraphStore } from '@prdm/core';

export interface FullGraphRouteDeps {
  store: GraphStore;
}

/** `GET /api/full-graph` (SDD-005 "Contrato HTTP"): an empty graph is a valid 200, never a 404. */
export function registerFullGraphRoute(app: FastifyInstance, deps: FullGraphRouteDeps): void {
  app.get('/api/full-graph', async () => deps.store.fullGraph());
}
