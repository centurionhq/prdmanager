/**
 * `GET /api/app/organizations/:orgSlug/projects/overview` (SDD-012 "Centurion Factory conectado al
 * backend SaaS", WO-336): one `ProjectOverviewDto` per project the caller can see in this organization —
 * exactly the same visibility rule `./projects.ts`'s `GET .../projects` already uses (org owner/admin
 * sees every project, a plain member only the ones with a `project_members` row), so a project the
 * caller has no membership row in can never appear here either.
 *
 * The expensive per-project computation (`engine.scan()`/`engine.inspect()` and the line-board/andon
 * derivation built on top of them) is memoized by `../engine/project-overview-cache.ts`, keyed by
 * `(projectId, graph_version, latestReportId)`; only `myRole` (and the plain `ProjectSummary` fields) are
 * ever computed fresh per caller, since a cached value must never leak one user's effective role into
 * another's response.
 */
import { can, projectSettingsSchema, type ProjectOverviewDto, type ProjectRole } from '@prdm/contracts';
import { createTenantDb, type ProjectRecord } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { createProjectOverviewCache, type ProjectOverviewCache } from '../engine/project-overview-cache.js';
import { requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { requireAppSession } from './app-session.js';
import { isOrgAdmin } from './projects.js';
import { requireMemberOrg, type MemberOrg } from './require-member-org.js';

export interface RegisterProjectOverviewRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
  /** Injectable purely so a test can share one cache instance across requests, and default-constructed
   * (one per server, same as `./build-server.ts`'s own `scannedDocsCache`) otherwise. */
  cache?: ProjectOverviewCache;
}

interface OrgRouteParams {
  orgSlug: string;
}

async function resolveMyRole(pool: Pool, org: MemberOrg, project: ProjectRecord, userId: string): Promise<ProjectRole | null> {
  if (isOrgAdmin(org.role)) return 'admin';
  const membership = await createTenantDb(pool).forOrg(org.id).forProject(project.id).members.findForUser(userId);
  return (membership?.role as ProjectRole | undefined) ?? null;
}

export function registerProjectOverviewRoutes(app: FastifyInstance, opts: RegisterProjectOverviewRoutesOptions): void {
  const { auth, pool, env } = opts;
  const cache = opts.cache ?? createProjectOverviewCache();

  app.get<{ Params: OrgRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/overview',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<{ projects: ProjectOverviewDto[] }> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const neo4j = requireNeo4j(opts.neo4j);

      const tenantDb = createTenantDb(pool).forOrg(org.id);
      const projects = isOrgAdmin(org.role) ? await tenantDb.projects.list() : await tenantDb.projects.listForUser(session.user.id);

      const memberCounts = await tenantDb.members.countByProject();

      const overviews = await Promise.all(
        projects.map(async (project): Promise<ProjectOverviewDto | null> => {
          const myRole = await resolveMyRole(pool, org, project, session.user.id);
          // Never surfaced: `listForUser` already guarantees a membership row for a non-admin caller, so
          // this is only reachable in the org-admin branch for a project they truly have no role in
          // (impossible today, since org admin always resolves to `'admin'`) — defensive, not reachable.
          if (myRole === null) return null;
          if (!can({ orgRole: org.role, projectRole: myRole }, 'view')) return null;

          const computed = await cache.get(pool, neo4j, org.id, project);
          return {
            id: project.id,
            slug: project.slug,
            name: project.name,
            graphProjectId: project.graphProjectId,
            settings: projectSettingsSchema.parse(project.settings ?? {}),
            archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
            myRole,
            ...computed,
            memberCount: memberCounts[project.id] ?? 0,
          };
        }),
      );

      return { projects: overviews.filter((p): p is ProjectOverviewDto => p !== null) };
    },
  );
}
