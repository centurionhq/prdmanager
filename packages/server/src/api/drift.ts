/**
 * `POST /api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge` (SDD-007 "Documentos y
 * flujo": "Reconocer drift: admin de proyecto con confirmación y auditoría ejecuta acknowledge sobre un
 * WO, blueprint o feature"; WO-140): admin-only, replaces the local `prdm sync ack` for the SaaS
 * profile. `target` is any real doc id (`WO`, blueprint, or Feature) or the literal `"all"`, matching
 * `ProjectEngine.acknowledge(target)`'s own contract (`@prdm/core`'s `acknowledge` function).
 *
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports` (SDD-010 §Dashboard,
 * WO-199): the code-report-backed drift dashboard — official drift for the default branch (with the
 * reporting CI token's name and `head_sha`), preview drift by branch, and the full chronological
 * history — built purely from `@prdm/db`'s `listCodeReports` (never a preview shown as if official).
 * Read-only, `view` (every project role, same as the document list) rather than `acknowledge_drift`.
 */
import { can, codeReportResponseSchema, driftAcknowledgeInputSchema, type DriftDashboardDto, type DriftReportSummaryDto } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import { createTenantDb, listCodeReports, type CodeReportListItem } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject, userAgentOf } from './projects.js';

export interface RegisterDriftRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

/** A report's `result` column is only ever written by this codebase's own `POST .../code-reports` route
 * (`codeReportResponseSchema.parse` inside it), so re-parsing it here is a defensive shape check, not
 * untrusted-input validation — a row that somehow fails it is simply reported with a zero issue count
 * rather than throwing and blanking the whole dashboard for every other, well-formed row. */
function toSummary(row: CodeReportListItem): DriftReportSummaryDto {
  const parsedResult = codeReportResponseSchema.safeParse(row.result);
  const issues = parsedResult.success ? parsedResult.data.issues : [];
  const hasBlockingIssues = parsedResult.success ? parsedResult.data.hasBlockingIssues : false;
  return {
    id: row.id,
    mode: row.mode,
    headSha: row.headSha,
    branch: row.branch,
    tokenName: row.tokenName,
    issueCount: issues.length,
    hasBlockingIssues,
    createdAt: row.createdAt.toISOString(),
  };
}

/** SDD-010 §Dashboard: official is the newest baseline report, previews are the newest non-baseline
 * report per branch — excluding the official one, so a branch never shows both as if they were two
 * independent things when the newest preview and the official report happen to be the very same row. */
function buildDashboard(history: DriftReportSummaryDto[]): DriftDashboardDto {
  const official = history.find((r) => r.mode === 'baseline') ?? null;
  const previews: DriftReportSummaryDto[] = [];
  const seenBranches = new Set<string>();
  for (const report of history) {
    if (report.mode === 'baseline' || report.id === official?.id) continue;
    const branchKey = report.branch ?? '';
    if (seenBranches.has(branchKey)) continue;
    seenBranches.add(branchKey);
    previews.push(report);
  }
  return { official, previews, history };
}

export function registerDriftRoutes(app: FastifyInstance, opts: RegisterDriftRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/reports',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();

      const rows = await listCodeReports(pool, { projectId: project.id, orgId: org.id });
      return buildDashboard(rows.map(toSummary));
    },
  );

  app.post<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/drift/acknowledge',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'acknowledge_drift')) throw new ForbiddenError();

      const parsedBody = driftAcknowledgeInputSchema.safeParse(req.body);
      if (!parsedBody.success) throw new ValidationError('invalid body');

      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      const report = await engine.acknowledge(parsedBody.data.target);

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'drift.acknowledged',
          target: parsedBody.data.target,
          metadata: { remainingIssues: report.issues.length, hasBlockingIssues: report.hasBlockingIssues },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { report };
    },
  );
}
