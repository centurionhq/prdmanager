/**
 * Memoizes the expensive part of one project's Centurion Factory overview card (SDD-012, WO-336):
 * `engine.scan()` + `engine.inspect()` plus the line-board/andon/drift-issue derivation built on top of
 * them, keyed by `(projectId, graph_version, latestReportId)` — the same "an unchanged `graph_version`
 * proves nothing published changed" signal `./scanned-docs-cache.ts` already trusts, extended with the
 * latest `code_reports` row id so a fresh CI report (which moves neither `graph_version` nor any document
 * content) also invalidates it. A caller-specific field (`myRole`) is deliberately never part of what
 * this caches — see `../api/project-overview.ts`, which merges it in fresh on every request.
 */
import { attributeIssue, computeAndon, deriveLineBoard, STATIONS, type Station } from '@prdm/core';
import { createTenantDb, listCodeReports, type ProjectRecord } from '@prdm/db';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { Pool } from 'pg';
import { resolvePgProjectEngine } from './resolve-pg-project-engine.js';

export interface ProjectOverviewComputed {
  docCount: number;
  furthestStation: Station;
  andonStation: Station | null;
  driftErrors: number;
  driftWarnings: number;
  awaitingFirstReport: boolean;
  workOrdersInProgress: number;
  lastActivityAt: string | null;
}

export interface ProjectOverviewCache {
  get(pool: Pool, neo4j: Neo4jGraphDatabase, orgId: string, project: ProjectRecord): Promise<ProjectOverviewComputed>;
}

const STATION_INDEX = new Map(STATIONS.map((station, index) => [station, index]));

function furthestStationOf(stations: readonly Station[]): Station {
  return stations.reduce((furthest, station) => ((STATION_INDEX.get(station) ?? 0) > (STATION_INDEX.get(furthest) ?? 0) ? station : furthest), STATIONS[0]);
}

async function computeProjectOverview(pool: Pool, neo4j: Neo4jGraphDatabase, orgId: string, project: ProjectRecord): Promise<ProjectOverviewComputed> {
  const engine = resolvePgProjectEngine(pool, neo4j, orgId, project);
  const [scan, report, lastActivity] = await Promise.all([
    engine.scan(),
    engine.inspect(),
    createTenantDb(pool).forOrg(orgId).auditLog.list({ projectId: project.id, limit: 1 }),
  ]);

  const board = deriveLineBoard(scan.docs);
  const attributed = report.issues.map((issue) => ({ severity: issue.severity, ...attributeIssue(issue, scan.docs) }));
  const withAndon = computeAndon(attributed, board);

  const workOrdersInProgress = scan.docs.filter((d) => d.frontmatter.type === 'WO' && d.frontmatter.status === 'in_progress').length;

  return {
    docCount: scan.docs.length,
    furthestStation: board.features.length === 0 ? 'ingesta' : furthestStationOf(board.features.map((f) => f.station)),
    andonStation: withAndon.andon?.station ?? null,
    driftErrors: report.issues.filter((i) => i.severity === 'error').length,
    driftWarnings: report.issues.filter((i) => i.severity === 'warning').length,
    awaitingFirstReport: false,
    workOrdersInProgress,
    lastActivityAt: lastActivity.items[0]?.createdAt.toISOString() ?? null,
  };
}

export function createProjectOverviewCache(): ProjectOverviewCache {
  const cache = new Map<string, ProjectOverviewComputed>();

  return {
    async get(pool, neo4j, orgId, project) {
      const reports = await listCodeReports(pool, { projectId: project.id, orgId, limit: 1 });
      const latestReportId = reports[0]?.id ?? 'none';
      const key = `${project.id}|${project.graphVersion.toString()}|${latestReportId}`;

      const cached = cache.get(key);
      if (cached) return cached;

      const computed = await computeProjectOverview(pool, neo4j, orgId, project);
      const withReportState = { ...computed, awaitingFirstReport: reports.length === 0 };
      cache.set(key, withReportState);
      return withReportState;
    },
  };
}
