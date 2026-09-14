/**
 * Catalog test (WO-099, SDD-006 §Aislamiento por capas, point 4). Runs entirely as `prdm_owner`
 * (never `prdm_app`) reading `pg_catalog`/`information_schema`, so it exercises the real, applied
 * migrations rather than the Drizzle schema source — a table that got its `org_id`/RLS/FK right in
 * `packages/db/src/schema/*.ts` but wrong in a hand-appended migration statement still fails here.
 *
 * DEVIATION from the literal WO-099 wording ("except the better-auth tables, platform_admins,
 * platform_audit_log, retired_handles ... and the drizzle migrations table"): `user_profile` is also
 * allowlisted below, even though that sentence doesn't name it. SDD-006 §Modelo de datos places
 * `user_profile` right alongside the better-auth tables ("Tablas de better-auth ... son globales (sin
 * RLS). Además: user_profile ...") precisely because it's a 1:1 extension of a *user* identity, not
 * something that belongs to one organization — a user can be a member of several orgs via `member`,
 * so `user_profile` structurally cannot carry a meaningful single `org_id`. The §Aislamiento
 * paragraph's exclusion list ("toda tabla salvo las de better-auth, platform_admins y
 * platform_audit_log...") is the one place in SDD-006 that omits it, which reads as an oversight
 * rather than an intentional requirement to force an org_id onto a global identity table.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openTestPg, type PgTestDb } from '@prdm/testkit';

let pg: PgTestDb;

// Explicit allowlist (WO-099: "Keep the allowlist explicit in the test") — every table that is
// allowed to skip org_id/RLS/composite-FK. The drizzle migrations bookkeeping table isn't in `public`
// at all (packages/db/src/migrate.ts: it lives in its own `drizzle` schema), so it never needs listing
// here, but is called out anyway for anyone reading this allowlist against the WO-099 wording.
const ALLOWLISTED_TABLES = new Set([
  // better-auth (SDD-006 §Modelo de datos: global, no RLS)
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  'twoFactor',
  // superadmin platform tables (SDD-006 §Modelo de datos)
  'platform_admins',
  'platform_audit_log',
  // handle-reuse guard (WO-092); global, keyed by handle rather than org
  'retired_handles',
  // see the DEVIATION note in the module doc comment above
  'user_profile',
  // SDD-009 §Seguridad y costo (WO-168/175): the cross-org daily token/request cutoff that protects the
  // one shared DeepSeek key — see packages/db/src/schema/agent.ts's own module doc comment for why this
  // is structurally a platform-level counter (no single org_id could own a cross-tenant total) rather
  // than tenant data; it holds nothing but a date and two counts.
  'llm_global_usage',
  // SDD-010 (WO-179): a GitHub Actions OIDC token's jti must be single-use regardless of which
  // organization eventually verifies it — see packages/db/src/schema/oidc.ts's own module doc comment
  // for why this is deliberately global rather than tenant data.
  'oidc_used_jtis',
]);

interface TableRow {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
}

async function listPublicTables(): Promise<TableRow[]> {
  const { rows } = await pg.ownerPool.query<TableRow>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  return rows;
}

async function hasNotNullColumn(table: string, column: string): Promise<boolean> {
  const { rows } = await pg.ownerPool.query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0 && rows[0]!.is_nullable === 'NO';
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const { rows } = await pg.ownerPool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

/** A composite FK on `(column, org_id)` pointing at some other table's `(id, org_id)`-shaped unique key. */
async function hasCompositeOrgFk(table: string, column: string): Promise<boolean> {
  const { rows } = await pg.ownerPool.query(
    `SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = $1 AND c.contype = 'f'
        AND c.conkey @> ARRAY[
              (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = $2),
              (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'org_id')
            ]::smallint[]`,
    [table, column],
  );
  return rows.length > 0;
}

async function hasTablePrivilege(role: string, table: string, privilege: string): Promise<boolean> {
  const { rows } = await pg.ownerPool.query<{ has: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS has`, [role, table, privilege]);
  return rows[0]!.has;
}

interface SecurityDefinerFunctionRow {
  proname: string;
  owner: string;
  proconfig: string[] | null;
  /** `regprocedure` text, e.g. `resolve_token(text)` — the exact signature `has_function_privilege` needs. */
  signature: string;
  /** Trigger functions (e.g. `guard_user_profile_handle_reuse`) are invoked by the trigger mechanism, never
   * called directly, so they're never granted EXECUTE to prdm_app — only PUBLIC's default grant is revoked. */
  isTrigger: boolean;
}

/** Every `SECURITY DEFINER` function in the `public` schema (WO-097: `resolve_project`,
 * `resolve_graph_project`, `resolve_invitation` today; `resolve_token`/`resolve_document` once WO-109
 * adds them; `read_platform_audit_log` from 0002) — enumerated by `prosecdef`, never by name, so a
 * future migration that adds one without following the template is caught here automatically. */
async function listSecurityDefinerFunctions(): Promise<SecurityDefinerFunctionRow[]> {
  const { rows } = await pg.ownerPool.query<SecurityDefinerFunctionRow>(
    `SELECT p.proname, own.rolname AS owner, p.proconfig, p.oid::regprocedure::text AS signature,
            (p.prorettype = 'trigger'::regtype) AS "isTrigger"
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_roles own ON own.oid = p.proowner
      WHERE n.nspname = 'public' AND p.prosecdef = true
      ORDER BY p.proname`,
  );
  return rows;
}

async function hasFunctionPrivilege(role: string, signature: string, privilege: string): Promise<boolean> {
  const { rows } = await pg.ownerPool.query<{ has: boolean }>(`SELECT has_function_privilege($1, $2, $3) AS has`, [role, signature, privilege]);
  return rows[0]!.has;
}

beforeAll(async () => {
  pg = await openTestPg();
});

afterAll(async () => {
  await pg.close();
});

describe('catalog test: every non-allowlisted table is tenant-isolated (WO-099)', () => {
  test('every non-allowlisted public table has org_id NOT NULL, RLS enabled and forced', async () => {
    const tables = await listPublicTables();
    const checked = tables.filter((t) => !ALLOWLISTED_TABLES.has(t.relname));
    expect(checked.length).toBeGreaterThan(0); // sanity: this test isn't vacuously passing

    for (const table of checked) {
      expect(await hasNotNullColumn(table.relname, 'org_id'), `${table.relname}.org_id must exist and be NOT NULL`).toBe(true);
      expect(table.relrowsecurity, `${table.relname} must have RLS ENABLEd`).toBe(true);
      expect(table.relforcerowsecurity, `${table.relname} must have RLS FORCEd`).toBe(true);
    }
  });

  test('every non-allowlisted table with project_id or document_id has a composite FK to org_id', async () => {
    const tables = await listPublicTables();
    const checked = tables.filter((t) => !ALLOWLISTED_TABLES.has(t.relname));

    let sawAtLeastOneProjectScoped = false;
    for (const table of checked) {
      for (const column of ['project_id', 'document_id']) {
        if (await hasColumn(table.relname, column)) {
          sawAtLeastOneProjectScoped = true;
          expect(
            await hasCompositeOrgFk(table.relname, column),
            `${table.relname} has "${column}" but no composite FK (${column}, org_id) -> ...(id, org_id)`,
          ).toBe(true);
        }
      }
    }
    expect(sawAtLeastOneProjectScoped).toBe(true); // sanity: this test isn't vacuously passing
  });

  test('prdm_app is not a member of prdm_owner and cannot bypass RLS', async () => {
    const { rows: membership } = await pg.ownerPool.query(
      `SELECT 1 FROM pg_auth_members m
         JOIN pg_roles member ON member.oid = m.member
         JOIN pg_roles grp ON grp.oid = m.roleid
        WHERE member.rolname = 'prdm_app' AND grp.rolname = 'prdm_owner'`,
    );
    expect(membership).toEqual([]);

    const { rows: bypass } = await pg.ownerPool.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'prdm_app'`,
    );
    expect(bypass[0]?.rolbypassrls).toBe(false);
  });

  test('prdm_app has no CREATE privilege on the public schema', async () => {
    const { rows } = await pg.ownerPool.query<{ has: boolean }>(`SELECT has_schema_privilege('prdm_app', 'public', 'CREATE') AS has`);
    expect(rows[0]!.has).toBe(false);
  });

  test('prdm_app cannot write platform_admins (SELECT only)', async () => {
    expect(await hasTablePrivilege('prdm_app', 'platform_admins', 'SELECT')).toBe(true);
    expect(await hasTablePrivilege('prdm_app', 'platform_admins', 'INSERT')).toBe(false);
    expect(await hasTablePrivilege('prdm_app', 'platform_admins', 'UPDATE')).toBe(false);
    expect(await hasTablePrivilege('prdm_app', 'platform_admins', 'DELETE')).toBe(false);
  });

  test('every SECURITY DEFINER function in public is owned by prdm_owner and pins a fixed search_path (WO-097)', async () => {
    const functions = await listSecurityDefinerFunctions();
    // sanity: this test isn't vacuously passing — resolve_project/resolve_graph_project (WO-097),
    // resolve_invitation (WO-105) and read_platform_audit_log (WO-101) must all be present.
    expect(functions.length).toBeGreaterThanOrEqual(4);

    for (const fn of functions) {
      expect(fn.owner, `${fn.proname} must be owned by prdm_owner, not ${fn.owner}`).toBe('prdm_owner');
      const searchPathSetting = (fn.proconfig ?? []).find((entry) => entry.startsWith('search_path='));
      expect(searchPathSetting, `${fn.proname} must SET search_path`).toBeDefined();
      expect(searchPathSetting, `${fn.proname} must pin search_path to pg_catalog, public`).toBe('search_path=pg_catalog, public');
    }
  });

  test('every SECURITY DEFINER function grants EXECUTE only to prdm_app, never to PUBLIC (security review #1)', async () => {
    // `CREATE FUNCTION` grants EXECUTE to PUBLIC by default; each 000X migration's `GRANT EXECUTE ... TO
    // prdm_app` only ever added to that default, so any future login role would silently inherit access
    // unless PUBLIC is explicitly revoked (0006). Checked per-function, not just "some role lacks it".
    const functions = await listSecurityDefinerFunctions();
    for (const fn of functions) {
      expect(await hasFunctionPrivilege('public', fn.signature, 'EXECUTE'), `${fn.proname} must not grant EXECUTE to PUBLIC`).toBe(false);
      if (!fn.isTrigger) {
        expect(await hasFunctionPrivilege('prdm_app', fn.signature, 'EXECUTE'), `${fn.proname} must grant EXECUTE to prdm_app`).toBe(true);
      }
    }
  });

  test('prdm_app can only INSERT into platform_audit_log (append-only, no read)', async () => {
    expect(await hasTablePrivilege('prdm_app', 'platform_audit_log', 'INSERT')).toBe(true);
    expect(await hasTablePrivilege('prdm_app', 'platform_audit_log', 'SELECT')).toBe(false);
    expect(await hasTablePrivilege('prdm_app', 'platform_audit_log', 'UPDATE')).toBe(false);
    expect(await hasTablePrivilege('prdm_app', 'platform_audit_log', 'DELETE')).toBe(false);
  });

  test('prdm_app can read and insert audit_log but never modify or truncate it (append-only)', async () => {
    expect(await hasTablePrivilege('prdm_app', 'audit_log', 'SELECT')).toBe(true);
    expect(await hasTablePrivilege('prdm_app', 'audit_log', 'INSERT')).toBe(true);
    expect(await hasTablePrivilege('prdm_app', 'audit_log', 'UPDATE')).toBe(false);
    expect(await hasTablePrivilege('prdm_app', 'audit_log', 'DELETE')).toBe(false);
    expect(await hasTablePrivilege('prdm_app', 'audit_log', 'TRUNCATE')).toBe(false);
  });
});
