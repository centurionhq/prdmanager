/**
 * Superadmin bootstrap (SDD-006 §Autenticación, WO-101): the *only* way `platform_admins` ever gets a
 * row outside a test fixture. Everything here is injected (pool, prompts, clock, logger) so
 * `packages/server/tests/unit/bootstrap-superadmin.test.ts` can exercise the hidden-prompt path and the
 * "already exists" guard without a real terminal — `./run-bootstrap-superadmin.ts` is the only module
 * that wires real `process.env`/stdin/stdout to this function, mirroring how `../main.ts` is the only
 * place `packages/server` itself reads `process.env`.
 *
 * `pool` must be `prdm_owner`-credentialed (`DATABASE_MIGRATION_URL`, never `DATABASE_URL`/`prdm_app`):
 * `platform_admins` grants `prdm_app` `SELECT` only (WO-099's catalog test), so the one `INSERT` this
 * command performs (`insertPlatformAdmin`) would fail outright against the app pool.
 *
 * Creating the user itself bypasses `disableSignUp: true` (SDD-006: public sign-up is disabled) via a
 * second `betterAuth` instance over the same tables with `disableSignUp: false` — the exact "system
 * action" pattern the WO-083 learning test already established for seeding fixture users, reused here
 * for the one legitimate case of creating a user outside the invitation flow.
 *
 * WO-102: SDD-006 §Autenticación requires TOTP to be enrolled "before the first admin action" — since
 * this command's own completion is the earliest a fresh superadmin could take one, enrollment happens
 * here, unconditionally, as the last step. The `otpauth://` URI is printed to the terminal exactly once
 * (via `log`, never written to a file) and the flow only finishes once `prompts.totpCode()` proves the
 * operator actually captured it in an authenticator app — an enrollment nobody could complete would
 * otherwise leave a superadmin permanently locked out of `/api/app/admin/*` (WO-102 requires a
 * 2FA-verified session there), which is worse than requiring it up front.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { connect, countPlatformAdmins, insertPlatformAdmin, recordPlatformAuditLog, schema } from '@prdm/db';
import type { Pool } from 'pg';

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

export interface BootstrapSuperadminEnv {
  publicUrl: string;
  betterAuthSecret: string;
}

/** Built once per invocation, over the `prdm_owner` pool passed to `bootstrapSuperadmin`, with sign-up
 * left enabled — never mounted on any HTTP route (SDD-006 §Autenticación: public sign-up stays
 * disabled everywhere the real server actually listens). Exported so WO-102 can reuse the exact same
 * instance to enroll TOTP before this command finishes, instead of building a third one. */
export function buildBootstrapAuth(pool: Pool, env: BootstrapSuperadminEnv) {
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

export interface BootstrapPrompts {
  email(): Promise<string>;
  name(): Promise<string>;
  /** Must read from a hidden/non-echoing input; the CLI entrypoint never accepts this via argv or an
   * environment variable (SDD-006 §Autenticación). */
  password(): Promise<string>;
  /** The 6-digit code from the operator's authenticator app, entered after `log` prints the enrollment
   * URI (WO-102) — proves the operator actually captured the secret before bootstrap finishes. */
  totpCode(): Promise<string>;
}

export interface BootstrapSuperadminOptions {
  /** `prdm_owner`-credentialed pool (see module doc comment). */
  pool: Pool;
  env: BootstrapSuperadminEnv;
  prompts: BootstrapPrompts;
  /** Fails instead of creating a second superadmin unless this is `true`. */
  additional?: boolean;
  clock?: () => Date;
  /** Every line this command prints to the operator — swapped for a capturing spy in tests, so a test
   * can assert nothing sensitive (e.g. a TOTP secret, once WO-102 lands) leaks anywhere but here. */
  log?: (message: string) => void;
}

export class SuperadminAlreadyExistsError extends Error {
  constructor() {
    super('a platform superadmin already exists; pass --additional to create another one');
    this.name = 'SuperadminAlreadyExistsError';
  }
}

export interface BootstrapSuperadminResult {
  userId: string;
  email: string;
}

function extractCookie(headers: Headers): string {
  const setCookie = headers.getSetCookie()[0];
  if (!setCookie) throw new Error('expected a Set-Cookie header from signInEmail');
  return setCookie.split(';')[0]!;
}

export async function bootstrapSuperadmin(opts: BootstrapSuperadminOptions): Promise<BootstrapSuperadminResult> {
  const { pool, env, prompts, additional = false, clock = () => new Date(), log = (message: string) => process.stdout.write(`${message}\n`) } = opts;

  const existing = await countPlatformAdmins(pool);
  if (existing > 0 && !additional) {
    throw new SuperadminAlreadyExistsError();
  }

  const email = (await prompts.email()).trim();
  const name = (await prompts.name()).trim();
  const password = await prompts.password();

  const bootstrapAuth = buildBootstrapAuth(pool, env);
  const { user } = await bootstrapAuth.api.signUpEmail({ body: { name, email, password } });

  await insertPlatformAdmin(pool, user.id);

  // WO-102: enroll TOTP before this command (and therefore any admin action) can be considered done.
  // Signing in first is what gets a normal, non-2FA-pending session — the user was just created with
  // twoFactorEnabled=false, so /sign-in/email's own two-factor hook has nothing to intercept yet.
  const signIn = await bootstrapAuth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const headers = new Headers({ cookie: extractCookie(signIn.headers) });

  const enrolled = await bootstrapAuth.api.enableTwoFactor({ headers, body: { password, method: 'totp' } });
  if (enrolled.method !== 'totp') {
    throw new Error('two-factor enrollment did not return a TOTP URI');
  }
  log(`Scan this URI with your authenticator app (shown once, never logged): ${enrolled.totpURI}`);

  const code = await prompts.totpCode();
  // `trustDevice: false` unconditionally (SDD-006 §Autenticación: "trustDevice deshabilitado para
  // superadmins") — irrelevant here anyway (this is enrollment, not a sign-in challenge), but explicit
  // for anyone reading this as the reference call site.
  await bootstrapAuth.api.verifyTOTP({ headers, body: { code, trustDevice: false } });

  await recordPlatformAuditLog(pool, {
    actorType: 'system',
    actorId: user.id,
    action: 'platform.superadmin.bootstrapped',
    target: user.id,
    metadata: { email, additional, totpEnrolled: true },
  });

  log(`Superadmin created: ${email} (user ${user.id}) at ${clock().toISOString()}`);

  return { userId: user.id, email };
}
