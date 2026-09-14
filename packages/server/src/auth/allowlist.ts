/**
 * SDD-006 §Autenticación's better-auth allowlist, confirmed against `auth.api`'s own `.path`s by the
 * WO-083 learning test (`packages/server/tests/learning/better-auth-drizzle.test.ts`). Everything
 * `/api/auth/*` that isn't in this set 404s (see `./register-auth.ts`) — including
 * `/sign-up/email`, every `/organization/*` mutation, `/update-user`'s sibling `/change-email` and
 * `/delete-user`, and every other endpoint `auth.api` exposes by default.
 *
 * The four `two-factor` endpoints are the minimum needed to enroll/verify/disable TOTP (SDD-006's
 * "TOTP obligatorio para superadmins" is enforced by a later WO; registering the plugin and allowing
 * these endpoints now doesn't itself require or enforce 2FA for anyone).
 */
export const AUTH_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/email',
  '/sign-out',
  '/get-session',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/two-factor/enable',
  '/two-factor/get-totp-uri',
  '/two-factor/verify-totp',
  '/two-factor/disable',
]);

/** Endpoints `auth.api` exposes that must never be reachable over HTTP even though the allowlist
 * already excludes them by omission — asserted explicitly so a future allowlist edit can't silently
 * re-admit an organization mutation. */
export const ORGANIZATION_MUTATION_PATHS: readonly string[] = [
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/invite-member',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/accept-invitation',
  '/organization/cancel-invitation',
  '/organization/reject-invitation',
  '/organization/leave',
  '/organization/set-active',
];

export function isAllowedAuthPath(pathname: string): boolean {
  return AUTH_ALLOWED_PATHS.has(pathname);
}
