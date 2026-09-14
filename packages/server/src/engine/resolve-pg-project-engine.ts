/**
 * Builds a `PgProjectEngine` for a given project (SDD-007 "PgProjectEngine", WO-137): the one place
 * route handlers turn a Postgres `ProjectRecord` + the server's shared `Neo4jGraphDatabase` connection
 * into a fully wired `ProjectEngine`, so every caller (publish, generate-work-orders-on-publish,
 * acknowledge, future graph reads) gets the exact same `settings`/store-fingerprint construction.
 */
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { ProjectRecord } from '@prdm/db';
import type { Pool } from 'pg';
import { createPgProjectEngine, type PgProjectEngine } from './pg-project-engine.js';
import { buildProjectSettings, saasProjectRoot } from './pg-project-settings.js';

/**
 * Throws a clear, user-facing error instead of a `Cannot read properties of undefined` when this
 * server instance was booted without a graph store configured (mirrors `@prdm/mcp`'s
 * `requireAuthoring` for the same "profile doesn't have this dependency" shape) — every route that
 * needs a `PgProjectEngine` must go through this rather than assuming `neo4j` is present.
 */
export function requireNeo4j(neo4j: Neo4jGraphDatabase | undefined): Neo4jGraphDatabase {
  if (!neo4j) throw new Error('graph store not configured for this server instance');
  return neo4j;
}

export function resolvePgProjectEngine(pool: Pool, neo4j: Neo4jGraphDatabase, orgId: string, project: ProjectRecord): PgProjectEngine {
  const store = neo4j.forProject({ id: project.graphProjectId, name: project.name, root: saasProjectRoot(project.id) });
  return createPgProjectEngine({ pool, orgId, projectId: project.id, settings: buildProjectSettings(project), store });
}
