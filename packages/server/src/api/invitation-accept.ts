/**
 * `POST /api/app/invitations/:id/accept` (SDD-006 §Autenticación, WO-105): resolves the invitation from
 * its one-time secret alone via `resolve_invitation` (never trusting `:id` on its own — a mismatch
 * between the path id and what the secret actually resolves to is treated exactly like a wrong secret),
 * then accepts atomically as a brand-new user (`name`+`password` required) or an already signed-in
 * existing user whose session email matches the invitation. Rate-limited per IP and per resolved email.
 */
import { acceptInvitationInputSchema } from '@prdm/contracts';
import {
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  acceptInvitationAsNewUser,
  acceptInvitationForExistingUser,
  createTenantDb,
  findInvitationById,
  listProjectInvitationGrants,
  resolveInvitationBySecret,
  type OrgRole,
} from '@prdm/db';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { toFetchRequest } from '../auth/to-fetch-request.js';
import type { ServerEnv } from '../env.js';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from '../errors.js';
import type { KeyedRateLimiter } from '../rate-limit/keyed-rate-limit.js';

export interface RegisterInvitationAcceptRouteOptions {
  auth: Auth;
  pool: Pool;
  env: ServerEnv;
  rateLimiter: KeyedRateLimiter;
}

interface AcceptInvitationParams {
  id: string;
}

export function registerInvitationAcceptRoute(app: FastifyInstance, opts: RegisterInvitationAcceptRouteOptions): void {
  const { auth, pool, env, rateLimiter } = opts;

  app.post<{ Params: AcceptInvitationParams }>('/api/app/invitations/:id/accept', async (req, reply) => {
    const parsed = acceptInvitationInputSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('invalid body');

    const resolved = await resolveInvitationBySecret(pool, parsed.data.secret);

    // A path id that doesn't match what the secret itself resolves to (including "the secret matches
    // nothing at all") is rejected identically — the response never reveals which one was wrong, and an
    // id alone (visible in the URL's path, unlike the secret) proves nothing (SDD-006 §Autenticación /
    // WO-105: "id sin secreto es rechazado").
    if (!resolved || resolved.invitationId !== req.params.id) {
      const limit = await rateLimiter.check(req, undefined);
      if (!limit.allowed) {
        reply.header('retry-after', String(limit.retryAfterSeconds));
        throw new RateLimitedError();
      }
      throw new NotFoundError();
    }

    const limit = await rateLimiter.check(req, resolved.email.toLowerCase());
    if (!limit.allowed) {
      reply.header('retry-after', String(limit.retryAfterSeconds));
      throw new RateLimitedError();
    }

    const invitationRecord = await findInvitationById(pool, resolved.invitationId);
    if (!invitationRecord) throw new NotFoundError();
    const orgRole = (invitationRecord.role ?? 'member') as OrgRole;
    const grants = await listProjectInvitationGrants(pool, resolved.orgId, resolved.invitationId);

    // Existing-user path (SDD-006: "usuario existente: exige sesión con ese email más el secreto") —
    // resolved purely from whatever session cookie the caller already presents, never from the body.
    const headers = toFetchRequest(req, env.publicUrl).headers;
    const session = await auth.api.getSession({ headers });

    try {
      const result = session?.user
        ? await acceptAsExistingUser(pool, resolved, orgRole, grants, session.user)
        : await acceptAsNewUser(pool, resolved, orgRole, grants, parsed.data);

      await createTenantDb(pool)
        .forOrg(resolved.orgId)
        .auditLog.record({
          actorType: 'user',
          actorId: result.userId,
          action: 'organization.invitation.accepted',
          target: resolved.invitationId,
          ip: req.ip,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
        });

      return { userId: result.userId, organizationId: resolved.orgId };
    } catch (err) {
      if (err instanceof InvitationAlreadyAcceptedError || err instanceof InvitationExpiredError) throw new ConflictError(err.message);
      if (err instanceof InvitationNotFoundError) throw new NotFoundError();
      throw err;
    }
  });
}

interface ResolvedInvitationLike {
  orgId: string;
  invitationId: string;
  email: string;
}

interface GrantLike {
  projectId: string;
  role: 'admin' | 'editor' | 'developer' | 'commenter' | 'viewer';
}

async function acceptAsExistingUser(
  pool: Pool,
  resolved: ResolvedInvitationLike,
  orgRole: OrgRole,
  grants: GrantLike[],
  sessionUser: { id: string; email: string },
): Promise<{ userId: string }> {
  if (sessionUser.email.toLowerCase() !== resolved.email.toLowerCase()) {
    throw new ForbiddenError('signed-in session does not match the invited email');
  }
  return acceptInvitationForExistingUser(pool, {
    orgId: resolved.orgId,
    invitationId: resolved.invitationId,
    userId: sessionUser.id,
    orgRole,
    grants,
  });
}

async function acceptAsNewUser(
  pool: Pool,
  resolved: ResolvedInvitationLike,
  orgRole: OrgRole,
  grants: GrantLike[],
  body: { name?: string; password?: string },
): Promise<{ userId: string }> {
  if (!body.password || !body.name) {
    throw new ValidationError('name and password are required to accept as a new user');
  }
  return acceptInvitationAsNewUser(pool, {
    orgId: resolved.orgId,
    invitationId: resolved.invitationId,
    email: resolved.email,
    name: body.name,
    password: body.password,
    orgRole,
    grants,
  });
}
