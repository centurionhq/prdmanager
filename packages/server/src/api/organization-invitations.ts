/**
 * `/api/app/organizations/:orgSlug/invitations/*` (SDD-006 §Autenticación, WO-105): create, list
 * (never returning secrets) and revoke invitations for an organization. Owner/admin only — a plain
 * member can see the org exists (via `/api/app/organizations`) but not its pending invitations.
 *
 * Also hosts `/api/app/organizations/:orgSlug/access-requests*` (SDD-099 WO-D): a public POST (anonymous,
 * behind the `/api/app/*` CSRF double-submit — `GET /api/app/csrf-token` needs no session — with its own
 * per-IP rate limit and an invariant response) plus owner/admin list/approve/reject.
 */
import { createAccessRequestInputSchema, createOrganizationInvitationInputSchema } from '@prdm/contracts';
import {
  AccessRequestAlreadyResolvedError,
  AccessRequestNotFoundError,
  createAccessRequest,
  createTenantDb,
  findInvitationById,
  findOrganizationBySlug,
  listOrganizationInvitations,
  listOrganizationMembers,
  listPendingAccessRequests,
  resolveAccessRequest,
  revokeInvitation,
  rotateInvitationSecret,
} from '@prdm/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../errors.js';
import { requireAppSession } from './app-session.js';
import { createOrganizationInvitation } from '../invitations/create-organization-invitation.js';
import type { Mailer } from '../mailer.js';
import type { KeyedRateLimiter } from '../rate-limit/keyed-rate-limit.js';
import { escapeHtml, sanitizeNameForHtml, sanitizeNameForText } from '../email/sanitize.js';
import { requireMemberOrg } from './require-member-org.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RegisterOrganizationInvitationRoutesOptions {
  auth: Auth;
  pool: Pool;
  mailer: Mailer;
  env: ServerEnv;
  rateLimiter: KeyedRateLimiter;
  /** SDD-099 §D2: own bucket for the public access-request POST (per IP, 5 / 15 min). */
  accessRequestRateLimiter: KeyedRateLimiter;
}

const REJECT_REASON_MAX_LENGTH = 500;

interface OrgRouteParams {
  orgSlug: string;
}

interface AccessRequestRouteParams extends OrgRouteParams {
  requestId: string;
}

interface OrgInvitationRouteParams extends OrgRouteParams {
  invitationId: string;
}

export function registerOrganizationInvitationRoutes(app: FastifyInstance, opts: RegisterOrganizationInvitationRoutesOptions): void {
  const { auth, pool, mailer, env, rateLimiter } = opts;
  const userAgentOf = (req: FastifyRequest) => (typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined);

  app.get<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/invitations', { config: { access: { kind: 'session' } } }, async (req) => {
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

  app.post<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/invitations', { config: { access: { kind: 'session' } } }, async (req, reply) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    const limit = await rateLimiter.check(req, org.id);
    if (!limit.allowed) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new RateLimitedError();
    }

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

  app.post<{ Params: OrgInvitationRouteParams }>(
    '/api/app/organizations/:orgSlug/invitations/:invitationId/revoke',
    { config: { access: { kind: 'session' } } },
    async (req) => {
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
    },
  );

  app.post<{ Params: OrgInvitationRouteParams }>(
    '/api/app/organizations/:orgSlug/invitations/:invitationId/resend',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      if (org.role === 'member') throw new ForbiddenError();

      const limit = await rateLimiter.check(req, org.id);
      if (!limit.allowed) {
        reply.header('retry-after', String(limit.retryAfterSeconds));
        throw new RateLimitedError();
      }

      const invitation = await findInvitationById(pool, req.params.invitationId);
      if (!invitation || invitation.organizationId !== org.id) throw new NotFoundError();
      if (invitation.status !== 'pending') throw new ConflictError(`invitation ${req.params.invitationId} is "${invitation.status}", not pending`);

      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const { secret } = await rotateInvitationSecret(pool, { orgId: org.id, invitationId: req.params.invitationId, expiresAt });

      const link = `${env.publicUrl}/invite/${req.params.invitationId}#s=${secret}`;
      const orgNameHtml = sanitizeNameForHtml(org.name);
      const orgNameText = sanitizeNameForText(org.name);
      await mailer.sendMail({
        to: invitation.email,
        subject: `Reminder: you've been invited to join "${orgNameText}" on prdm`,
        text: [`You've been invited to join the organization "${orgNameText}" on prdm.`, '', `Accept your invitation: ${link}`].join('\n'),
        html: [
          `<p>You've been invited to join the organization <strong>${orgNameHtml}</strong> on prdm.</p>`,
          `<p><a href="${escapeHtml(link)}">Accept your invitation</a></p>`,
        ].join('\n'),
      });

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          actorType: 'user',
          actorId: session.user.id,
          action: 'organization.invitation.resent',
          target: req.params.invitationId,
          ip: req.ip,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        });

      return { invitationId: req.params.invitationId };
    },
  );

  // SDD-099 §D2: public. The response is `{ ok: true }` whether or not the organization exists (nothing is
  // inserted when it doesn't), and body validation runs before the org lookup, so neither leaks existence.
  app.post<{ Params: OrgRouteParams }>(
    '/api/app/organizations/:orgSlug/access-requests',
    { config: { access: { public: true } } },
    async (req, reply) => {
      const limit = await opts.accessRequestRateLimiter.check(req, undefined);
      if (!limit.allowed) {
        reply.header('retry-after', String(limit.retryAfterSeconds));
        throw new RateLimitedError();
      }

      const parsed = createAccessRequestInputSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('invalid body');

      const org = await findOrganizationBySlug(pool, req.params.orgSlug);
      if (org) {
        await createAccessRequest(pool, { orgId: org.id, email: parsed.data.email, name: parsed.data.name ?? null, message: parsed.data.message ?? null });
      }
      return { ok: true };
    },
  );

  app.get<{ Params: OrgRouteParams }>('/api/app/organizations/:orgSlug/access-requests', { config: { access: { kind: 'session' } } }, async (req) => {
    const session = await requireAppSession(auth, req, env.publicUrl);
    const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
    if (org.role === 'member') throw new ForbiddenError();

    const requests = await listPendingAccessRequests(pool, org.id);
    return {
      requests: requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null })),
    };
  });

  /** Maps `resolveAccessRequest`'s domain errors onto HTTP ones; anything else propagates. */
  const mapResolveError = (err: unknown): never => {
    if (err instanceof AccessRequestNotFoundError) throw new NotFoundError();
    if (err instanceof AccessRequestAlreadyResolvedError) throw new ConflictError('access request already resolved');
    throw err;
  };

  app.post<{ Params: AccessRequestRouteParams }>(
    '/api/app/organizations/:orgSlug/access-requests/:requestId/approve',
    { config: { access: { kind: 'session' } } },
    async (req, reply) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      if (org.role === 'member') throw new ForbiddenError();

      // Same bucket as creating an invitation: this route sends the same email.
      const limit = await rateLimiter.check(req, org.id);
      if (!limit.allowed) {
        reply.header('retry-after', String(limit.retryAfterSeconds));
        throw new RateLimitedError();
      }

      const pending = await listPendingAccessRequests(pool, org.id);
      const target = pending.find((r) => r.id === req.params.requestId);
      if (!target) throw new NotFoundError();

      const targetEmail = target.email.toLowerCase();
      const alreadyMember = (await listOrganizationMembers(pool, org.id)).some((m) => m.email.toLowerCase() === targetEmail);

      let invitationId: string | null = null;
      if (!alreadyMember) {
        try {
          const result = await createOrganizationInvitation(pool, mailer, env.publicUrl, {
            organizationId: org.id,
            organizationName: org.name,
            email: target.email,
            role: 'member',
            inviterId: session.user.id,
          });
          invitationId = result.invitationId;
        } catch {
          throw new ValidationError('unable to create invitation for this access request');
        }
      }

      // Invitation first, resolution after: if the invitation/email fails the row stays `pending` and the
      // admin can retry; the other way round it would be `approved` with no invitation and no way to retry.
      try {
        await resolveAccessRequest(pool, { orgId: org.id, id: req.params.requestId, status: 'approved', resolvedBy: session.user.id });
      } catch (err) {
        // Lost a race (resolved/removed meanwhile): don't leave an orphan invitation behind.
        if (invitationId) await revokeInvitation(pool, { orgId: org.id, invitationId });
        mapResolveError(err);
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          actorType: 'user',
          actorId: session.user.id,
          action: 'organization.access_request.approved',
          target: req.params.requestId,
          metadata: { invitationId, alreadyMember },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { requestId: req.params.requestId, status: 'approved', invitationId, alreadyMember };
    },
  );

  app.post<{ Params: AccessRequestRouteParams }>(
    '/api/app/organizations/:orgSlug/access-requests/:requestId/reject',
    { config: { access: { kind: 'session' } } },
    async (req) => {
      const session = await requireAppSession(auth, req, env.publicUrl);
      const org = await requireMemberOrg(pool, req.params.orgSlug, session.user.id);
      if (org.role === 'member') throw new ForbiddenError();

      // `access_request` has no reason column (SDD-099 §D1): the optional reason only goes to the audit log.
      const body = (req.body ?? {}) as { reason?: unknown };
      let reason: string | null = null;
      if (body.reason !== undefined) {
        if (typeof body.reason !== 'string') throw new ValidationError('invalid body');
        const trimmed = body.reason.trim();
        if (trimmed.length < 1 || trimmed.length > REJECT_REASON_MAX_LENGTH) throw new ValidationError('invalid body');
        reason = trimmed;
      }

      const pending = await listPendingAccessRequests(pool, org.id);
      if (!pending.some((r) => r.id === req.params.requestId)) throw new NotFoundError();

      try {
        await resolveAccessRequest(pool, { orgId: org.id, id: req.params.requestId, status: 'rejected', resolvedBy: session.user.id });
      } catch (err) {
        mapResolveError(err);
      }

      await createTenantDb(pool)
        .forOrg(org.id)
        .auditLog.record({
          actorType: 'user',
          actorId: session.user.id,
          action: 'organization.access_request.rejected',
          target: req.params.requestId,
          metadata: { reason },
          ip: req.ip,
          userAgent: userAgentOf(req),
        });

      return { requestId: req.params.requestId, status: 'rejected' };
    },
  );
}
