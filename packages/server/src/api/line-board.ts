/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/line-board` (SDD-012 "Centurion Factory
 * conectado al backend SaaS", WO-335): wraps `@prdm/core`'s `deriveLineBoard` over the project engine's
 * `scan()` docs, then attributes every issue from `inspect()` (`attributeIssue`) and folds the andon
 * signal in (`computeAndon`) — the same read-only, no-side-effect shape as `./graph.ts`'s `/drift`
 * (`inspect()`, never `refresh()`/`recover()`). Visible to any project member (`view`), same as every
 * other project-scoped read in this file family.
 */
import { attributeIssue, computeAndon, deriveLineBoard } from '@prdm/core';
import { can, type LineBoardDto } from '@prdm/contracts';
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

export interface RegisterLineBoardRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

export function registerLineBoardRoutes(app: FastifyInstance, opts: RegisterLineBoardRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/line-board',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<LineBoardDto> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const [scan, report] = await Promise.all([engine.scan(), engine.inspect()]);

      const board = deriveLineBoard(scan.docs);
      const attributed = report.issues.map((issue) => ({ severity: issue.severity, ...attributeIssue(issue, scan.docs) }));
      return computeAndon(attributed, board);
    },
  );
}
