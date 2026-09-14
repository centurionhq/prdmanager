/**
 * `/api/app/organizations/:orgSlug/invitations/*` (SDD-006 §Autenticación, WO-105): create, list
 * (never returning secrets) and revoke invitations for an organization. Owner/admin only — a plain
 * member can see the org exists (via `/api/app/organizations`) but not its pending invitations.
 */
import { createOrganizationInvitationInputSchema } from '@prdm/contracts';
import { createTenantDb, listOrganizationInvitations, revokeInvitation } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ForbiddenError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { createOrganizationInvitation } from '../invitations/create-organization-invitation.js';
import type { Mailer } from '../mailer.js';
import { requireMemberOrg } from './require-member-org.js';

export interface RegisterOrganizationInvitationRoutesOptions {
  auth: Auth;
  pool: Pool;
  mailer: Mailer;
  env: ServerEnv;
}

interface OrgRouteParams {
  orgSlug: string;
}

interface OrgInvitationRouteParams extends OrgRouteParams {
  invitationId: string;
}

export function registerOrganizationInvitationRoutes(app: FastifyInstance, opts: RegisterOrganizationInvitationRoutesOptions): void {
  const { auth, pool, mailer, env } = opts;

  app.get<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/invitations', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    const invitations = await listOrganizationInvitations(pool, org.id);
    // Defense in depth on top of `listOrganizationInvitations` never selecting a secret column at all
    // (SDD-006: "Ningún listado devuelve secretos") — asserted here so a future field added to that
    // query can't silently leak one through this route without this check catching it.
    for (const invitation of invitations) {
      if ('secret' in invitation || 'secretHash' in invitation) throw new Error('invariant: invitation listing must never include a secret');
    }
    return { invitations: invitations.map((invitation) => ({ ...invitation, expiresAt: invitation.expiresAt.toISOString() })) };
  });

  app.post<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/invitations', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    const parsed = createOrganizationInvitationInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');
    if (org.role === 'admin' && parsed.data.role === 'owner') {
      throw new ForbiddenError('an admin cannot invite a new owner');
    }

    let invitationId: string;
    try {
      const result = await createOrganizationInvitation(pool, mailer, env.publicUrl, {
        organizationId: org.id,
        organizationName: org.name,
        email: parsed.data.email,
        role: parsed.data.role,
        inviterId: session.user.id,
        grants: parsed.data.projectGrants,
      });
      invitationId = result.invitationId;
    } catch {
      throw new ValidationError('unable to create invitation (check the project grants belong to this organization)');
    }

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        actorType: 'user',
        actorId: session.user.id,
        action: 'organization.invitation.created',
        target: invitationId,
        metadata: { role: parsed.data.role },
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });

    return { invitationId };
  });

  app.post<{ Params: OrgInvitationRouteParams }>('/api/app/organizations/:orgSlug/invitations/:invitationId/revoke', async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    await revokeInvitation(pool, { orgId: org.id, invitationId: req.params.invitationId });

    await createTenantDb(pool)
      .forOrg(org.id)
      .auditLog.record({
        actorType: 'user',
        actorId: session.user.id,
        action: 'organization.invitation.revoked',
        target: req.params.invitationId,
        ip: req.ip,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      });

    return { invitationId: req.params.invitationId };
  });
}
