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
import type { ServerEnv } from '../env.js';
import type { Mailer } from '../mailer.js';

/** `allowUserToCreateOrganization: false` (SDD-006 §Autenticación): organizations are only ever
 * created server-side (a session-less `createOrganization` call, per the WO-083 learning test's
 * "system action" finding — SDD-006's own superadmin bootstrap, a later WO). */
const ORG_OPTIONS = { allowUserToCreateOrganization: false, disableOrganizationDeletion: true } as const;

/** `/update-user` accepts `name` and `image` by default; SDD-006 restricts it to `name` only. */
const UPDATE_USER_ALLOWED_FIELDS = new Set(['name']);

export interface BuildAuthDeps {
  env: ServerEnv;
  pool: Pool;
  mailer: Mailer;
  /** Reserved for session/verification fixed-clock testing in a later WO; unused by better-auth's own API today. */
  clock?: () => Date;
}

function restrictUpdateUserFields() {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/update-user') return;
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      if (!UPDATE_USER_ALLOWED_FIELDS.has(key)) {
        throw new APIError('BAD_REQUEST', { message: `field "${key}" cannot be changed via update-user` });
      }
    }
  });
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
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendMail({
          to: user.email,
          subject: 'Reset your prdm password',
          text: `Reset your password: ${url}`,
        });
      },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    plugins: [organization(ORG_OPTIONS), twoFactor()],
    hooks: { before: restrictUpdateUserFields() },
    logger: { disabled: env.nodeEnv === 'test' },
  });
}

export type Auth = ReturnType<typeof buildAuth>;
