/**
 * Session gate for `/api/app/admin/*` (SDD-006 §Autenticación, WO-101/WO-102): superadmin membership
 * plus a 2FA-verified session. Every existing caller (`./admin-organizations.ts`) picked up the 2FA
 * requirement automatically once this was added, with no call-site changes.
 */
import { isPlatformAdmin } from '@prdm/db';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Auth } from '../auth/build-auth.js';
import { ForbiddenError } from '../errors.js';
import { requireAppSession, requireVerifiedTwoFactor, type AppSessionContext } from './app-session.js';

/** Throws `UnauthorizedError` (no session), or `ForbiddenError` for either a session that isn't a
 * superadmin (SDD-006 gives platform admins no implicit access to organization content, so this check
 * is purely "is this user in `platform_admins`") or one that hasn't completed 2FA
 * (`requireVerifiedTwoFactor`, WO-102: "las rutas /admin ... exigen una sesión con 2FA verificada"). */
export async function requireSuperadminSession(auth: Auth, pool: Pool, req: FastifyRequest, publicUrl: string): Promise<AppSessionContext> {
  const session = await requireAppSession(auth, req, publicUrl);
  const admin = await isPlatformAdmin(pool, session.user.id);
  if (!admin) throw new ForbiddenError();
  requireVerifiedTwoFactor(session);
  return session;
}
