/**
 * Learning test — ADR-006 / WO-083.
 *
 * Confirms the exact better-auth 1.7.4 API assumed by SDD-006 §"Autenticación" for the drizzle
 * adapter against a dedicated ("throwaway") Postgres schema, the allowlist-only mounting strategy,
 * public sign-up being disabled, the organization plugin's `allowUserToCreateOrganization: false`,
 * a server-side "superadmin" path that creates an organization and its owner, the fixed `baseURL`,
 * and `verification.storeIdentifier: 'hashed'`. Run against the shared Postgres test instance
 * (`docker compose --profile test up -d postgres-test`).
 *
 * CONFIRMED (read from `node_modules/better-auth` 1.7.4 and `@better-auth/core` sources, then
 * verified empirically against the live test Postgres instance):
 *
 *  - `drizzleAdapter(db, { provider: 'pg', schema })` (import from `better-auth/adapters/drizzle`)
 *    is exactly the factory ADR-006 assumes. `config.schemaName` (`DrizzleAdapterConfig.schemaName`)
 *    is documented as "used during the Better Auth CLI to generate the schema" — it is NOT read by
 *    the adapter at runtime. A dedicated ("throwaway") Postgres schema instead comes for free from
 *    passing `drizzle-orm`'s own `pgSchema(name).table(...)` objects in `schema`; every query drizzle
 *    builds off them is already schema-qualified.
 *  - `getAuthTables(options)` (import from `better-auth/db`, options containing whatever `plugins`
 *    the caller will pass to `betterAuth`) returns the exact field metadata — including every field
 *    the `organization` plugin adds — needed to hand-build a matching schema without needing
 *    `@better-auth/cli` at all: `BetterAuthDBSchema` maps model key -> `{ modelName, fields }`, and
 *    each `DBFieldAttribute` carries `type` (`string`/`number`/`boolean`/`date`/`json`), `required`
 *    and `unique`. The implicit `id` primary key column is NOT included and must be added by hand.
 *  - `auth.api` is a plain object of callable endpoint functions; each one carries `.path` (the
 *    path segment under `basePath`, e.g. `/sign-in/email`) and `.options.method`. DEVIATION worth
 *    noting: two of them (`setPassword`, `addMember`) have `path: undefined` — they are server-only
 *    helpers with no HTTP route at all, so an allowlist built from `.path` naturally excludes them
 *    without special-casing. The exact path set matching SDD-006's allowlist is confirmed below.
 *  - The default `basePath` is `/api/auth`, appended exactly once to the configured `baseURL` string
 *    — confirmed via `(await auth.$context).baseURL === 'https://app.example.test/api/auth'` for a
 *    plain string `baseURL: 'https://app.example.test'`.
 *  - `emailAndPassword.disableSignUp: true` (nested under `emailAndPassword`, not top-level) blocks
 *    `auth.api.signUpEmail` unconditionally — even called server-side with no request/session at all
 *    — throwing `APIError` `EMAIL_PASSWORD_SIGN_UP_DISABLED`. DEVIATION: unlike organization creation
 *    below, there is no "system action" bypass for sign-up, so a superadmin bootstrap script cannot
 *    use `signUpEmail` to seed users and must go through a lower-level path instead (this test uses a
 *    second `betterAuth` instance over the same tables with `disableSignUp: false`, standing in for
 *    that bootstrap path, purely to seed fixture users).
 *  - The `organization` plugin's `allowUserToCreateOrganization: false` is enforced only when a
 *    session is present (read from `crud-org.mjs`: `isSystemAction = !session && ctx.body.userId`).
 *    Calling `auth.api.createOrganization({ body: { name, slug, userId } })` with **no** `headers`
 *    and therefore no session is treated as a system action and bypasses the check entirely — this
 *    is the exact mechanism for "a server-side superadmin path creates an organization and invites
 *    its owner": the user named by `userId` is added as `owner` immediately, with no separate invite
 *    round-trip needed when the owner is known at creation time.
 *  - Session cookies for further server-side calls are obtained via
 *    `auth.api.signInEmail({ body, returnHeaders: true })` -> `{ headers, response }`; the
 *    `Set-Cookie` slice before its first `;` is what must be replayed as `Cookie` on subsequent
 *    `auth.api.X({ headers: new Headers({ cookie }), ... })` calls (no HTTP round trip needed).
 *  - `verification.storeIdentifier: 'hashed'` (exact path/name) hashes the verification table's
 *    `identifier` column (e.g. `reset-password:<token>`) — confirmed by reading the raw row back
 *    from Postgres after `requestPasswordReset`, never observing the plaintext token.
 *  - `emailAndPassword.revokeSessionsOnPasswordReset: true` deletes **all** of the user's sessions
 *    unconditionally (`internalAdapter.deleteUserSessions(userId)`), not just "other" ones — a mild
 *    DEVIATION from the SDD's "revoca las otras sesiones" wording, though moot in practice since
 *    `resetPassword` is a token-driven flow with no session of its own to spare.
 *  - `baseURL` fixed as a plain string is never derived from the request `Host`: mounting `auth` in
 *    a route that builds the forwarded fetch `Request`'s URL from the *inbound* (spoofable) `Host`
 *    header still produces reset links rooted at the configured `baseURL`, confirmed end-to-end
 *    through an actual Fastify route below.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pgSchema, text, boolean, timestamp, integer, jsonb, type PgColumnBuilderBase } from 'drizzle-orm/pg-core';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getAuthTables, type BetterAuthDBSchema, type DBFieldAttribute } from 'better-auth/db';
import { organization } from 'better-auth/plugins/organization';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openTestPg, type PgTestDb } from '@prdm/testkit';

const SCHEMA_NAME = 'wo083_better_auth_learning';
const FIXED_BASE_URL = 'https://app.example.test';
const SECRET = 'a'.repeat(32);
const ORG_OPTIONS = { allowUserToCreateOrganization: false, disableOrganizationDeletion: true } as const;

// SDD-006 §Autenticación's allowlist, verified below against `auth.api`'s own `.path`s.
const ALLOWED_PATHS = new Set([
  '/sign-in/email',
  '/sign-out',
  '/get-session',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
]);

function sqlTypeFor(attr: DBFieldAttribute): string {
  switch (attr.type) {
    case 'string':
      return 'text';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'timestamptz';
    case 'number':
      return attr.bigint ? 'bigint' : 'integer';
    case 'json':
      return 'jsonb';
    default:
      return 'text';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- building a schema dynamically from
// better-auth's own field metadata genuinely needs a widened column builder type here: `.notNull()`
// and `.unique()` each return a *new*, more specific builder type per concrete column type, so a
// variable meant to hold any of them (then conditionally chain both) can't stay precisely typed.
function columnFor(name: string, attr: DBFieldAttribute): any {
  let col: PgColumnBuilderBase;
  switch (attr.type) {
    case 'boolean':
      col = boolean(name);
      break;
    case 'date':
      col = timestamp(name, { withTimezone: true, mode: 'date' });
      break;
    case 'number':
      col = integer(name);
      break;
    case 'json':
      col = jsonb(name);
      break;
    default:
      col = text(name);
  }
  let widened: any = col;
  if (attr.required !== false) widened = widened.notNull();
  if (attr.unique) widened = widened.unique();
  return widened;
}

interface BuiltSchema {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle table objects, keyed by
  // better-auth model name; the adapter itself only cares that they're indexable by that key.
  drizzleTables: Record<string, any>;
  ddl: string[];
}

/** Hand-builds a Drizzle + DDL schema from better-auth's own `getAuthTables` metadata (see header). */
function buildAuthSchema(tables: BetterAuthDBSchema, schemaName: string): BuiltSchema {
  const pgSchemaObj = pgSchema(schemaName);
  const drizzleTables: BuiltSchema['drizzleTables'] = {};
  const ddl: string[] = [];
  for (const [modelKey, table] of Object.entries(tables)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see `columnFor`'s comment above.
    const columns: Record<string, any> = { id: text('id').primaryKey() };
    const ddlColumns = ['"id" text primary key'];
    for (const [fieldKey, attr] of Object.entries(table.fields)) {
      columns[fieldKey] = columnFor(fieldKey, attr);
      const notNull = attr.required !== false ? ' not null' : '';
      const unique = attr.unique ? ' unique' : '';
      ddlColumns.push(`"${fieldKey}" ${sqlTypeFor(attr)}${notNull}${unique}`);
    }
    drizzleTables[modelKey] = pgSchemaObj.table(table.modelName, columns);
    ddl.push(`create table "${schemaName}"."${table.modelName}" (${ddlColumns.join(', ')})`);
  }
  return { drizzleTables, ddl };
}

/** Converts a Fastify request into a fetch `Request`, deliberately trusting the inbound `Host`
 * header (as a naive reverse-proxy integration would) so the baseURL test below is meaningful. */
function toFetchRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
  }
  const url = `http://${req.headers.host}${req.url}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined });
}

async function sendFetchResponse(res: Response, reply: FastifyReply): Promise<void> {
  reply.code(res.status);
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'content-length') reply.header(key, value);
  });
  reply.send(Buffer.from(await res.arrayBuffer()));
}

function extractCookie(headers: Headers): string {
  const setCookie = headers.getSetCookie()[0];
  if (!setCookie) throw new Error('expected a Set-Cookie header from signInEmail');
  return setCookie.split(';')[0]!;
}

// Factories (rather than inline object literals assigned to a pre-declared `let auth: Auth`)
// so each variable's type is inferred from its own concrete, non-generic call — annotating with the
// bare `Auth` type instead collapses back to `Auth<BetterAuthOptions>` and loses the plugin-specific
// `api.createOrganization` etc. that `InferAPI` only adds when the literal config type is preserved.
function buildMainAuth(database: ReturnType<typeof drizzleAdapter>, capturedResetUrls: string[]) {
  return betterAuth({
    database,
    baseURL: FIXED_BASE_URL,
    secret: SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async (data) => {
        capturedResetUrls.push(data.url);
      },
    },
    verification: { storeIdentifier: 'hashed' },
    session: { cookieCache: { enabled: false } },
    plugins: [organization(ORG_OPTIONS)],
    logger: { disabled: true },
  });
}

// Stands in for a superadmin bootstrap script's own user-creation path (see header comment):
// `disableSignUp` has no "system action" bypass, so seeding fixture users needs a config where
// sign-up isn't blocked, pointed at the exact same tables as `buildMainAuth`.
function buildSeedAuth(database: ReturnType<typeof drizzleAdapter>) {
  return betterAuth({
    database,
    baseURL: FIXED_BASE_URL,
    secret: SECRET,
    emailAndPassword: { enabled: true, disableSignUp: false, minPasswordLength: 12 },
    plugins: [organization(ORG_OPTIONS)],
    logger: { disabled: true },
  });
}

describe('better-auth 1.7.4 + drizzle adapter over a throwaway Postgres schema (ADR-006, WO-083)', () => {
  let pg: PgTestDb;
  let mainAuth: ReturnType<typeof buildMainAuth>;
  let seedAuth: ReturnType<typeof buildSeedAuth>;
  let resetUrls: string[];

  beforeAll(async () => {
    pg = await openTestPg();
    const tables = getAuthTables({ plugins: [organization(ORG_OPTIONS)] });
    const { drizzleTables, ddl } = buildAuthSchema(tables, SCHEMA_NAME);

    await pg.ownerPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA_NAME}" CASCADE`);
    await pg.ownerPool.query(`CREATE SCHEMA "${SCHEMA_NAME}"`);
    for (const statement of ddl) await pg.ownerPool.query(statement);
    await pg.ownerPool.query(`GRANT USAGE ON SCHEMA "${SCHEMA_NAME}" TO prdm_app`);
    await pg.ownerPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${SCHEMA_NAME}" TO prdm_app`);

    const db = drizzle(pg.appPool);
    const database = drizzleAdapter(db, { provider: 'pg', schema: drizzleTables });

    resetUrls = [];
    mainAuth = buildMainAuth(database, resetUrls);
    seedAuth = buildSeedAuth(database);
  });

  afterAll(async () => {
    await pg.ownerPool.query(`DROP SCHEMA IF EXISTS "${SCHEMA_NAME}" CASCADE`);
    await pg.close();
  });

  async function createUser(password = 'correct-horse-battery-staple'): Promise<{ id: string; email: string }> {
    const email = `${randomUUID()}@example.test`;
    const result = await seedAuth.api.signUpEmail({ body: { name: 'Test User', email, password } });
    return { id: result.user.id, email };
  }

  test('email+password sign-in works against the drizzle-backed adapter', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await createUser(password);

    const { headers, response } = await mainAuth.api.signInEmail({ body: { email, password }, returnHeaders: true });

    expect(response.user.email).toBe(email);
    expect(headers.getSetCookie()[0]).toMatch(/^__Secure-better-auth\.session_token=/);
  });

  test('public sign-up is disabled: signUpEmail always throws, even with no request/session', async () => {
    await expect(
      mainAuth.api.signUpEmail({ body: { name: 'Nope', email: `${randomUUID()}@example.test`, password: 'whatever12345' } }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST', body: { code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' } });
  });

  test('a signed-in non-superadmin cannot create an organization (allowUserToCreateOrganization: false)', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await createUser(password);
    const { headers } = await mainAuth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    const cookie = extractCookie(headers);

    await expect(
      mainAuth.api.createOrganization({ headers: new Headers({ cookie }), body: { name: 'Acme', slug: `acme-${randomUUID()}` } }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN', body: { code: 'YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION' } });
  });

  test('a server-side (no session) call creates an organization and makes the given user its owner', async () => {
    const owner = await createUser();
    const slug = `acme-${randomUUID()}`;

    const org = await mainAuth.api.createOrganization({ body: { name: 'Acme', slug, userId: owner.id } });

    expect(org?.slug).toBe(slug);
    const { rows } = await pg.ownerPool.query<{ role: string }>(
      `SELECT role FROM "${SCHEMA_NAME}"."member" WHERE "organizationId" = $1 AND "userId" = $2`,
      [org!.id, owner.id],
    );
    expect(rows).toEqual([{ role: 'owner' }]);
  });

  test('baseURL is fixed: default basePath is appended once, independent of any request Host', async () => {
    const ctx = await mainAuth.$context;
    expect(ctx.baseURL).toBe(`${FIXED_BASE_URL}/api/auth`);
  });

  test('verification.storeIdentifier "hashed" stores a hashed identifier, never the plaintext token', async () => {
    const { email } = await createUser();
    resetUrls.length = 0;

    await mainAuth.api.requestPasswordReset({ body: { email } });

    expect(resetUrls).toHaveLength(1);
    const token = resetUrls[0]!.split('/reset-password/')[1]!.split('?')[0]!;
    const { rows } = await pg.ownerPool.query<{ identifier: string }>(
      `SELECT identifier FROM "${SCHEMA_NAME}"."verification" ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(rows[0]!.identifier).not.toBe(`reset-password:${token}`);
    expect(rows[0]!.identifier).not.toContain(token);
  });

  test('revokeSessionsOnPasswordReset revokes the session after a password reset', async () => {
    const password = 'correct-horse-battery-staple';
    const { email } = await createUser(password);
    const { headers } = await mainAuth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    const cookie = extractCookie(headers);
    resetUrls.length = 0;

    await mainAuth.api.requestPasswordReset({ body: { email } });
    const token = resetUrls[0]!.split('/reset-password/')[1]!.split('?')[0]!;
    await mainAuth.api.resetPassword({ body: { newPassword: 'a-new-correct-horse', token } });

    await expect(mainAuth.api.listSessions({ headers: new Headers({ cookie }) })).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
  });

  test('auth.api exposes exactly the SDD-006 allowlist paths among its endpoints', () => {
    const paths = new Set(Object.values(mainAuth.api).map((endpoint) => endpoint.path).filter((path): path is string => !!path));
    for (const allowed of ALLOWED_PATHS) expect(paths.has(allowed)).toBe(true);
    // Endpoints deliberately excluded from the allowlist (SDD-006 §Autenticación) must still exist
    // (proving the allowlist is a filter, not an accident of what's registered).
    expect(paths.has('/sign-up/email')).toBe(true);
    expect(paths.has('/organization/create')).toBe(true);
  });

  test('mounting only the allowlist in Fastify 404s everything else, and baseURL ignores a spoofed Host', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    app.all('/api/auth/*', async (req, reply) => {
      const pathname = req.url.replace(/^\/api\/auth/, '').split('?')[0]!;
      if (!ALLOWED_PATHS.has(pathname)) {
        reply.code(404).send();
        return;
      }
      const response = await mainAuth.handler(toFetchRequest(req));
      await sendFetchResponse(response, reply);
    });

    const disallowed = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { host: 'evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(disallowed.statusCode).toBe(404);

    const { email } = await createUser();
    resetUrls.length = 0;
    const allowed = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { host: 'evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({ email }),
    });
    expect(allowed.statusCode).toBe(200);
    expect(resetUrls).toHaveLength(1);
    expect(resetUrls[0]).toMatch(new RegExp(`^${FIXED_BASE_URL}/`));

    await app.close();
  });
});
