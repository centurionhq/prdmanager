/**
 * `GET .../documents/:docId/closure-readiness` and `POST .../documents/:docId/close` (SDD-007
 * "Documentos y flujo": "Cierre de feature: admin de proyecto con confirmación explícita →
 * closureReadiness + closeFeature"; WO-143): the SaaS replacement for the local, CLI-only `prdm close`
 * (ADR-002 D15).
 *
 * `by` (the closing actor, `ACTOR_PATTERN`'s `dev:<handle>` form) is always derived from the caller's
 * own session server-side — never accepted from the request body, so a caller can never attribute a
 * closure to someone else. Uses the session's own `user.id` (better-auth's default id generator only
 * ever produces `[A-Za-z0-9-]` characters, well within `ACTOR_PATTERN`'s allowed set) rather than
 * `user_profile.handle`: that table exists for the CLI/local-authoring actor identity (SDD-006 §Modelo
 * de datos) and nothing provisions a row for an app/session user today — depending on it here would
 * 404 for every real user until a future WO wires that up.
 *
 * `closeFeature` calls `ops.updateDocument(featureId, {status: 'closed', ...})` internally; since a
 * Feature (MRD/PRD/FR) is always `collab`-origin in this product, WO-139's placeholder applies: the
 * actual status flip is queued in `pending_editable_patch`, not written to `published_raw`, until
 * SDD-008 exists. The close request itself still succeeds and is durably recorded (SDD-007's own
 * design) — this is documented in the response so the app can show it accurately rather than implying
 * an instant visible change.
 */
import { closeFeature, closureReadiness } from '@prdm/core';
import { can } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterCloseFeatureRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface DocumentRouteParams {
  orgSlug: string;
  projectSlug: string;
  docId: string;
}

export function registerCloseFeatureRoutes(app: FastifyInstance, opts: RegisterCloseFeatureRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/closure-readiness',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const readiness = await closureReadiness(engine, req.params.docId);
      return { readiness };
    },
  );

  app.post<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/close',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'close_feature')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      let result;
      try {
        result = await closeFeature(engine, req.params.docId, { by: `dev:${session.user.id}` });
      } catch (err) {
        throw new ConflictError(err instanceof Error ? err.message : String(err));
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'feature.closed',
          target: req.params.docId,
          metadata: { closedAt: result.closedAt, closedBy: result.closedBy },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { result, pendingEditablePatch: true };
    },
  );
}
