/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/commits` and `.../code-refs` (SDD-012
 * "Centurion Factory conectado al backend SaaS", WO-341): read-only, `view`-gated history views.
 *
 * `/commits` is a thin, paginated wrapper over `@prdm/db`'s `listCommits` (keyset `cursor`/`limit`, plus
 * an optional `ref` branch filter). `/code-refs` cross-references every persisted `project_code_refs` row
 * (`listProjectCodeRefs`, WO-332/WO-334) with that same blueprint+key's current sync verdict from
 * `engine.inspect().governed` — `null` when a ref's blueprint was excluded from this refresh's `governed`
 * entirely (reconciliation-by-hash's `awaiting_ci_report`, see `PgProjectEngine`'s own doc comment), never
 * a stale or fabricated verdict.
 */
import { can, codeRefDtoSchema, commitDtoSchema, type CodeRefDto, type CodeRefSyncVerdictDto, type CommitDto } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { listCommits, listProjectCodeRefs, type CommitRecord, type ProjectCodeRefRecord } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterProjectCodeHistoryRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

const listCommitsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  ref: z.string().min(1).optional(),
});

function toCommitDto(record: CommitRecord): CommitDto {
  return commitDtoSchema.parse({
    sha: record.sha,
    subject: record.subject,
    author: record.author,
    date: record.date.toISOString(),
    refs: record.refs,
    files: record.files,
    trust: record.trust,
  });
}

function toCodeRefDto(record: ProjectCodeRefRecord): CodeRefDto {
  return codeRefDtoSchema.parse({
    projectId: record.projectId,
    orgId: record.orgId,
    blueprintId: record.blueprintId,
    refKey: record.refKey,
    path: record.path,
    symbol: record.symbol,
    hash: record.hash,
    hashAlgoVersion: record.hashAlgoVersion,
    reportId: record.reportId,
    headSha: record.headSha,
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function registerProjectCodeHistoryRoutes(app: FastifyInstance, opts: RegisterProjectCodeHistoryRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/commits',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const parsedQuery = listCommitsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');

      let page;
      try {
        page = await listCommits(pool, { projectId: project.id, orgId: org.id, limit: parsedQuery.data.limit, cursor: parsedQuery.data.cursor, ref: parsedQuery.data.ref });
      } catch {
        throw new ValidationError('invalid cursor');
      }

      return { commits: page.items.map(toCommitDto), nextCursor: page.nextCursor };
    },
  );

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/code-refs',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<{ refs: (CodeRefDto & { verdict: CodeRefSyncVerdictDto | null })[] }> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const [records, report] = await Promise.all([listProjectCodeRefs(pool, { projectId: project.id, orgId: org.id }), engine.inspect()]);

      const verdictByKey = new Map(report.governed.map((g) => [`${g.blueprintId}|${g.key}`, { status: g.status, reason: g.reason } as CodeRefSyncVerdictDto]));

      const refs = records.map((record) => ({
        ...toCodeRefDto(record),
        verdict: verdictByKey.get(`${record.blueprintId}|${record.refKey}`) ?? null,
      }));

      return { refs };
    },
  );
}
