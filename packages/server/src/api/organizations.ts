/**
 * `/api/app/organizations/*` (SDD-006 §Arquitectura / §Permisos, WO-104): the only place organization
 * membership and roles are ever mutated (better-auth's own `/organization/*` HTTP endpoints are never
 * mounted — see `../auth/allowlist.ts`). Every route requires a session (`./app-session.js`); a
 * resource that belongs to an organization the caller isn't a member of always 404s, never 403 (SDD-006
 * §Arquitectura: "Cualquier recurso de otra organización ... responde 404").
 */
import {
  MembershipNotFoundError,
  OrgRoleRuleError,
  createTenantDb,
  findMembership,
  listOrganizationMembers,
  listOrganizationsForUser,
  removeOrganizationMember,
  revokeUserTokensForOrg,
  setMemberRole,
} from '@prdm/db';
import { setActiveOrganizationInputSchema, updateOrgMemberRoleInputSchema } from '@prdm/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { requireMemberOrg } from './require-member-org.js';

export interface RegisterOrganizationRoutesOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
}

interface OrgRouteParams {
  orgSlug: string;
}

interface OrgMemberRouteParams extends OrgRouteParams {
  userId: string;
}

function forwardSetCookie(reply: FastifyReply, headers: Headers): void {
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}

/** Registered inside `build-server.ts`'s `if (pool && mailer)` block, alongside `/api/auth/*`. */
export function registerOrganizationRoutes(app: FastifyInstance, opts: RegisterOrganizationRoutesOptions): void {
  const { auth, pool, env } = opts;

  app.get('/api/app/organizations', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const organizations = await listOrganizationsForUser(pool, session.user.id);
    return { organizations };
  });

  app.post('/api/app/organizations/active', { config: { access: { kind: 'session' } } }, async (req, reply) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const parsed = setActiveOrganizationInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const membership = await findMembership(pool, parsed.data.organizationId, session.user.id);
    if (!membership) throw new NotFoundError();

    const result = await auth.api.setActiveOrganization({
      headers: session.headers,
      body: { organizationId: parsed.data.organizationId },
      returnHeaders: true,
    });
    forwardSetCookie(reply, result.headers);
    return { organizationId: parsed.data.organizationId };
  });

  app.get<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/members', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    const members = await listOrganizationMembers(pool, org.id);
    return { members };
  });

  app.patch<{ Params: OrgMemberRouteParams }>('/api/app/organizations/:orgSlug/members/:userId', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    const parsed = updateOrgMemberRoleInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    try {
      await setMemberRole(pool, org.id, org.role, req.params.userId, parsed.data.role);
    } catch (err) {
      if (err instanceof MembershipNotFoundError) throw new NotFoundError();
      if (err instanceof OrgRoleRuleError) throw new ForbiddenError(err.message);
      throw err;
    }

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        actorType: 'user',
        actorId: session.user.id,
        action: 'organization.member.role_changed',
        target: req.params.userId,
        metadata: { role: parsed.data.role },
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });

    return { userId: req.params.userId, role: parsed.data.role };
  });

  app.delete<{ Params: OrgMemberRouteParams }>('/api/app/organizations/:orgSlug/members/:userId', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    try {
      await removeOrganizationMember(pool, org.id, org.role, req.params.userId);
    } catch (err) {
      if (err instanceof MembershipNotFoundError) throw new NotFoundError();
      if (err instanceof OrgRoleRuleError) throw new ForbiddenError(err.message);
      throw err;
    }

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        actorType: 'user',
        actorId: session.user.id,
        action: 'organization.member.removed',
        target: req.params.userId,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });

    // WO-257 (security review): losing org membership must also invalidate every personal token this
    // user already issued for this org — scoped or not — not just whatever live `/collab` sessions
    // happen to be open right now.
    await revokeUserTokensForOrg(pool, { orgId: org.id, userId: req.params.userId });

    return { userId: req.params.userId };
  });
}
