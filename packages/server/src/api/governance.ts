/**
 * `GET /api/v1/projects/:graphProjectId/governance` (SDD-010 "MCP remoto"/"Sync de developers y
 * drift", WO-178): what `prdm sync`'s remote mode fetches and caches locally — the server's `settings`
 * and every currently published document. Scope `governance:read`.
 *
 * IDOR guard (SDD-006 §Arquitectura: "cualquier recurso de otra organización o proyecto responde 404,
 * nunca 403"): `graphProjectId` is resolved through `resolveProjectByGraphProjectId` (the pre-tenant
 * `SECURITY DEFINER` lookup, same as every other cross-tenant-safe resolution in this codebase) before
 * `app.org_id` is ever set; a project belonging to a different org than the token's own, or outside a
 * token scoped to specific `project_ids`, is treated identically to "doesn't exist" — a 404 with no
 * distinguishing signal either way.
 *
 * ETag (SDD-010: `If-None-Match: "<graph_version>"` -> `304` when unchanged): keyed purely on
 * `projects.graph_version`, which only ever advances when a write actually changes published content
 * (see `PgProjectEngine`'s `markGraphDirty`) — a client's cached copy is stale if and only if this
 * differs.
 */
import { createTenantDb } from '@prdm/db';
import { can, projectSettingsSchema, type GovernanceDocumentDto } from '@prdm/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { resolveProjectByGraphProjectId } from '@prdm/db';
import { resolveBearerProjectSubject } from './bearer-project-subject.js';
import { rejectUntrustedOrigin } from './trusted-origin.js';
import { NotFoundError } from '../errors.js';

export interface RegisterGovernanceRoutesOptions {
  pool: Pool;
}

interface GovernanceRouteParams {
  graphProjectId: string;
}

function etagOf(graphVersion: bigint): string {
  return `"${graphVersion.toString()}"`;
}

export function registerGovernanceRoutes(app: FastifyInstance, opts: RegisterGovernanceRoutesOptions): void {
  const { pool } = opts;

  app.get<{ Params: GovernanceRouteParams }>(
    '/api/v1/projects/:graphProjectId/governance',
    { config: { access: { kind: 'bearer', scope: 'governance:read' } } },
    async (req, reply) => {
      if (rejectUntrustedOrigin(req, reply)) return undefined;

      const token = req.token!;
      const resolved = await resolveProjectByGraphProjectId(pool, req.params.graphProjectId);
      if (!resolved || resolved.orgId !== token.orgId) throw new NotFoundError();
      if (token.projectIds && !token.projectIds.includes(resolved.projectId)) throw new NotFoundError();

      // WO-257: a `project_ci` token has no user behind it to re-check; only a personal token's live
      // role can have drifted since it was issued (a token's own stored scope never expires early on its
      // own — this is what makes losing project access actually take effect immediately).
      if (token.userId) {
        const subject = await resolveBearerProjectSubject(pool, resolved.orgId, resolved.projectId, token.userId);
        if (!subject || !can(subject, 'view')) throw new NotFoundError();
      }

      const scope = createTenantDb(pool).forOrg(resolved.orgId).forProject(resolved.projectId);
      const project = await scope.get();
      if (!project) throw new NotFoundError();

      const etag = etagOf(project.graphVersion);
      reply.header('etag', etag);

      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
        return reply.code(304).send();
      }

      const published = await scope.documents.listPublished();
      const documents: GovernanceDocumentDto[] = published.map((doc) => ({
        id: doc.docId,
        sourcePath: doc.sourcePath,
        content: doc.publishedRaw,
      }));

      return {
        graphVersion: project.graphVersion.toString(),
        settings: projectSettingsSchema.parse(project.settings),
        documents,
      };
    },
  );
}
