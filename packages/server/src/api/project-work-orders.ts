/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/*` (SDD-012 "Centurion
 * Factory conectado al backend SaaS", WO-338): the HTTP surface for the same three domain functions the
 * remote MCP already exposes (`@prdm/mcp`'s `tools-read.ts`/`tools-remote.ts`) — `getWorkOrderContext`,
 * `claimWorkOrder`, `completeWorkOrder` — so the Centurion Factory app can drive them without a personal
 * token.
 *
 * `claim`'s assignee is always built server-side as `dev:<user_profile.handle>` (never accepted from the
 * request body — `claimWorkOrderInputSchema` is intentionally an empty `strictObject`, same convention as
 * `./close-feature.ts`'s `by`), the same rule SDD-010's remote MCP `claim_work_order` already enforces for
 * a bearer caller (`@prdm/mcp`'s `denyAssignee`), just resolved from a session instead of a personal
 * token's own handle.
 *
 * `complete`'s `commitSha` is mandatory (`completeWorkOrderInputSchema`); `@prdm/core`'s own
 * `completeWorkOrder` already refuses a sha that doesn't resolve to a `trust: 'baseline'` commit
 * referencing this work order (`PgProjectEngine.readCommit` only ever returns baseline-trusted rows) —
 * caught here as `CommitNotVerifiedError` and reported as `409 commit_not_verified_by_ci`, matching
 * SDD-010's own remote-MCP error code exactly, rather than falling through to the generic `ConflictError`
 * every other domain-thrown `Error` gets.
 */
import { claimWorkOrder, CommitNotVerifiedError, completeWorkOrder, getWorkOrderContext } from '@prdm/core';
import { can, claimWorkOrderInputSchema, completeWorkOrderInputSchema, type WorkOrderContextDto } from '@prdm/contracts';
import { createTenantDb, findUserProfile } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterProjectWorkOrderRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface WorkOrderRouteParams {
  orgSlug: string;
  projectSlug: string;
  woId: string;
}

export function registerProjectWorkOrderRoutes(app: FastifyInstance, opts: RegisterProjectWorkOrderRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: WorkOrderRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/context',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<{ context: WorkOrderContextDto }> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const context = await getWorkOrderContext(engine.store, req.params.woId);
      if (!context) throw new NotFoundError();
      return { context };
    },
  );

  app.post<{ Params: WorkOrderRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/claim',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'claim_work_order')) throw new ForbiddenError();

      const parsedBody = claimWorkOrderInputSchema.safeParse(req.body ?? {});
      if (!parsedBody.success) throw new ValidationError('invalid body');

      const profile = await findUserProfile(pool, session.user.id);
      if (!profile) throw new ConflictError('no user_profile handle for this account; cannot build an assignee');
      const assignee = `dev:${profile.handle}`;

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      let result;
      try {
        result = await claimWorkOrder(engine, req.params.woId, assignee);
      } catch (err) {
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'work_order.claimed',
          target: req.params.woId,
          metadata: { assignee },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );

  app.post<{ Params: WorkOrderRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/complete',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'complete_work_order')) throw new ForbiddenError();

      const parsed = completeWorkOrderInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      let result;
      try {
        result = await completeWorkOrder(engine, req.params.woId, { commitSha: parsed.data.commitSha });
      } catch (err) {
        if (err instanceof CommitNotVerifiedError) {
          void reply.code(409).send({ error: 'commit_not_verified_by_ci', message: err.message });
          return;
        }
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'work_order.completed',
          target: req.params.woId,
          metadata: { commitSha: parsed.data.commitSha },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );
}
