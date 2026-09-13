import type { FastifyInstance } from 'fastify';
import type { GraphStore } from '@prdm/core';
import { NotFoundError } from '../errors.js';
import { idParamsSchema, parseOrThrow } from '../schemas.js';

export interface NodeRouteDeps {
  store: GraphStore;
}

/** `GET /api/node/:id` (SDD-005 "Contrato HTTP"): 400 on a malformed id, 404 when `getNode` returns `null`. */
export function registerNodeRoute(app: FastifyInstance, deps: NodeRouteDeps): void {
  app.get('/api/node/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const detail = await deps.store.getNode(id);
    if (!detail) throw new NotFoundError(`${id} not found`);
    return detail;
  });
}
