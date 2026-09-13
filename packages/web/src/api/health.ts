import type { FastifyInstance } from 'fastify';

/**
 * `GET /api/health` (SDD-005 "Contrato HTTP"): deliberately never touches Neo4j — this is a liveness check that
 * must answer before the database connection is even relevant. Whether Neo4j itself is reachable is exposed
 * indirectly by every other `/api/*` route (a `500` there) rather than by a `?deep=1` variant here.
 */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({ status: 'ok' }));
}
