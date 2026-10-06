/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/graph/*` and `.../drift` (SDD-007
 * "PgProjectEngine"; WO-142): read-only endpoints over the published graph for `@prdm/ui`'s
 * `GraphCanvas`/`TreeView`/`NodeDetailPanel`/`WorkOrderList`/`DriftBanner`, mirroring
 * `packages/web/src/api/{full-graph,tree,node,work-orders,drift}.ts`'s shapes exactly (same
 * `GraphStore`/`buildForest`/`engine.inspect()` calls, just resolved for a specific org/project instead
 * of the local single-project profile) so the app's graph route can reuse those components unchanged.
 * Visible to any project member (`view`) — the admin-only "Reconocer" action is WO-140's
 * `/drift/acknowledge`, not one of these.
 */
import { buildForest, docId, NODE_LABELS, WORK_ORDER_STATUSES, type GraphStore } from '@prdm/core';
import { can } from '@prdm/contracts';
import type { Neo4jGraphDatabase } from '@prdm/core';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Auth } from '../auth/build-auth.js';
import { resolvePgProjectEngine, requireNeo4j } from '../engine/resolve-pg-project-engine.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { MAX_PAGE_LIMIT } from './keyset-page-query.js';
import { requireMemberOrg } from './require-member-org.js';
import { resolveVisibleProject } from './projects.js';

export interface RegisterGraphRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  neo4j?: Neo4jGraphDatabase;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

interface NodeRouteParams extends ProjectRouteParams {
  nodeId: string;
}

const treeQuerySchema = z.object({ root: docId.optional() });
const workOrdersQuerySchema = z.object({
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  blueprint: docId.optional(),
  actorKind: z.enum(['agent', 'dev', 'unassigned']).optional(),
  assignedTo: z.string().min(1).max(200).optional(),
  q: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
const searchQuerySchema = z.object({
  q: z.string().min(1).max(300),
  label: z.enum(NODE_LABELS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/** Mirrors `packages/web/src/api/tree.ts`'s `loadTreeGraph`: full graph when unrooted, else `getNode` first so an
 * unknown `root` 404s instead of silently rendering an empty tree. */
async function loadTreeGraph(store: GraphStore, id: string | undefined) {
  if (!id) return store.fullGraph();
  const node = await store.getNode(id);
  if (!node) throw new NotFoundError(`${id} not found`);
  return store.branch(id);
}

export function registerGraphRoutes(app: FastifyInstance, opts: RegisterGraphRoutesOptions): void {
  const { auth, pool, env } = opts;

  async function resolveStore(orgSlug: string, projectSlug: string, userId: string): Promise<GraphStore> {
    const org = await requireMemberOrg(pool, orgSlug, userId);
    const { project, subject } = await resolveVisibleProject(pool, org, projectSlug, userId);
    if (!can(subject, 'view')) throw new ForbiddenError();
    const neo4j = requireNeo4j(opts.neo4j);
    return resolvePgProjectEngine(pool, neo4j, org.id, project).store;
  }

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/full',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const store = await resolveStore(req.params.orgSlug, req.params.projectSlug, session.user.id);
      return store.fullGraph();
    },
  );

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/tree',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const store = await resolveStore(req.params.orgSlug, req.params.projectSlug, session.user.id);
      const parsedQuery = treeQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');
      const graph = await loadTreeGraph(store, parsedQuery.data.root);
      return { forest: buildForest(graph) };
    },
  );

  app.get<{ Params: NodeRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/node/:nodeId',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const store = await resolveStore(req.params.orgSlug, req.params.projectSlug, session.user.id);
      const detail = await store.getNode(req.params.nodeId);
      if (!detail) throw new NotFoundError(`${req.params.nodeId} not found`);
      return detail;
    },
  );

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/search',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const store = await resolveStore(req.params.orgSlug, req.params.projectSlug, session.user.id);
      const parsedQuery = searchQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');
      const results = await store.search(parsedQuery.data.q, { labels: parsedQuery.data.label ? [parsedQuery.data.label] : undefined, limit: parsedQuery.data.limit });
      return { results };
    },
  );

  app.get<{ Params: NodeRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/branch/:nodeId',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const store = await resolveStore(req.params.orgSlug, req.params.projectSlug, session.user.id);
      const subgraph = await store.branch(req.params.nodeId);
      if (subgraph.nodes.length === 0) throw new NotFoundError(`${req.params.nodeId} not found`);
      return { nodes: subgraph.nodes, edges: subgraph.edges };
    },
  );

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/graph/work-orders',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const store = await resolveStore(req.params.orgSlug, req.params.projectSlug, session.user.id);
      const parsedQuery = workOrdersQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');
      return store.queryWorkOrders(parsedQuery.data);
    },
  );

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/drift',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'view')) throw new ForbiddenError();
      const neo4j = requireNeo4j(opts.neo4j);
      const engine = resolvePgProjectEngine(pool, neo4j, org.id, project);
      // `inspect()`, never `refresh()`/`recover()` (mirrors packages/web/src/api/drift.ts): a read
      // endpoint must never write a baseline or trigger a graph projection as a side effect.
      return engine.inspect();
    },
  );
}
