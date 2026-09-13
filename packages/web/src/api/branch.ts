import type { FastifyInstance } from 'fastify';
import type { GraphStore } from '@prdm/core';
import { NotFoundError } from '../errors.js';
import { idParamsSchema, parseOrThrow } from '../schemas.js';

export interface BranchRouteDeps {
  store: GraphStore;
}

/**
 * `GET /api/branch/:id` (SDD-005 "Contrato HTTP"): `store.branch` alone returns an empty subgraph both for an
 * unknown id and for an isolated node, so `getNode` runs first to tell those two cases apart (404 vs. 200 with an
 * empty graph) — the same precheck `packages/cli/src/commands/graph.ts`'s `loadTreeGraph` uses.
 */
export function registerBranchRoute(app: FastifyInstance, deps: BranchRouteDeps): void {
  app.get('/api/branch/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const node = await deps.store.getNode(id);
    if (!node) throw new NotFoundError(`${id} not found`);
    return deps.store.branch(id);
  });
}
