/**
 * better-auth 1.7.4 instance factory (SDD-006 §Autenticación, WO-093/WO-094): mounted only through
 * `./register-auth.ts`'s allowlist, never exposed directly. Configuration confirmed against the
 * WO-083 learning test (`packages/server/tests/learning/better-auth-drizzle.test.ts`).
 */
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { connect, schema } from '@prdm/db';
import type { Pool } from 'pg';
import { buildResetPasswordEmail } from '../email/reset-password-email.js';
import type { ServerEnv } from '../env.js';
import type { Mailer } from '../mailer.js';

/** `allowUserToCreateOrganization: false` (SDD-006 §Autenticación): organizations are only ever
 * created server-side (a session-less `createOrganization` call, per the WO-083 learning test's
 * "system action" finding — SDD-006's own superadmin bootstrap, a later WO). */
const ORG_OPTIONS = { allowUserToCreateOrganization: false, disableOrganizationDeletion: true } as const;

/** `/update-user` accepts `name` and `image` by default; SDD-006 restricts it to `name` only. */
const UPDATE_USER_ALLOWED_FIELDS = new Set(['name']);

/** `__Host-` requires Secure, `Path=/` and no `Domain` attribute — all true here (no
 * `crossSubDomainCookies`), so it's safe to force on every better-auth cookie in production. */
const HOST_COOKIE_PREFIX = '__Host-';

export interface BuildAuthDeps {
  env: ServerEnv;
  pool: Pool;
  mailer: Mailer;
  /** Reserved for session/verification fixed-clock testing in a later WO; unused by better-auth's own API today. */
  clock?: () => Date;
}

/** `/change-password`'s own `revokeOtherSessions` flag is client-controlled and optional; SDD-006
 * ("cambiar la contraseña revoca las otras sesiones") makes it mandatory, so it's forced server-side
 * regardless of what the request body says. Combined with the `/update-user` field restriction into
 * a single `before` hook, since better-auth only accepts one. */
const beforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === '/update-user') {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (!UPDATE_USER_ALLOWED_FIELDS.has(key)) {
        throw new APIError('BAD_REQUEST', { message: `field "${key}" cannot be changed via update-user` });
      }
    }
    return;
  }
  if (ctx.path === '/change-password') {
    (ctx.body as Record<string, unknown>).revokeOtherSessions = true;
  }
  // WO-102: "trustDevice deshabilitado para superadmins". 2FA in this slice is exclusively enrolled by
  // and enforced for superadmins (the bootstrap CLI is the only enrollment path; `/api/app/admin/*` is
  // the only place a verified session is required) — forcing this off unconditionally for every
  // `/two-factor/verify-totp` call is therefore exactly "disabled for superadmins" today. A future WO
  // that extends 2FA to non-superadmin members would need to scope this by role instead.
  if (ctx.path === '/two-factor/verify-totp') {
    (ctx.body as Record<string, unknown>).trustDevice = false;
  }
});

/** Builds the `advanced.cookies` overrides for the `__Host-` prefix (SDD-006 §Autenticación:
 * "prefijo __Host- en producción"; plain names stay allowed everywhere else, including tests). Each
 * cookie's `name` is fully qualified here (bypassing better-auth's own `__Secure-` auto-prefixing,
 * which would otherwise stack in front of `__Host-` and produce an invalid cookie name). */
function hostPrefixedCookies(): Record<string, { name: string; attributes: Record<string, unknown> }> {
  const secureAttributes = { secure: true, httpOnly: true, sameSite: 'lax' as const, path: '/' };
  return {
    session_token: { name: `${HOST_COOKIE_PREFIX}prdm.session_token`, attributes: secureAttributes },
    session_data: { name: `${HOST_COOKIE_PREFIX}prdm.session_data`, attributes: secureAttributes },
    dont_remember: { name: `${HOST_COOKIE_PREFIX}prdm.dont_remember`, attributes: secureAttributes },
  };
}

export function buildAuth(deps: BuildAuthDeps) {
  const { env, pool, mailer } = deps;
  const db = connect(pool);
  const database = drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
      twoFactor: schema.twoFactor,
    },
  });

  return betterAuth({
    database,
    baseURL: env.publicUrl,
    secret: env.betterAuthSecret,
    trustedOrigins: env.trustedOrigins,
    // @fastify/rate-limit (WO-095) is the single rate-limiting layer, sharing one IP source with
    // better-auth (SDD-006 §Autenticación): better-auth's own built-in limiter is disabled.
    rateLimit: { enabled: false },
    // Verification identifiers (reset-password tokens) are hashed at rest (SDD-006 §Autenticación),
    // confirmed by the WO-083 learning test to never store the plaintext token.
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      // The WO-083 learning test confirms this revokes every session unconditionally.
      revokeSessionsOnPasswordReset: true,
      // The email itself (SDD-006 §Autenticación, WO-096): the user's own name is HTML-escaped and
      // CR/LF-stripped in both bodies, and the link is always `url` — already rooted at
      // PRDM_PUBLIC_URL, never a request Host (WO-083 learning test finding, WO-094 Host guard).
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendMail(buildResetPasswordEmail({ userName: user.name, userEmail: user.email, url }));
      },
    },
    session: {
      // No server-side session cache cookie (SDD-006 §Autenticación): every session read hits Postgres.
      cookieCache: { enabled: false },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    plugins: [organization(ORG_OPTIONS), twoFactor()],
    hooks: { before: beforeHook },
    advanced: env.nodeEnv === 'production' ? { useSecureCookies: false, cookies: hostPrefixedCookies() } : {},
    logger: { disabled: env.nodeEnv === 'test' },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
