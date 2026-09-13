import type { FastifyInstance } from 'fastify';
import { buildForest, type GraphStore, type Subgraph } from '@prdm/core';
import { NotFoundError } from '../errors.js';
import { parseOrThrow, treeQuerySchema } from '../schemas.js';

export interface TreeRouteDeps {
  store: GraphStore;
}

/** Mirrors `packages/cli/src/commands/graph.ts`'s `loadTreeGraph`: full graph when unrooted, else `getNode` first so an unknown `root` 404s instead of silently rendering an empty tree. */
async function loadTreeGraph(store: GraphStore, id: string | undefined): Promise<Subgraph> {
  if (!id) return store.fullGraph();
  const node = await store.getNode(id);
  if (!node) throw new NotFoundError(`${id} not found`);
  return store.branch(id);
}

/** `GET /api/tree` (SDD-005 "Contrato HTTP"): optional `root`, always returns `{forest}`. */
export function registerTreeRoute(app: FastifyInstance, deps: TreeRouteDeps): void {
  app.get('/api/tree', async (request) => {
    const { root } = parseOrThrow(treeQuerySchema, request.query);
    const graph = await loadTreeGraph(deps.store, root);
    return { forest: buildForest(graph) };
  });
}
