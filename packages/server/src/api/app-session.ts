/**
 * Session resolution for `/api/app/*` routes (SDD-006 §Arquitectura, WO-104): every route in this
 * family requires an authenticated better-auth session, resolved the exact same way `/api/auth/*`
 * itself reads one (`../auth/to-fetch-request.js`'s header conversion), so a cookie set by
 * `/api/auth/sign-in/email` is understood identically here — there is no separate session mechanism.
 */
import type { FastifyRequest } from 'fastify';
import type { Auth } from '../auth/build-auth.js';
import { toFetchRequest } from '../auth/to-fetch-request.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';

export interface AppSessionUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}

export interface AppSessionContext {
  user: AppSessionUser;
  /** Forwarded as-is to any further server-side `auth.api.*` call made on the caller's behalf
   * (e.g. `setActiveOrganization`) so it observes the exact same session. */
  headers: Headers;
}

/** Throws `UnauthorizedError` (401) when there is no valid session — never lets an `/api/app/*` route
 * run unauthenticated. */
export async function requireAppSession(auth: Auth, req: FastifyRequest, publicUrl: string): Promise<AppSessionContext> {
  const headers = toFetchRequest(req, publicUrl).headers;
  const result = await auth.api.getSession({ headers });
  if (!result?.user) throw new UnauthorizedError();
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      twoFactorEnabled: Boolean(result.user.twoFactorEnabled),
    },
    headers,
  };
}

/** SDD-006 §Autenticación: "/admin ... exigen una sesión con 2FA verificada" (WO-102). A real session
 * for a `twoFactorEnabled` user already proves 2FA was completed for this sign-in — the two-factor
 * plugin deletes the session created at credential sign-in and only creates the real one after
 * `/two-factor/verify-totp` succeeds (see `packages/server/tests/learning`), so there is no
 * "authenticated but still 2FA-pending" session to distinguish here. */
export function requireVerifiedTwoFactor(session: AppSessionContext): void {
  if (!session.user.twoFactorEnabled) throw new ForbiddenError('two-factor authentication required');
}
