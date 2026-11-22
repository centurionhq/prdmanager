/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/audit-log` and
 * `GET /api/app/organizations/:orgSlug/audit-log` (SDD-012 "Centurion Factory conectado al backend
 * SaaS", WO-342): read-only, keyset-paginated audit trails. The project-scoped view is gated by
 * `manage_project_settings` (project admin only — the same action `./projects.ts`'s settings PATCH
 * already uses); the organization-wide view is restricted further still, to an org owner/admin, since it
 * spans every project in the org rather than one the caller has an explicit admin role in.
 *
 * WO-704 (SDD-091): el listado filtra en el servidor por `action`, rango `from`/`to` y actor, y devuelve el
 * `total` del recorte; `.../audit-log/facets` (mismo permiso que su listado) devuelve acciones y actores
 * distintos con conteo y el total del alcance.
 *
 * Every entry is redacted through `@prdm/contracts`'s `auditLogEntrySchema` (never `ip`/`userAgent`), and
 * `metadata` itself can never have held a secret in the first place — `@prdm/db`'s
 * `assertNoSecretsInAuditMetadata` rejects one at write time, in `auditLog.record` — so this route has
 * nothing further to redact there.
 */
import {
  auditFacetsSchema,
  auditLogEntrySchema,
  auditLogPageSchema,
  auditLogQuerySchema as auditLogFiltersSchema,
  can,
  type AuditLogEntryDto,
  type AuditLogPageDto,
} from '@prdm/contracts';
import type { AuditLogRecord } from '@prdm/db';
import { auditFacets, connect, listAuditEntries, schema, withTenantTx } from '@prdm/db';
import { inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { z } from 'zod';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { fetchKeysetPage, keysetPageQuerySchema } from './keyset-page-query.js';
import { isOrgAdmin, resolveVisibleProject } from './projects.js';
import { requireMemberOrg } from './require-member-org.js';

export interface RegisterAuditLogRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

interface OrgRouteParams {
  orgSlug: string;
}

interface ProjectRouteParams extends OrgRouteParams {
  projectSlug: string;
}

const querySchema = keysetPageQuerySchema.extend(auditLogFiltersSchema.shape);

/** `<input type="date">` manda fecha sola (`YYYY-MM-DD`): «desde» es el inicio del día UTC y «hasta» incluye todo el día. */
function toDateBoundary(value: string, edge: 'from' | 'to'): Date {
  if (value.length === 10) return new Date(`${value}T${edge === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`);
  return new Date(value);
}

type AuditQuery = z.infer<typeof querySchema>;

function listInput(q: AuditQuery, projectId?: string) {
  return {
    projectId,
    action: q.action,
    from: q.from === undefined ? undefined : toDateBoundary(q.from, 'from'),
    to: q.to === undefined ? undefined : toDateBoundary(q.to, 'to'),
    actorType: q.actorType,
    actorId: q.actorId,
    cursor: q.cursor,
    limit: q.limit,
  };
}

function toAuditLogEntryDto(record: AuditLogRecord, names: ReadonlyMap<string, string>): AuditLogEntryDto {
  return auditLogEntrySchema.parse({
    id: record.id,
    actor: { type: record.actorType, id: record.actorId, name: names.get(`${record.actorType}:${record.actorId}`) ?? null },
    action: record.action,
    target: record.target,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
  });
}

interface ActorRef {
  actorType: string;
  actorId: string;
}

function distinctActorIds(records: readonly ActorRef[], actorType: string): string[] {
  return [...new Set(records.filter((r) => r.actorType === actorType).map((r) => r.actorId))];
}

const AGENT_ACTOR_PREFIX = 'agent:';

/** Resolves the display name of every actor on a page with at most two bounded queries (users, tokens);
 * agents need no query: their name is the `actorId` without the `agent:` prefix.
 * Keys are `"<actorType>:<actorId>"`; an actor with no row (deleted, unknown type) or an empty agent name is simply absent. */
async function resolveActorNames(pool: Pool, orgId: string, records: readonly ActorRef[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const agentId of distinctActorIds(records, 'agent')) {
    const name = agentId.startsWith(AGENT_ACTOR_PREFIX) ? agentId.slice(AGENT_ACTOR_PREFIX.length) : agentId;
    if (name !== '') names.set(`agent:${agentId}`, name);
  }
  const userIds = distinctActorIds(records, 'user');
  const tokenIds = distinctActorIds(records, 'token');
  if (userIds.length > 0) {
    const rows = await connect(pool).select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds));
    for (const row of rows) names.set(`user:${row.id}`, row.name);
  }
  if (tokenIds.length > 0) {
    const rows = await withTenantTx(pool, orgId, (tx) =>
      tx
        .select({ id: schema.apiTokens.id, name: schema.apiTokens.name })
        .from(schema.apiTokens)
        .where(inArray(sql`${schema.apiTokens.id}::text`, tokenIds)),
    );
    for (const row of rows) names.set(`token:${row.id}`, row.name);
  }
  return names;
}

async function toAuditLogPage(pool: Pool, orgId: string, page: { items: AuditLogRecord[]; nextCursor: string | null; total: number }): Promise<AuditLogPageDto> {
  const names = await resolveActorNames(pool, orgId, page.items);
  return auditLogPageSchema.parse({ entries: page.items.map((record) => toAuditLogEntryDto(record, names)), nextCursor: page.nextCursor, total: page.total });
}

async function buildFacets(pool: Pool, orgId: string, projectId?: string) {
  const facets = await auditFacets(pool, orgId, { projectId });
  const names = await resolveActorNames(pool, orgId, facets.actors.map((a) => ({ actorType: a.type, actorId: a.id })));
  return auditFacetsSchema.parse({
    actions: facets.actions,
    actors: facets.actors.map((a) => ({ ...a, name: names.get(`${a.type}:${a.id}`) ?? null })),
    total: facets.total,
  });
}

export function registerAuditLogRoutes(app: FastifyInstance, opts: RegisterAuditLogRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get<{ Params: ProjectRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/audit-log',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'manage_project_settings')) throw new ForbiddenError();

      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');

      const page = await fetchKeysetPage(() => listAuditEntries(pool, org.id, listInput(parsedQuery.data, project.id)));

      return toAuditLogPage(pool, org.id, page);
    },
  );

  app.get<{ Params: ProjectRouteParams }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/audit-log/facets',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'manage_project_settings')) throw new ForbiddenError();
      return buildFacets(pool, org.id, project.id);
    },
  );

  app.get<{ Params: OrgRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/audit-log',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      if (!isOrgAdmin(org.role)) throw new ForbiddenError();

      const parsedQuery = querySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');

      const page = await fetchKeysetPage(() => listAuditEntries(pool, org.id, listInput(parsedQuery.data)));

      return toAuditLogPage(pool, org.id, page);
    },
  );

  app.get<{ Params: OrgRouteParams }>(
    '/api/app/organizations/:orgSlug/audit-log/facets',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      if (!isOrgAdmin(org.role)) throw new ForbiddenError();
      return buildFacets(pool, org.id);
    },
  );
}
