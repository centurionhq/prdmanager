/**
 * `project_code_refs` schema test (SDD-012 "Centurion Factory conectado al backend SaaS", WO-331): the
 * generic catalog test (`catalog.test.ts`) already asserts RLS/composite-FK for every non-allowlisted
 * table, so this file focuses on what's specific to this table — its composite primary key and real
 * cross-org row isolation.
 */
import { randomUUID } from 'node:crypto';
import { withTenantTx } from '@prdm/db';
import { createOrganizationFixture, createProjectFixture, openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

let pg: PgTestDb;

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

interface RefRow extends Record<string, unknown> {
  project_id: string;
  blueprint_id: string;
  ref_key: string;
  path: string;
}

async function insertRef(pg2: PgTestDb, orgId: string, projectId: string, overrides: Partial<RefRow> = {}): Promise<void> {
  await withTenantTx(pg2.appPool, orgId, (tx) =>
    tx.execute(sql`
      INSERT INTO project_code_refs (project_id, org_id, blueprint_id, ref_key, path, hash_algo_version, report_id, head_sha)
      VALUES (
        ${overrides.project_id ?? projectId},
        ${orgId},
        ${overrides.blueprint_id ?? 'SDD-001'},
        ${overrides.ref_key ?? 'src/foo.ts'},
        ${overrides.path ?? 'src/foo.ts'},
        1,
        ${randomUUID()},
        ${'a'.repeat(40)}
      )
    `),
  );
}

describe('project_code_refs table (WO-331)', () => {
  test('RLS is enabled and forced, with a composite FK to projects(id, org_id)', async () => {
    const { rows } = await pg.ownerPool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'project_code_refs'`,
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);

    const { rows: policies } = await pg.ownerPool.query<{ polname: string }>(
      `SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = 'project_code_refs'`,
    );
    expect(policies.map((p) => p.polname)).toContain('project_code_refs_tenant_isolation');

    const { rows: fks } = await pg.ownerPool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'project_code_refs'::regclass AND contype = 'f'`,
    );
    expect(fks.map((f) => f.conname)).toContain('project_code_refs_project_org_fk');
  });

  test('the composite primary key is (project_id, blueprint_id, ref_key)', async () => {
    const { rows } = await pg.ownerPool.query<{ attname: string }>(
      `SELECT a.attname
         FROM pg_constraint c
         JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conname = 'project_code_refs_pkey'
        ORDER BY k.ord`,
    );
    expect(rows.map((r) => r.attname)).toEqual(['project_id', 'blueprint_id', 'ref_key']);
  });

  test('prdm_app has full CRUD (no BYPASSRLS)', async () => {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      const { rows } = await pg.ownerPool.query<{ has: boolean }>(`SELECT has_table_privilege('prdm_app', 'project_code_refs', $1) AS has`, [privilege]);
      expect(rows[0]?.has, `prdm_app should have ${privilege}`).toBe(true);
    }
  });

  test('a row inserted under org A is invisible to org B', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });
    await insertRef(pg, orgA.id, projectA.id);

    await withTenantTx(pg.appPool, orgA.id, async (tx) => {
      const { rows } = await tx.execute<RefRow>(sql`SELECT project_id, blueprint_id, ref_key, path FROM project_code_refs`);
      expect(rows).toHaveLength(1);
    });
    await withTenantTx(pg.appPool, orgB.id, async (tx) => {
      const { rows } = await tx.execute<RefRow>(sql`SELECT project_id, blueprint_id, ref_key, path FROM project_code_refs`);
      expect(rows).toHaveLength(0);
    });
  });

  test('inserting a row claiming another org via a mismatched project_id is rejected by the composite FK', async () => {
    const orgA = await createOrganizationFixture(pg);
    const orgB = await createOrganizationFixture(pg);
    const projectA = await createProjectFixture(pg, { orgId: orgA.id });

    await expect(insertRef(pg, orgB.id, projectA.id)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/violates foreign key constraint|row-level security/i) },
    });
  });
});
