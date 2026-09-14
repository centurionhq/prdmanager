/**
 * Pre-tenant project resolution (SDD-006 §Aislamiento por capas, point 3; WO-097): the only two ways
 * `prdm_app` can learn which organization a project belongs to before `app.org_id` is set, backed by the
 * `resolve_project`/`resolve_graph_project` `SECURITY DEFINER` functions hand-appended to
 * `packages/db/migrations/0004_resolve_project_functions.sql` — the same template as
 * `resolveInvitationBySecret`/`resolve_invitation` (WO-105). Both return `null` for "no match", never
 * throwing, so callers map "nothing resolved" to a 404 like any other lookup miss.
 */
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { connect } from './pool.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedProjectOrg {
  orgId: string;
}

interface ResolveProjectRow extends Record<string, unknown> {
  org_id: string;
}

/** Looks up only the organization a project's internal uuid belongs to; the uuid itself is already
 * known to the caller, so nothing else needs to cross this boundary. Rejects a syntactically invalid
 * uuid before it ever reaches Postgres (rather than letting `::uuid` raise) so a malformed id is just
 * another "no match", same as a well-formed but unknown one. */
export async function resolveProjectById(pool: Pool, projectId: string): Promise<ResolvedProjectOrg | null> {
  if (!UUID_PATTERN.test(projectId)) return null;
  const db = connect(pool);
  const result = await db.execute<ResolveProjectRow>(sql`SELECT * FROM resolve_project(${projectId}::uuid)`);
  const row = result.rows[0];
  return row ? { orgId: row.org_id } : null;
}

export interface ResolvedGraphProject {
  orgId: string;
  projectId: string;
}

interface ResolveGraphProjectRow extends Record<string, unknown> {
  org_id: string;
  project_id: string;
}

/** Looks up the organization and internal uuid for the public `graph_project_id` (`prj_...`) used by the
 * CLI/MCP surface (SDD-006 §Arquitectura "Glosario de identificadores"). */
export async function resolveProjectByGraphProjectId(pool: Pool, graphProjectId: string): Promise<ResolvedGraphProject | null> {
  const db = connect(pool);
  const result = await db.execute<ResolveGraphProjectRow>(sql`SELECT * FROM resolve_graph_project(${graphProjectId})`);
  const row = result.rows[0];
  return row ? { orgId: row.org_id, projectId: row.project_id } : null;
}
