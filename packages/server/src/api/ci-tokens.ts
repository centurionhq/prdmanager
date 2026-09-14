/**
 * `/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens` (SDD-006 §Permisos: "tokens de CI"
 * gated by `manage_ci_tokens`, project admin only, WO-109). A CI token's `project_ids` always includes
 * the project in the URL; additional project ids may be added via the body, all validated to belong to
 * the same organization by `createCiToken` itself.
 */
import { createCiTokenInputSchema } from '@prdm/contracts';
import { can } from '@prdm/contracts';
import { createCiToken, createTenantDb, findTokenById, InvalidScopeError, listCiTokensForProject, ProjectNotInOrgError, revokeToken, TokenTtlTooLongError, type TokenRecord } from '@prdm/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { resolveVisibleProject } from './projects.js';
import { requireMemberOrg } from './require-member-org.js';

export interface RegisterCiTokenRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  clock: () => Date;
}

interface ProjectRouteParams {
  orgSlug: string;
  projectSlug: string;
}

interface CiTokenRouteParams extends ProjectRouteParams {
  tokenId: string;
}

function toTokenSummary(record: TokenRecord) {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    projectIds: record.projectIds ?? [],
    expiresAt: record.expiresAt.toISOString(),
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
  };
}

function userAgentOf(req: FastifyRequest): string | undefined {
  return typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
}

export function registerCiTokenRoutes(app: FastifyInstance, opts: RegisterCiTokenRoutesOptions): void {
  const { auth, pool, env, clock } = opts;

  app.get<{ Params: ProjectRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    if (!can(subject, 'manage_ci_tokens')) throw new ForbiddenError();

    const tokens = await listCiTokensForProject(pool, org.id, project.id);
    return { tokens: tokens.map(toTokenSummary) };
  });

  app.post<{ Params: ProjectRouteParams; Body: Record<string, unknown> }>(
    '/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens',
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
      if (!can(subject, 'manage_ci_tokens')) throw new ForbiddenError();

      const parsed = createCiTokenInputSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new ValidationError('invalid body');

      const projectIds = Array.from(new Set([project.id, ...parsed.data.projectIds]));
      const now = clock();
      let created;
      try {
        created = await createCiToken(pool, {
          orgId: org.id,
          projectIds,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          expiresAt: new Date(parsed.data.expiresAt),
          createdBy: session.user.id,
          now,
        });
      } catch (err) {
        if (err instanceof InvalidScopeError || err instanceof TokenTtlTooLongError || err instanceof ProjectNotInOrgError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          projectId: project.id,
          actorType: 'user',
          actorId: session.user.id,
          action: 'token.ci.created',
          target: created.record.id,
          metadata: { name: created.record.name, scopes: created.record.scopes, projectIds },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { token: toTokenSummary(created.record), secret: created.token };
    },
  );

  app.post<{ Params: CiTokenRouteParams }>('/api/app/organizations/:orgSlug/projects/:projectSlug/ci-tokens/:tokenId/revoke', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const { project, subject } = await resolveVisibleProject(pool, org, req.params.projectSlug, session.user.id);
    if (!can(subject, 'manage_ci_tokens')) throw new ForbiddenError();

    const existing = await findTokenById(pool, org.id, req.params.tokenId);
    if (!existing || existing.kind !== 'project_ci' || !existing.projectIds?.includes(project.id)) throw new NotFoundError();

    await revokeToken(pool, { orgId: org.id, tokenId: req.params.tokenId, now: clock() });

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        projectId: project.id,
        actorType: 'user',
        actorId: session.user.id,
        action: 'token.ci.revoked',
        target: req.params.tokenId,
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

    return { tokenId: req.params.tokenId };
  });
}
