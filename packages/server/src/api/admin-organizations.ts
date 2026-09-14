/**
 * `POST /api/app/admin/organizations` (SDD-006 §Autenticación, WO-101): superadmin-only, creates an
 * organization and invites its owner by email. Never gives the superadmin performing this any
 * membership in the new organization ("No tienen acceso implícito al contenido").
 */
import { recordPlatformAuditLog } from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ValidationError } from '../errors.js';
import { inviteOrganizationOwner } from '../invitations/invite-organization-owner.js';
import type { Mailer } from '../mailer.js';
import { requireSuperadminSession } from './admin-session.js';

const createOrganizationBodySchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric segments separated by hyphens'),
  ownerEmail: z.string().email(),
});

export interface RegisterAdminOrganizationRoutesOptions {
  auth: Auth;
  pool: Pool;
  mailer: Mailer;
  env: ServerEnv;
}

/** Deletes the `member` row better-auth's `createOrganization` unconditionally creates for whichever
 * `userId` it resolved (see the module doc comment on the call site below) — a raw, unconditional
 * delete, deliberately bypassing `@prdm/db`'s `removeOrganizationMember` (which would reject removing
 * the organization's only owner; here that owner-of-one is the superadmin performing a system action,
 * not a real member the last-owner rule is meant to protect). */
async function stripCreatorMembership(pool: Pool, organizationId: string, userId: string): Promise<void> {
  await pool.query(`DELETE FROM "member" WHERE "organizationId" = $1 AND "userId" = $2`, [organizationId, userId]);
}

export function registerAdminOrganizationRoutes(app: FastifyInstance, opts: RegisterAdminOrganizationRoutesOptions): void {
  const { auth, pool, mailer, env } = opts;

  app.post('/api/app/admin/organizations', async (req) => {
    const session = await requireSuperadminSession(auth, pool, req, env.publicUrl);
    const parsed = createOrganizationBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    // The sanctioned session-less `createOrganization` call (SDD-006 §Autenticación / the WO-083
    // learning test finding): no `headers`, so `allowUserToCreateOrganization: false` never applies.
    // better-auth's own endpoint requires *some* resolvable user when there's no session, and always
    // adds that user as `owner` — there is no option to skip it — so the superadmin's own id is passed
    // here (the only user guaranteed to already exist) and that auto-created membership is stripped
    // immediately below. The real owner (who may not have an account yet) is added only once they
    // accept the invitation (WO-105's atomic accept).
    let organization: { id: string; name: string; slug: string } | null;
    try {
      organization = await auth.api.createOrganization({
        body: { name: parsed.data.name, slug: parsed.data.slug, userId: session.user.id },
      });
    } catch {
      throw new ConflictError('an organization with that slug already exists');
    }
    if (!organization) throw new ConflictError('failed to create organization');

    await stripCreatorMembership(pool, organization.id, session.user.id);

    const { invitationId } = await inviteOrganizationOwner(pool, mailer, env.publicUrl, {
      organizationId: organization.id,
      organizationName: organization.name,
      email: parsed.data.ownerEmail,
      inviterId: session.user.id,
    });

    await recordPlatformAuditLog(pool, {
      actorType: 'user',
      actorId: session.user.id,
      action: 'platform.organization.created',
      target: organization.id,
      metadata: { slug: organization.slug, ownerEmail: parsed.data.ownerEmail },
      ip: req.ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });

    return { organizationId: organization.id, slug: organization.slug, invitationId };
  });
}
