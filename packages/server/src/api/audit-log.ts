/**
 * `GET /api/app/organizations/:orgSlug/projects/:projectSlug/audit-log` and
 * `GET /api/app/organizations/:orgSlug/audit-log` (SDD-012 "Centurion Factory conectado al backend
 * SaaS", WO-342): read-only, keyset-paginated audit trails. The project-scoped view is gated by
 * `manage_project_settings` (project admin only — the same action `./projects.ts`'s settings PATCH
 * already uses); the organization-wide view is restricted further still, to an org owner/admin, since it
 * spans every project in the org rather than one the caller has an explicit admin role in.
 *
 * Every entry is redacted through `@prdm/contracts`'s `auditLogEntrySchema` (never `ip`/`userAgent`), and
 * `metadata` itself can never have held a secret in the first place — `@prdm/db`'s
 * `assertNoSecretsInAuditMetadata` rejects one at write time, in `auditLog.record` — so this route has
 * nothing further to redact there.
 */
import { auditLogEntrySchema, can, type AuditLogEntryDto } from '@prdm/contracts';
import type { AuditLogRecord } from '@prdm/db';
import { createTenantDb } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
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

const auditLogQuerySchema = keysetPageQuerySchema.extend({
  action: z.string().min(1).max(120).optional(),
});

function toAuditLogEntryDto(record: AuditLogRecord): AuditLogEntryDto {
  return auditLogEntrySchema.parse({
    id: record.id,
    actor: { type: record.actorType, id: record.actorId },
    action: record.action,
    target: record.target,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
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

      const parsedQuery = auditLogQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');

      const page = await fetchKeysetPage(() =>
        createTenantDb(pool)
          .forOrg(org.id)
          .auditLog.list({ projectId: project.id, action: parsedQuery.data.action, cursor: parsedQuery.data.cursor, limit: parsedQuery.data.limit }),
      );

      return { entries: page.items.map(toAuditLogEntryDto), nextCursor: page.nextCursor };
    },
  );

  app.get<{ Params: OrgRouteParams; Querystring: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/audit-log',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      if (!isOrgAdmin(org.role)) throw new ForbiddenError();

      const parsedQuery = auditLogQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) throw new ValidationError('invalid query');

      const page = await fetchKeysetPage(() =>
        createTenantDb(pool)
          .forOrg(org.id)
          .auditLog.list({ action: parsedQuery.data.action, cursor: parsedQuery.data.cursor, limit: parsedQuery.data.limit }),
      );

      return { entries: page.items.map(toAuditLogEntryDto), nextCursor: page.nextCursor };
    },
  );
}
