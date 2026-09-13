import type { FastifyInstance } from 'fastify';
import type { GraphStore } from '@prdm/core';
import { NotFoundError } from '../errors.js';
import { idParamsSchema, parseOrThrow, workOrdersQuerySchema } from '../schemas.js';

export interface WorkOrderRouteDeps {
  store: GraphStore;
}

/** `GET /api/work-orders` and `GET /api/work-orders/:id` (SDD-005 "Contrato HTTP"). */
export function registerWorkOrderRoutes(app: FastifyInstance, deps: WorkOrderRouteDeps): void {
  app.get('/api/work-orders', async (request) => {
    const { status, blueprint } = parseOrThrow(workOrdersQuerySchema, request.query);
    return deps.store.listWorkOrders({ status, blueprint });
  });

  app.get('/api/work-orders/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const context = await deps.store.workOrderContext(id);
    if (!context) throw new NotFoundError(`${id} not found`);
    return context;
  });
}
