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

/**
 * `GET /reset-password/:token` (WO-116 addition, flagged in the WO report): better-auth's own
 * `request-password-reset` endpoint always mails a link of exactly this shape
 * (`${baseURL}/reset-password/${token}?callbackURL=...`, see `better-auth`'s
 * `dist/api/routes/password.mjs`) — a dynamic segment `AUTH_ALLOWED_PATHS`'s plain `Set<string>` can
 * never match by exact membership. Without this, the emailed link 404s and a real user can never reach
 * the dashboard's `/reset-password` screen from it (the token would only ever be visible by reading the
 * raw email source). This is the smallest addition that makes the already-shipped WO-096 email link
 * actually work: it only recognizes the literal `/reset-password/<opaque-token>` shape (one path segment,
 * no further slashes) and defers to better-auth's own endpoint (`requestPasswordResetCallback`, GET-only)
 * for everything else, including rejecting an invalid/expired token — this allowlist only decides
 * *reachability*, never validity. Gated to `GET` (the real endpoint's own method) so the WO-093 learning
 * test's literal `/reset-password/:token` template path — exercised there with `POST`, expecting a
 * 404 — still 404s exactly as before; only an actual `GET` to a concrete token path is newly reachable.
 */
const RESET_PASSWORD_CALLBACK_PATTERN = /^\/reset-password\/[^/]+$/;

export function isAllowedAuthPath(pathname: string, method = 'GET'): boolean {
  if (AUTH_ALLOWED_PATHS.has(pathname)) return true;
  return method.toUpperCase() === 'GET' && RESET_PASSWORD_CALLBACK_PATTERN.test(pathname);
}
