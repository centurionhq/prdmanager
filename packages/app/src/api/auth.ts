/**
 * `/api/auth/*` (better-auth, allowlisted per SDD-006 §Autenticación) calls used by the dashboard shell's
 * login, password-reset and TOTP-challenge screens (WO-116/WO-120). Never behind CSRF (see `./request.ts`).
 */
import { authRequest } from './request.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled?: boolean;
}

export interface SignInResult {
  /** Present once fully signed in (no 2FA pending). */
  user?: AuthUser;
  /** SDD-006 §Autenticación / WO-102: a superadmin with TOTP enrolled gets this instead of a session on
   * the first credential check — `POST /api/auth/two-factor/verify-totp` completes the sign-in. */
  twoFactorRedirect?: boolean;
}

export function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  return authRequest<SignInResult>('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
}

export function verifyTotpCode(code: string): Promise<SignInResult> {
  return authRequest<SignInResult>('/api/auth/two-factor/verify-totp', { method: 'POST', body: { code } });
}

export function signOut(): Promise<unknown> {
  return authRequest('/api/auth/sign-out', { method: 'POST' });
}

export interface SessionResult {
  user: AuthUser;
}

/** `null` when signed out — `get-session` itself replies `200` with a `null` body in that case. */
export async function getSession(): Promise<SessionResult | null> {
  const result = await authRequest<SessionResult | null>('/api/auth/get-session', { method: 'GET' });
  return result ?? null;
}

/** `redirectTo` is the dashboard's own `/reset-password` route: better-auth mails a link to
 * `GET /api/auth/reset-password/:token?callbackURL=<redirectTo>`, which 302s the browser back here with
 * `?token=<token>` appended once the token checks out (SDD-006 §Autenticación "reseteo"). The response is
 * intentionally identical whether or not the email exists (server-side timing-attack mitigation) — this
 * screen must never claim otherwise. */
export function requestPasswordReset(email: string, redirectTo: string): Promise<{ status: boolean; message: string }> {
  return authRequest('/api/auth/request-password-reset', { method: 'POST', body: { email, redirectTo } });
}

export function completePasswordReset(token: string, newPassword: string): Promise<{ status: boolean }> {
  return authRequest('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
}
