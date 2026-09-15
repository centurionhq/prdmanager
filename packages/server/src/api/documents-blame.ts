/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/blame` (SDD-008 §"Endpoint
 * de blame y mensaje stateless blame:stale", WO-154): same visibility gate as every other read of a
 * document (`can(subject, 'view')` — "Todos los miembros del proyecto pueden ver la copia de trabajo en
 * solo lectura", so a viewer sees blame too, not just an editor).
 */
import { can } from '@prdm/contracts';
import { createTenantDb } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { BlameCache } from '../collab/blame.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterDocumentBlameRouteOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  blameCache: BlameCache;
}

interface DocumentRouteParams {
  orgSlug: string;
  projectSlug: string;
  docId: string;
}

export function registerDocumentBlameRoute(app: FastifyInstance, opts: RegisterDocumentBlameRouteOptions): void {
  const { auth, pool, env, blameCache } = opts;

  app.get<{ Params: DocumentRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/documents/:docId/blame',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const scope = createTenantDb(pool).forOrg(org.id).forProject(project.id);
      const existing = await scope.documents.findByDocId(req.params.docId);
      if (!existing) throw new NotFoundError();

      const blame = await blameCache.get(pool, org.id, existing.document.id);
      return blame;
    },
  );
}
