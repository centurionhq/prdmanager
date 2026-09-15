/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/metrics` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-337): wraps `@prdm/core`'s `getMetrics(store)` — the same
 * `SuccessMetrics` computation the MCP `get_metrics` tool already exposes locally — over this project's
 * graph store. Read-only, visible to any project member (`view`), same resolution shape as `./graph.ts`.
 */
import { getMetrics } from '@prdm/core';
import { can, type SuccessMetricsDto } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterProjectMetricsRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

export function registerProjectMetricsRoutes(app: FastifyInstance, opts: RegisterProjectMetricsRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/metrics',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<SuccessMetricsDto> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      return getMetrics(engine.store);
    },
  );
}
