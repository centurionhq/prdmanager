/**
 * Session gate for `/api/app/admin/*` (SDD-006 §Autenticación, WO-101). WO-102 extends
 * `requireSuperadminSession` in place to additionally require a 2FA-verified session
 * (`requireVerifiedTwoFactor`) — every caller of this function automatically gets that once it lands,
 * with no call-site changes needed.
 */
import { isPlatformAdmin } from '@prdm/db';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { ForbiddenError } from '../errors.js';
import { requireAppSession, type AppSessionContext } from './app-session.js';

/** Throws `UnauthorizedError` (no session) or `ForbiddenError` (session, but not a superadmin —
 * SDD-006 gives platform admins no implicit access to organization content, so this check is purely
 * "is this user in `platform_admins`", never anything membership-related). */
export async function requireSuperadminSession(auth: Auth, pool: Pool, req: FastifyRequest, publicUrl: string): Promise<AppSessionContext> {
  const session = await requireAppSession(auth, req, publicUrl);
  const admin = await isPlatformAdmin(pool, session.user.id);
  if (!admin) throw new ForbiddenError();
  return session;
}
