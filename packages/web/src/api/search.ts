import type { FastifyInstance } from 'fastify';
import type { GraphStore } from '@prdm/core';
import { parseOrThrow, searchQuerySchema } from '../schemas.js';

export interface SearchRouteDeps {
  store: GraphStore;
}

/** `GET /api/search` (SDD-005 "Contrato HTTP"): `q` 1..200 chars, `labels?` csv of NODE_LABELS, `limit` 1..100 def. 10. */
export function registerSearchRoute(app: FastifyInstance, deps: SearchRouteDeps): void {
  app.get('/api/search', async (request) => {
    const { q, labels, limit } = parseOrThrow(searchQuerySchema, request.query);
    return deps.store.search(q, { labels, limit });
  });
}
