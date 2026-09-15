/**
 * Shared test-only helper (factored out of the WO-093 `auth-mount.test.ts` pattern, reused by every
 * `/api/app/*` integration test from WO-104 onward): a second `betterAuth` instance over the exact same
 * tables as the real one, with sign-up left enabled, standing in for a superadmin bootstrap script's own
 * user-creation path (`disableSignUp` has no "system action" bypass — see the WO-083 learning test).
 */
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { connect, schema } from '@prdm/db';
import type { PgTestDb } from '@prdm/testkit';
import type { ServerEnv } from '../../src/env.js';

const AUTH_SCHEMA = {
  user: schema.user,
  session: schema.session,
  account: schema.account,
  verification: schema.verification,
  organization: schema.organization,
  member: schema.member,
  invitation: schema.invitation,
  twoFactor: schema.twoFactor,
};

export function buildSeedAuth(env: ServerEnv, pool: PgTestDb['appPool']) {
  const database = drizzleAdapter(connect(pool), { provider: 'pg', schema: AUTH_SCHEMA });
  return betterAuth({
    database,
    baseURL: env.publicUrl,
    secret: env.betterAuthSecret,
    emailAndPassword: { enabled: true, disableSignUp: false, minPasswordLength: 12 },
    plugins: [organization({ allowUserToCreateOrganization: false, disableOrganizationDeletion: true }), twoFactor()],
    logger: { disabled: true },
  });
}

export interface SeededUser {
  id: string;
  email: string;
}

export async function seedUser(env: ServerEnv, pool: PgTestDb['appPool'], password = 'correct-horse-battery-staple'): Promise<SeededUser> {
  const seedAuth = buildSeedAuth(env, pool);
  const email = `${randomUUID()}@example.test`;
  const result = await seedAuth.api.signUpEmail({ body: { name: 'Test User', email, password } });
  return { id: result.user.id, email };
}

export function extractCookie(headers: Headers): string {
  const setCookie = headers.getSetCookie()[0];
  if (!setCookie) throw new Error('expected a Set-Cookie header');
  return setCookie.split(';')[0]!;
}
