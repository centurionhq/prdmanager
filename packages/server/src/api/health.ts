import type { FastifyInstance } from 'fastify';

/** `GET /api/health` (SDD-006 §Arquitectura): a liveness check with no dependency on the database, mailer or LLM. */
export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({ status: 'ok' }));
}
