/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/*` (SDD-012 "Centurion
 * Factory conectado al backend SaaS", WO-338): the HTTP surface for the same three domain functions the
 * remote MCP already exposes (`@prdm/mcp`'s `tools-read.ts`/`tools-remote.ts`) — `getWorkOrderContext`,
 * `claimWorkOrder`, `completeWorkOrder` — so the Centurion Factory app can drive them without a personal
 * token.
 *
 * `claim`'s assignee defaults to `dev:<user_profile.handle>`; the body may request `agent:<name>` or the
 * caller's own `dev:<handle>` (SDD-086 D1, see `resolveClaimAssignee`) — any other `dev:<...>` is a 403.
 *
 * `complete`'s `commitSha` is mandatory (`completeWorkOrderInputSchema`); `@prdm/core`'s own
 * `completeWorkOrder` already refuses a sha that doesn't resolve to a `trust: 'baseline'` commit
 * referencing this work order (`PgProjectEngine.readCommit` only ever returns baseline-trusted rows) —
 * caught here as `CommitNotVerifiedError` and reported as `409 commit_not_verified_by_ci`, matching
 * SDD-010's own remote-MCP error code exactly, rather than falling through to the generic `ConflictError`
 * every other domain-thrown `Error` gets.
 */
import { archiveWorkOrder, claimWorkOrder, CommitNotVerifiedError, completeWorkOrder, getWorkOrderContext } from '@prdm/core';
import { archiveWorkOrderInputSchema, batchWorkOrdersInputSchema, can, claimWorkOrderInputSchema, completeWorkOrderInputSchema, type WorkOrderContextDto } from '@prdm/contracts';
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

/**
 * Resolves the effective assignee of a claim (SDD-086 D1). No `requested` → the caller's own
 * `dev:<user_profile.handle>` (the contract this route always had). `agent:<name>` is accepted as-is
 * (delegating to a bot). A `dev:<...>` is only accepted when it is exactly the caller's own handle;
 * anyone else's handle is a 403 (assigning work to another person needs admin and nobody asked for it).
 */
async function resolveClaimAssignee(pool: Pool, userId: string, requested: string | undefined): Promise<string> {
  if (requested !== undefined && requested.startsWith('agent:')) return requested;
  const profile = await findUserProfile(pool, userId);
  if (!profile) {
    if (requested === undefined) throw new ConflictError('no user_profile handle for this account; cannot build an assignee');
    throw new ForbiddenError('assignee must be agent:<name> or your own dev:<handle>');
  }
  const own = `dev:${profile.handle}`;
  if (requested === undefined || requested === own) return own;
  throw new ForbiddenError(`cannot assign ${requested}: assignee must be agent:<name> or your own ${own}`);
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

      const assignee = await resolveClaimAssignee(pool, session.user.id, parsedBody.data.assignee);

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

  app.post<{ Params: WorkOrderRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/:woId/archive',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'archive_work_order')) throw new ForbiddenError();

      const parsed = archiveWorkOrderInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new ValidationError('invalid body');

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      let result;
      try {
        result = await archiveWorkOrder(engine, req.params.woId, `dev:${session.user.id}`, { reason: parsed.data.reason });
      } catch (err) {
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'work_order.archived',
          target: req.params.woId,
          metadata: { reason: parsed.data.reason },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result };
    },
  );

  /**
   * `POST .../work-orders/batch` (SDD-086 D4): applies `archive` or `claim` to 1..200 work orders. Best-effort
   * per item: a failing item (unknown id, wrong status, ...) is reported as `ok:false` with core's error and
   * never aborts the rest; `results` keeps the order of `ids`. Permission depends on the action
   * (`archive_work_order` / `claim_work_order`); a `claim` with someone else's `dev:<handle>` is a 403 of the
   * whole request. The archive actor is `dev:<userId>`, same as the single-item route. Each applied item gets
   * the same audit row as its single-item route.
   */
  app.post<{ Params: Omit<WorkOrderRouteParams, 'woId'> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/work-orders/batch',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);

      const parsed = batchWorkOrdersInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');
      const { action, ids, reason } = parsed.data;

      const permission = action === 'archive' ? 'archive_work_order' : 'claim_work_order';
      if (!can(subject, permission)) throw new ForbiddenError();

      const assignee = action === 'claim' ? await resolveClaimAssignee(pool, session.user.id, parsed.data.assignee) : undefined;

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const audit = createTenantDb(pool).forOrg(org.id).auditLog;
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of ids) {
        try {
          if (assignee === undefined) await archiveWorkOrder(engine, id, `dev:${session.user.id}`, { reason });
          else await claimWorkOrder(engine, id, assignee);
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
          continue;
        }
        await audit.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: assignee === undefined ? 'work_order.archived' : 'work_order.claimed',
          target: id,
          metadata: assignee === undefined ? { reason } : { assignee },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });
        results.push({ id, ok: true });
      }

      const applied = results.filter((r) => r.ok).length;
      return { results, archived: action === 'archive' ? applied : 0, claimed: action === 'claim' ? applied : 0 };
    },
  );
}
