import type { FastifyInstance } from 'fastify';
import type { Engine, PrdmConfig } from '@prdm/core';
import { buildWebProjectSummary } from '../summary.js';

export interface ProjectRouteDeps {
  config: PrdmConfig;
  engine: Engine;
}

/** `GET /api/project` (SDD-005 "Contrato HTTP"): no Neo4j connection fields, no authoring fields. */
export function registerProjectRoute(app: FastifyInstance, deps: ProjectRouteDeps): void {
  app.get('/api/project', async () => buildWebProjectSummary(deps));
}
