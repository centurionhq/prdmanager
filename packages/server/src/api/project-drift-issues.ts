/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/drift/issues` and
 * `GET .../drift/reports/:reportId` (SDD-012 "Centurion Factory conectado al backend SaaS", WO-340):
 * `/drift/issues` is `./graph.ts`'s `/drift` (`engine.inspect()`, read-only, never `refresh()`/
 * `recover()`) with every issue additionally enriched with `@prdm/core`'s `attributeIssue`
 * (feature/blueprint/station), the same attribution `./line-board.ts` already folds into the line board.
 * `/drift/reports/:reportId` unfolds one `code_reports` row's `result` into its individual issues
 * (never just the summary count `./drift.ts`'s dashboard history already gives) — 404 both when the id
 * doesn't exist and when it belongs to a different project (`getCodeReportById`'s own `projectId` filter).
 *
 * Neither issue shape carries a real persisted id/timestamp (an `inspect()`/report-`result` issue is
 * recomputed on the fly, never stored per-issue) — `id` is a deterministic hash of the issue's own
 * fields (so the same issue keeps the same id across two reads of the same state) and `detectedAt` is
 * simply "when this request ran" for `/drift/issues`, or the report's own `createdAt` for
 * `/drift/reports/:reportId` (that issue really was detected exactly when that report ran).
 */
import { attributeIssue, sha256, type DriftIssue } from '@prdm/core';
import { can, codeReportResponseSchema, driftIssueDtoSchema, driftReportDetailSchema, type DriftIssueDto, type DriftReportDetailDto } from '@prdm/contracts';
import type { Neo4jGraphDatabase, ParsedDoc } from '@prdm/core';
import { getCodeReportById } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterProjectDriftIssueRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

interface DriftReportRouteParams extends ProjectRouteParams {
  reportId: string;
}

interface BareIssue {
  kind: string;
  severity: 'error' | 'warning';
  nodeId: string;
  target?: string;
  message: string;
}

function toDriftIssueDto(issue: BareIssue, docs: readonly ParsedDoc[], detectedAt: string): DriftIssueDto {
  const attribution = attributeIssue(issue as DriftIssue, docs);
  return {
    ...issue,
    id: sha256(JSON.stringify([issue.kind, issue.nodeId, issue.target ?? null, issue.message])).slice(0, 16),
    featureIds: attribution.featureIds,
    blueprintId: attribution.blueprintId,
    station: attribution.station,
    detectedAt,
  };
}

export function registerProjectDriftIssueRoutes(app: FastifyInstance, opts: RegisterProjectDriftIssueRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/issues',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<{ issues: DriftIssueDto[] }> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const [scan, report] = await Promise.all([engine.scan(), engine.inspect()]);
      const detectedAt = new Date().toISOString();
      const issues = report.issues.map((issue) => driftIssueDtoSchema.parse(toDriftIssueDto(issue, scan.docs, detectedAt)));
      return { issues };
    },
  );

  app.get<{ Params: DriftReportRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports/:reportId',
    { config: { access: { kind: 'session' } } },
    async (req): Promise<DriftReportDetailDto> => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const row = await getCodeReportById(pool, { projectId: project.id, orgId: org.id, reportId: req.params.reportId });
      if (!row) throw new NotFoundError();

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const scan = await engine.scan();

      const parsedResult = codeReportResponseSchema.safeParse(row.result);
      const rawIssues = parsedResult.success ? parsedResult.data.issues : [];
      const hasBlockingIssues = parsedResult.success ? parsedResult.data.hasBlockingIssues : false;
      const detectedAt = row.createdAt.toISOString();
      const issues = rawIssues.map((issue) => driftIssueDtoSchema.parse(toDriftIssueDto(issue, scan.docs, detectedAt)));

      return driftReportDetailSchema.parse({
        id: row.id,
        mode: row.mode,
        headSha: row.headSha,
        branch: row.branch,
        tokenName: row.tokenName,
        issueCount: issues.length,
        hasBlockingIssues,
        createdAt: row.createdAt.toISOString(),
        issues,
      });
    },
  );
}
