/**
 * `POST /api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge` (SDD-007 "Documentos y
 * flujo": "Reconocer drift: admin de proyecto con confirmación y auditoría ejecuta acknowledge sobre un
 * WO, blueprint o feature"; WO-140): admin-only, replaces the local `prdm sync ack` for the SaaS
 * profile. `target` is any real doc id (`WO`, blueprint, or Feature) or the literal `"all"`, matching
 * `ProjectEngine.acknowledge(target)`'s own contract (`@prdm/core`'s `acknowledge` function).
 */
import { can, driftAcknowledgeInputSchema } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterDriftRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

export function registerDriftRoutes(app: FastifyInstance, opts: RegisterDriftRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.post<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'acknowledge_drift')) throw new ForbiddenError();

      const parsedBody = driftAcknowledgeInputSchema.safeParse(req.body);
      if (!parsedBody.success) throw new ValidationError('invalid body');

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const report = await engine.acknowledge(parsedBody.data.target);

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'drift.acknowledged',
          target: parsedBody.data.target,
          metadata: { remainingIssues: report.issues.length, hasBlockingIssues: report.hasBlockingIssues },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { report };
    },
  );
}
