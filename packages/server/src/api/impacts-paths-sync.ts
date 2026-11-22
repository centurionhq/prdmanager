/**
 * `GET .../documents/:docId/impacts-paths/drift` and `POST .../documents/:docId/impacts-paths/sync`
 * (SDD-021 "Reconciliacion de impacts_paths desde CI", WO-430): the audited admin action that applies a
 * CI-derived `impacts_paths` suggestion to an already-published blueprint -- the mechanism this whole
 * PRD exists because of, tracing back to the SDD-016 incident (a typo'd pattern silently never matched
 * subdirectory files, and a published SDD/ADR can never be republished to fix it).
 *
 * The GET is `view`-gated (broadly readable, same trust tier as every other read endpoint); the POST is
 * `sync_impacts_paths`-gated (admin-only, its own action -- deliberately not reusing `manage_ci_tokens`
 * or `close_feature`, per this project's one-action-per-capability convention) and requires the caller to
 * echo back exactly the suggestion the GET just showed them (optimistic concurrency, same contract as
 * `publish_document`'s `version_id`/`content_hash`), plus a mandatory `reason`.
 */
import { can, syncImpactsPathsInputSchema } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import { computeImpactsPathsDrift, computeImpactsPathsNarrowing } from '../engine/impacts-paths-drift.js';
import { applyImpactsPathsSync } from '../documents/apply-impacts-paths-sync.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterImpactsPathsSyncRoutesOptions {
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

export function registerImpactsPathsSyncRoutes(app: FastifyInstance, opts: RegisterImpactsPathsSyncRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/impacts-paths/drift',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const { docs } = await engine.scan();
      const drift = await computeImpactsPathsDrift(pool, org.id, project.id, docs, req.params.docId);
      const narrowing = await computeImpactsPathsNarrowing(pool, org.id, project.id, docs, req.params.docId);
      if (!drift || !narrowing) throw new NotFoundError();

      return { drift, narrowing };
    },
  );

  app.post<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/impacts-paths/sync',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'sync_impacts_paths')) throw new ForbiddenError();

      const parsed = syncImpactsPathsInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const outcome = await applyImpactsPathsSync(
        { pool, orgId: org.id, projectId: project.id, engine },
        {
          blueprintId: req.params.docId,
          expectedSuggestion: parsed.data.expectedSuggestion,
          expectedRemovals: parsed.data.expectedRemovals,
          reason: parsed.data.reason,
          actorId: session.user.id,
          ip: req.ip,
          userAgent: userAgentOf(req),
        },
      );
      if (!outcome) throw new NotFoundError();
      if (!outcome.ok) throw new ConflictError(outcome.message);
      return { impactsPaths: outcome.impactsPaths };
    },
  );
}
